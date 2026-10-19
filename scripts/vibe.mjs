// Turns WHOOP data into a deliberately vague status card. No raw numbers ever leave this file.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API = 'https://api.prod.whoop.com/developer/v2';
const USER = 'ItsValerius';
const DAY = 864e5;

// Coarse buckets on purpose: 3 levels each, so the README can't be used to track trends.
export function summarize({ recovery, sleep, workouts, repo, now = Date.now() }) {
  const level = recovery == null ? 'unknown' : recovery >= 67 ? 'high' : recovery >= 34 ? 'mid' : 'low';
  const heading = { unknown: 'Signal lost', high: 'Fully charged', mid: 'Cruising', low: 'Low-power mode' }[level];
  const rows = [];
  if (sleep != null) rows.push({ icon: 'moon', text: sleep >= 85 ? 'Slept like a log' : sleep >= 60 ? 'Decent night' : 'Running on coffee' });

  const thisWeek = workouts.filter((w) => now - Date.parse(w.start) < 7 * DAY);
  const counts = {};
  for (const w of thisWeek) counts[w.sport_name] = (counts[w.sport_name] ?? 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const sport = top ? top.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';
  rows.push({ icon: 'pulse', text: thisWeek.length >= 3 ? `${sport}, on a roll` : thisWeek.length >= 1 ? `${sport} this week` : 'Rest week' });

  // Rolling 7-day windows back from now; the streak ends at the first window without a workout.
  let streak = 0;
  while (streak < 12 && workouts.some((w) => { const age = now - Date.parse(w.start); return age >= streak * 7 * DAY && age < (streak + 1) * 7 * DAY; })) streak++;
  if (streak >= 2) rows.push({ icon: 'flame', text: `${streak === 12 ? '12+' : streak} weeks active in a row` });

  if (repo) rows.push({ icon: 'code', text: `Tinkering with ${repo}` });
  return { level, heading, rows };
}

export const altText = ({ heading, rows }) => [heading, ...rows.map((r) => r.text)].join(' · ');

const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// Lucide icons (ISC license), 24px grid, so they render the same everywhere (emoji depend on the viewer's fonts).
const ICONS = {
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
};
const icon = (name, x, y, size, cls) => `<g class="${cls}" transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;

// Battery segments filled per level: the energy colour lives here, not on a border.
function battery(level, x, y) {
  const filled = { unknown: 0, low: 1, mid: 2, high: 3 }[level];
  const segs = [0, 1, 2].map((i) => `<rect x="${3.6 + i * 4}" y="7.6" width="3.2" height="4.8" rx=".8" class="${i < filled ? `lv-${level}` : 'seg'}"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(1.4)"><rect x="1.8" y="5.8" width="14.4" height="8.4" rx="2.2" fill="none" stroke-width="1.4" class="ink"/><path d="M18 8.6v2.8" stroke-width="1.6" stroke-linecap="round" class="ink"/>${segs}</g>`;
}

