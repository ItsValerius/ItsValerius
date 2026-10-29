// Cloudflare Worker that refreshes the profile card once a day (see the cron in wrangler.jsonc).
// It replaces the old GitHub Action: WHOOP's rotating refresh token lives in Workers KV, and the
// card is committed through the GitHub API instead of a checkout.
import { summarize, card, altText, esc } from './card.js';

const WHOOP = 'https://api.prod.whoop.com';
const USER = 'ItsValerius';
const REPO = `${USER}/${USER}`;
const BRANCH = 'main';
const DAY = 864e5;
const TOKEN_KEY = 'whoop_refresh_token';
const MESSAGE = 'vibe update';
// An address on the reserved .invalid TLD, so the daily commit is not linked to any GitHub account
// (and doesn't paint a contribution square every day).
const BOT = { name: 'vibe-worker', email: 'vibe-worker@noreply.invalid' };
// Commits left by the old Action count as bot commits too, so the first Worker run already amends.
const BOT_NAMES = [BOT.name, 'github-actions[bot]'];
const MARKERS = /(<!-- VIBE:START -->)[\s\S]*?(<!-- VIBE:END -->)/;

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).then((r) => console.log(r)));
  },

  // POST /run triggers an update by hand (what workflow_dispatch used to do).
  // POST /seed stores a WHOOP refresh token, used once to hand it over from GitHub secrets.
  // Both need `Authorization: Bearer <ADMIN_TOKEN>`; without that secret set, the endpoints are off.
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method !== 'POST' || !(await authorized(req, env))) return new Response('Not found\n', { status: 404 });
    if (pathname === '/run') return new Response(`${await run(env)}\n`);
    if (pathname === '/seed') {
      const token = (await req.text()).trim();
      if (!token) return new Response('Empty token\n', { status: 400 });
      await env.VIBE_KV.put(TOKEN_KEY, token);
      return new Response('Stored\n');
    }
    return new Response('Not found\n', { status: 404 });
  },
};

async function authorized(req, env) {
  if (!env.ADMIN_TOKEN) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([req.headers.get('Authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`]
    .map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  // Hashing first makes both sides the same length. timingSafeEqual is Workers-only; the fallback is for tests in Node.
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.reduce((d, v, i) => d | (v ^ y[i]), 0) === 0;
}

export async function run(env, now = Date.now()) {
  const at = await whoopToken(env);
  const [rec, slp, wo, repo] = await Promise.all([
    whoop('/recovery?limit=1', at),
    whoop('/activity/sleep?limit=1', at),
    workoutsSince(new Date(now - 12 * 7 * DAY).toISOString(), at),
    lastPushedRepo(env),
  ]);
  const summary = summarize({
    recovery: rec.records?.[0]?.score?.recovery_score ?? null,
    sleep: slp.records?.[0]?.score?.sleep_performance_percentage ?? null,
    workouts: wo,
    repo,
    now,
  });
  const svg = card(summary);
  // Content hash in the URL so GitHub's image cache can't serve a stale card. The URL is absolute because on the
  // profile page a relative src redirects to raw.githubusercontent.com and drops the query.
  const v = (await sha256(svg)).slice(0, 8);
  const img = `<img src="https://raw.githubusercontent.com/${REPO}/${BRANCH}/vibe.svg?v=${v}" alt="${esc(altText(summary))}">`;
  const changed = await publish(env, svg, img, now);
  return `${changed ? 'updated' : 'unchanged'}: ${altText(summary)}`;
}

async function whoopToken(env) {
  const refresh = await env.VIBE_KV.get(TOKEN_KEY);
  if (!refresh) throw new Error(`no WHOOP refresh token in KV (key "${TOKEN_KEY}"); seed it first`);
  const res = await fetch(`${WHOOP}/oauth/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: env.WHOOP_CLIENT_ID,
      client_secret: env.WHOOP_CLIENT_SECRET,
      scope: 'offline',
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const t = await res.json();
  // WHOOP rotates refresh tokens and the old one is now spent, so store the new one before anything else can fail.
  await env.VIBE_KV.put(TOKEN_KEY, t.refresh_token);
  return t.access_token;
}

async function whoop(path, accessToken) {
  const res = await fetch(`${WHOOP}/developer/v2${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function workoutsSince(start, accessToken) {
  const all = [];
  let next = '';
  for (let page = 0; page < 20; page++) {
    const body = await whoop(`/activity/workout?limit=25&start=${start}${next && `&nextToken=${encodeURIComponent(next)}`}`, accessToken);
    all.push(...(body.records ?? []));
    if (!(next = body.next_token)) break;
  }
  return all;
}

async function github(env, method, path, body, accept = 'application/vnd.github+json') {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: accept,
      // GitHub rejects requests without a User-Agent, which Workers don't send by default.
      'User-Agent': 'vibe-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: ${res.status}`);
  return accept.endsWith('raw+json') ? res.text() : res.json();
}

// Public events only. Errors are ignored so the card still renders.
async function lastPushedRepo(env) {
  try {
    const events = await github(env, 'GET', `/users/${USER}/events/public?per_page=100`);
    return events.find((e) => e.type === 'PushEvent' && e.repo.name !== REPO)?.repo.name.split('/')[1] ?? null;
  } catch {
    return null;
  }
}

// Writes README.md and vibe.svg in one commit. Like the Action's `commit --amend` + `push --force-with-lease`,
// a previous bot commit on top is replaced so history keeps only the latest card.
async function publish(env, svg, img, now) {
  const head = (await github(env, 'GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;
  const [commit, readme] = await Promise.all([
    github(env, 'GET', `/repos/${REPO}/git/commits/${head}`),
    github(env, 'GET', `/repos/${REPO}/contents/README.md?ref=${head}`, undefined, 'application/vnd.github.raw+json'),
  ]);
  const next = readme.replace(MARKERS, `$1\n${img}\n$2`);
  // The image URL carries the card's hash, so an unchanged README means an unchanged card.
  if (next === readme) return false;

  const tree = await github(env, 'POST', `/repos/${REPO}/git/trees`, {
    base_tree: commit.tree.sha,
    tree: [
      { path: 'README.md', mode: '100644', type: 'blob', content: next },
      { path: 'vibe.svg', mode: '100644', type: 'blob', content: svg },
    ],
  });
  const amend = commit.message.trim() === MESSAGE && BOT_NAMES.includes(commit.author.name) && commit.parents.length === 1;
  const created = await github(env, 'POST', `/repos/${REPO}/git/commits`, {
    message: MESSAGE,
    tree: tree.sha,
    parents: [amend ? commit.parents[0].sha : head],
    author: { ...BOT, date: new Date(now).toISOString() },
  });
  // The lease: never force over a push that landed while this run was working.
  if ((await github(env, 'GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha !== head) {
    throw new Error(`${BRANCH} moved during the update; the next run will pick it up`);
  }
  await github(env, 'PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: created.sha, force: amend });
  return true;
}

async function sha256(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
