// Turns WHOOP data into a deliberately vague status card. No raw numbers ever leave this file.
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.prod.whoop.com/developer/v2';
const USER = 'ItsValerius';
const DAY = 864e5;

const SPORTS = { running: '🏃', cycling: '🚴', swimming: '🏊', walking: '🚶', hiking: '🥾', weightlifting: '🏋️', 'functional-fitness': '🏋️', yoga: '🧘', tennis: '🎾', soccer: '⚽', basketball: '🏀', climbing: '🧗', rowing: '🚣', boxing: '🥊', skiing: '⛷️', snowboarding: '🏂' };

// Coarse buckets on purpose: 3 levels each, so the README can't be used to track trends.
export function summarize({ recovery, sleep, workouts, repo, now = Date.now() }) {
  const level = recovery == null ? 'unknown' : recovery >= 67 ? 'high' : recovery >= 34 ? 'mid' : 'low';
  const energy = { unknown: '🌫️ signal lost', high: '🔋 fully charged', mid: '🪫 cruising', low: '🐢 low-power mode' }[level];
  const rest = sleep == null ? '' : sleep >= 85 ? '😴 slept like a log' : sleep >= 60 ? '☕ decent night' : '☕☕ running on coffee';

  const thisWeek = workouts.filter((w) => now - Date.parse(w.start) < 7 * DAY);
  const counts = {};
  for (const w of thisWeek) counts[w.sport_name] = (counts[w.sport_name] ?? 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const icon = SPORTS[top] ?? '🏅';
  const move = thisWeek.length >= 3 ? `${icon} on a roll` : thisWeek.length >= 1 ? `${icon} moving` : '🛋️ rest week';

  // Rolling 7-day windows back from now; the streak ends at the first window without a workout.
  let streak = 0;
  while (streak < 12 && workouts.some((w) => { const age = now - Date.parse(w.start); return age >= streak * 7 * DAY && age < (streak + 1) * 7 * DAY; })) streak++;
  const fire = streak >= 2 ? `🔥 ${streak === 12 ? '12+' : streak} weeks active` : '';

  return {
    level,
    lines: [[energy, rest].filter(Boolean).join(' · '), [move, fire].filter(Boolean).join(' · '), repo ? `🛠️ tinkering with ${repo}` : ''].filter(Boolean),
  };
}

const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function card({ level, lines }) {
  const accent = { high: '#2da44e', mid: '#d4a72c', low: '#cf222e', unknown: '#8c959f' }[level];
  const h = 56 + lines.length * 26;
  const text = lines.map((l, i) => `<text x="28" y="${70 + i * 26}" class="t">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${h}" viewBox="0 0 480 ${h}" role="img" aria-label="${esc(lines.join('. '))}">
<style>.bg{fill:#fff;stroke:#d0d7de}.h{fill:#57606a;font:600 13px system-ui,sans-serif;letter-spacing:.08em}.t{fill:#1f2328;font:15px system-ui,sans-serif}@media (prefers-color-scheme:dark){.bg{fill:#0d1117;stroke:#30363d}.h{fill:#8b949e}.t{fill:#e6edf3}}</style>
<rect class="bg" x="0.5" y="0.5" width="479" height="${h - 1}" rx="10"/><rect x="0.5" y="0.5" width="6" height="${h - 1}" rx="3" fill="${accent}"/>
<text x="28" y="36" class="h">TODAY'S VIBE</text>${text}
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
  writeFileSync('vibe.svg', card(summary));
  const readme = readFileSync('README.md', 'utf8');
  const img = `<img src="vibe.svg" alt="${esc(summary.lines.join(' · '))}">`;
  writeFileSync('README.md', readme.replace(/(<!-- VIBE:START -->)[\s\S]*?(<!-- VIBE:END -->)/, `$1\n${img}\n$2`));
  console.log(summary.lines.join('\n'));
}

if (process.argv[2] === 'test') {
  const { strict: assert } = await import('node:assert');
  const now = Date.parse('2026-10-19T12:00:00Z');
  const ago = (d, sport = 'running') => ({ start: new Date(now - d * DAY).toISOString(), sport_name: sport });

  let s = summarize({ recovery: 80, sleep: 90, workouts: [ago(1), ago(2), ago(3, 'cycling'), ago(9), ago(16)], repo: 'kg-eventplan', now });
  assert.equal(s.level, 'high');
  assert.deepEqual(s.lines, ['🔋 fully charged · 😴 slept like a log', '🏃 on a roll · 🔥 3 weeks active', '🛠️ tinkering with kg-eventplan']);

  s = summarize({ recovery: 10, sleep: null, workouts: [ago(8)], repo: null, now });
  assert.deepEqual(s.lines, ['🐢 low-power mode', '🛋️ rest week']); // streak broken by an empty current week

  s = summarize({ recovery: null, sleep: 50, workouts: Array.from({ length: 13 }, (_, i) => ago(i * 7 + 1, 'curling')), now });
  assert.deepEqual(s.lines, ['🌫️ signal lost · ☕☕ running on coffee', '🏅 moving · 🔥 12+ weeks active']);

  assert.match(card({ level: 'low', lines: ['a <b> & "c"'] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.match(card({ level: 'low', lines: ['x'] }), /#cf222e/);
  console.log('ok');
} else {
  await main();
}