export function card(summary) {
  const { level, heading, rows } = summary;
  const W = 480, top = 28, rowStart = 92, step = 30;
  const h = rowStart + (rows.length - 1) * step + 28;
  const body = rows.map((r, i) => {
    const base = rowStart + i * step;
    return `${icon(r.icon, 29, base - 14.5, 18, 'mut')}<text x="62" y="${base}" class="t">${esc(r.text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(altText(summary))}">
<style>
.bg{fill:#ffffff;stroke:#d1d9e0}.hd{fill:#1f2328;font:600 21px system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em}
.t{fill:#1f2328;font:15px system-ui,-apple-system,"Segoe UI",sans-serif}.mut{stroke:#59636e}.ink{stroke:#1f2328;fill:none}.seg{fill:#d1d9e0}
.lv-high{fill:#1a7f37}.lv-mid{fill:#9a6700}.lv-low{fill:#cf222e}
@media (prefers-color-scheme:dark){.bg{fill:#0d1117;stroke:#3d444d}.hd,.t{fill:#f0f6fc}.mut{stroke:#9198a1}.ink{stroke:#f0f6fc}.seg{fill:#3d444d}
.lv-high{fill:#3fb950}.lv-mid{fill:#d29922}.lv-low{fill:#f85149}}
</style>
<rect class="bg" x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="12"/>
${battery(level, 25, top + 1)}<text x="62" y="${top + 24}" class="hd">${esc(heading)}</text>
${body}
</svg>
`;
}

async function token() {
  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.WHOOP_REFRESH_TOKEN,
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
      scope: 'offline',
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const t = await res.json();
  // WHOOP invalidates the old refresh token now; the workflow saves this one back into the repo secret.
  writeFileSync(process.env.NEW_TOKEN_FILE ?? '.new_refresh_token', t.refresh_token);
  return t.access_token;
}

async function get(path, accessToken) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function workoutsSince(start, accessToken) {
  const all = [];
  let next = '';
  for (let page = 0; page < 20; page++) {
    const body = await get(`/activity/workout?limit=25&start=${start}${next && `&nextToken=${encodeURIComponent(next)}`}`, accessToken);
    all.push(...(body.records ?? []));
    if (!(next = body.next_token)) break;
  }
  return all;
}

// Public pushes only, so this never reveals private repos. Best effort: a GitHub hiccup shouldn't kill the card.
async function lastPushedRepo() {
  try {
    const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const events = await (await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers })).json();
    return events.find((e) => e.type === 'PushEvent' && e.repo.name !== `${USER}/${USER}`)?.repo.name.split('/')[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const at = await token();
  const [rec, slp, wo, repo] = await Promise.all([
    get('/recovery?limit=1', at),
    get('/activity/sleep?limit=1', at),
    workoutsSince(new Date(Date.now() - 12 * 7 * DAY).toISOString(), at),
    lastPushedRepo(),
  ]);
  const summary = summarize({
    recovery: rec.records?.[0]?.score?.recovery_score ?? null,
    sleep: slp.records?.[0]?.score?.sleep_performance_percentage ?? null,
    workouts: wo,
    repo,
  });
  const svg = card(summary);
  writeFileSync('vibe.svg', svg);
  // New URL whenever the card changes, so browsers and GitHub's image cache can't show yesterday's card.
  const v = createHash('sha256').update(svg).digest('hex').slice(0, 8);
  const readme = readFileSync('README.md', 'utf8');
  const img = `<img src="vibe.svg?v=${v}" alt="${esc(altText(summary))}">`;
  writeFileSync('README.md', readme.replace(/(<!-- VIBE:START -->)[\s\S]*?(<!-- VIBE:END -->)/, `$1\n${img}\n$2`));
  console.log(altText(summary));
}

if (process.argv[2] === 'test') {
  const { strict: assert } = await import('node:assert');
  const now = Date.parse('2026-10-19T12:00:00Z');
  const ago = (d, sport = 'running') => ({ start: new Date(now - d * DAY).toISOString(), sport_name: sport });

  let s = summarize({ recovery: 80, sleep: 90, workouts: [ago(1), ago(2), ago(3, 'cycling'), ago(9), ago(16)], repo: 'kg-eventplan', now });
  assert.equal(s.level, 'high');
  assert.equal(altText(s), 'Fully charged · Slept like a log · Running, on a roll · 3 weeks active in a row · Tinkering with kg-eventplan');

  s = summarize({ recovery: 10, sleep: null, workouts: [ago(8)], repo: null, now });
  assert.equal(altText(s), 'Low-power mode · Rest week'); // streak broken by an empty current week

  s = summarize({ recovery: null, sleep: 50, workouts: Array.from({ length: 13 }, (_, i) => ago(i * 7 + 1, 'functional-fitness')), now });
  assert.equal(altText(s), 'Signal lost · Running on coffee · Functional fitness this week · 12+ weeks active in a row');

  assert.match(card({ level: 'low', heading: 'a <b> & "c"', rows: [] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.equal((card(summarize({ recovery: 50, sleep: null, workouts: [], now })).match(/class="lv-mid"/g) ?? []).length, 2);
  console.log('ok');
} else {
  await main();
}
