// Builds the profile card from WHOOP data. Only coarse buckets are published, never raw values.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API = 'https://api.prod.whoop.com/developer/v2';
const USER = 'ItsValerius';
const DAY = 864e5;

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
  // The card draws the sport, so its text drops the name; the alt text keeps it.
  rows.push(thisWeek.length >= 3 ? { icon: 'pulse', text: 'On a roll this week', alt: `${sport}, on a roll` }
    : thisWeek.length >= 1 ? { icon: 'pulse', text: 'Moving this week', alt: `${sport} this week` }
    : { icon: 'pulse', text: 'Rest week' });
  const scene = !top ? 'rest' : /run|jog|track/.test(top) ? 'run' : /walk|hik/.test(top) ? 'walk' : /cycl|bik|spin/.test(top) ? 'cycle'
    : /swim/.test(top) ? 'swim' : /lift|strength|fitness|crossfit|power|weight/.test(top) ? 'lift' : 'jacks';

  // Rolling 7-day windows back from now; the streak ends at the first window without a workout.
  let streak = 0;
  while (streak < 12 && workouts.some((w) => { const age = now - Date.parse(w.start); return age >= streak * 7 * DAY && age < (streak + 1) * 7 * DAY; })) streak++;
  if (streak >= 2) rows.push({ icon: 'flame', text: `${streak === 12 ? '12+' : streak} weeks active in a row` });

  if (repo) rows.push({ icon: 'code', text: `Tinkering with ${repo}` });
  return { level, heading, rows, scene };
}

export const altText = ({ heading, rows }) => [heading, ...rows.map((r) => r.alt ?? r.text)].join(' · ');

const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// Lucide icons (ISC license), 24px grid.
const ICONS = {
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
};
const icon = (name, x, y, size, cls) => `<g class="${cls}" transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;

// Battery with 0–3 filled segments for the recovery level.
function battery(level, x, y) {
  const filled = { unknown: 0, low: 1, mid: 2, high: 3 }[level];
  const segs = [0, 1, 2].map((i) => `<rect x="${3.6 + i * 4}" y="7.6" width="3.2" height="4.8" rx=".8" class="${i < filled ? `lv-${level}` : 'seg'}"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(1.4)"><rect x="1.8" y="5.8" width="14.4" height="8.4" rx="2.2" fill="none" stroke-width="1.4" class="ink"/><path d="M18 8.6v2.8" stroke-width="1.6" stroke-linecap="round" class="ink"/>${segs}</g>`;
}

// Animated stick figures in a 96px box. Each pose function maps a loop phase t in [0, 1) to the same list of
// strokes; sampling it gives SMIL keyframes for each stroke's path, which animate even inside an <img>.
const f1 = (n) => +n.toFixed(1);
const line = (...pts) => 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L');
const ring = (x, y, r) => `M${f1(x - r)} ${f1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const add = (p, len, a) => [p[0] + len * Math.sin(a), p[1] + len * Math.cos(a)]; // a = angle from straight down, + is forward
const TAU = 2 * Math.PI;

// Two-segment limb from a to b; bend 1 puts the joint on the right of the a→b direction, -1 on the left.
function limb(a, b, l1, l2, bend) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy), r = Math.min(d, l1 + l2 - 0.01);
  const along = (l1 * l1 - l2 * l2 + r * r) / (2 * r), off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const ux = dx / d, uy = dy / d;
  return line(a, [a[0] + ux * along - bend * uy * off, a[1] + uy * along + bend * ux * off], b);
}

function stride(t, { reach, lift, lean, arm, bob }) {
  const b = bob * Math.cos(2 * TAU * t);
  const hip = [46, 52 + b], sh = [46 + lean, 30 + b];
  const leg = (p) => limb(hip, [46 + reach * Math.sin(p), 81 - lift * Math.max(0, Math.cos(p))], 16, 16, -1);
  const hand = (p) => { const a = arm * Math.sin(p), e = add(sh, 11, a); return line(sh, e, add(e, 10, a + 1.5)); };
  const p = TAU * t;
  return [
    { cls: 'mut', d: leg(p + Math.PI) }, { cls: 'mut', d: hand(p) },
    { cls: 'ink', d: line(hip, sh) }, { cls: 'ink', d: ring(sh[0] + lean / 3, sh[1] - 10, 6) },
    { cls: 'ink', d: leg(p) }, { cls: 'ink', d: hand(p + Math.PI) },
  ];
}

const POSES = {
  run: [0.7, (t) => [...stride(t, { reach: 14, lift: 9, lean: 5, arm: 0.9, bob: 1.5 }), { cls: 'mut dash', d: 'M6 85H90' }]],
  walk: [1.2, (t) => [...stride(t, { reach: 8, lift: 3, lean: 1, arm: 0.5, bob: 0.6 }), { cls: 'mut', d: 'M6 85H90' }]],
  cycle: [0.9, (t) => {
    const bb = [44, 70], hip = [36, 45], sh = [54, 31];
    const pedal = (p) => [bb[0] + 7 * Math.cos(p), bb[1] + 7 * Math.sin(p)];
    const spokes = (c) => { const a = TAU * t / 4; return line(add(c, 12, a), add(c, -12, a)) + line(add(c, 12, a + Math.PI / 2), add(c, -12, a + Math.PI / 2)); };
    const p = TAU * t;
    return [
      { cls: 'mut', d: limb(hip, pedal(p + Math.PI), 17, 17, -1) },
      { cls: 'mut', d: ring(22, 70, 14) + ring(72, 70, 14) }, { cls: 'mut thin', d: spokes([22, 70]) + spokes([72, 70]) },
      { cls: 'mut', d: line([22, 70], bb, [38, 47], [22, 70]) + line(bb, [64, 48], [72, 70]) + line([38, 47], [64, 48], [62, 42], [68, 42]) },
      { cls: 'ink', d: line(hip, sh) + line(sh, [58, 40], [65, 43]) }, { cls: 'ink', d: ring(59, 22, 6) },
      { cls: 'ink', d: limb(hip, pedal(p), 17, 17, -1) + line(pedal(p + Math.PI), pedal(p)) },
    ];
  }],
  lift: [2.4, (t) => {
    const s = (1 - Math.cos(TAU * t)) / 2, by = 36 - 26 * s, dip = 5 * (1 - s); // bar from shoulders to overhead
    const hip = [48, 56 + dip], sh = [48, 30 + dip / 3];
    return [
      { cls: 'ink', d: line(hip, sh) }, { cls: 'ink', d: ring(48, 21 + dip / 3, 6) },
      { cls: 'ink', d: limb([hip[0] - 4, hip[1]], [36, 82], 14, 14, 1) + limb([hip[0] + 4, hip[1]], [60, 82], 14, 14, -1) },
      { cls: 'ink', d: limb([sh[0] - 6, sh[1]], [35, by], 11, 11, 1) + limb([sh[0] + 6, sh[1]], [61, by], 11, 11, -1) },
      { cls: 'mut', d: line([18, by], [78, by]) }, { cls: 'mut plate', d: line([22, by - 8], [22, by + 8]) + line([74, by - 8], [74, by + 8]) },
      { cls: 'mut', d: 'M6 85H90' },
    ];
  }],
  swim: [1.6, (t) => {
    const p = TAU * t, sh = [62, 50], hip = [30, 51];
    const arm = (q) => line(sh, add(sh, 18, Math.PI / 2 - q));
    const kick = (q) => line(hip, add(hip, 16, -Math.PI / 2 + 0.25 * Math.sin(q)));
    const wave = (y, o) => 'M4 ' + y + [...Array(11)].map((_, i) => `L${4 + i * 8.8} ${f1(y + 2.5 * Math.sin(i * 1.2 - p + o))}`).join('');
    return [
      { cls: 'mut', d: arm(p + Math.PI) }, { cls: 'mut', d: kick(4 * p + Math.PI) },
      { cls: 'ink', d: line(hip, sh) }, { cls: 'ink', d: ring(71, 46, 6) },
      { cls: 'ink', d: kick(4 * p) }, { cls: 'ink', d: arm(p) },
      { cls: 'acc', d: wave(56, 0) }, { cls: 'acc thin', d: wave(66, 1.5) },
    ];
  }],
  jacks: [0.9, (t) => {
    const s = (1 - Math.cos(TAU * t)) / 2, y = -3 * Math.sin(Math.PI * s);
    const hip = [48, 55 + y], sh = [48, 32 + y], a = 0.3 + 2.4 * s;
    return [
      { cls: 'ink', d: line(hip, sh) }, { cls: 'ink', d: ring(48, 23 + y, 6) },
      { cls: 'ink', d: line([42, 82 + y / 2 - 6 * s], hip, [54, 82 + y / 2 - 6 * s]) },
      { cls: 'ink', d: line(add(sh, 20, -a), sh, add(sh, 20, a)) },
      { cls: 'mut', d: 'M6 85H90' },
    ];
  }],
  rest: [3, (t) => {
    const z = (k) => { const q = (t + k / 3) % 1, x = 56 + 14 * q, y = 46 - 26 * q, r = 2 + 2 * q; return line([x, y], [x + r, y], [x, y + r], [x + r, y + r]); };
    return [
      { cls: 'ink', d: ring(22, 62, 6) }, { cls: 'ink', d: line([29, 64], [64, 64], [78, 68]) },
      { cls: 'mut', d: line([12, 70], [12, 80]) + line([12, 70], [86, 70], [86, 80]) },
      ...[0, 1, 2].map((k) => ({ cls: 'mut thin', d: z(k) })),
    ];
  }],
};

function figure(name, x, y) {
  const [dur, pose] = POSES[name];
  const frames = Array.from({ length: 16 }, (_, i) => pose(i / 16));
  const paths = frames[0].map((s, k) => {
    const ds = frames.map((f) => f[k].d);
    const anim = ds.every((d) => d === ds[0]) ? '' : `<animate attributeName="d" dur="${dur}s" repeatCount="indefinite" values="${[...ds, ds[0]].join(';')}"/>`;
    return `<path class="${s.cls}" d="${ds[0]}">${anim}</path>`;
  }).join('');
  return `<g transform="translate(${x} ${y})" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

export function card(summary) {
  const { level, heading, rows, scene } = summary;
  const W = 480, top = 28, rowStart = 92, step = 30;
  const h = Math.max(rowStart + (rows.length - 1) * step + 28, scene ? 120 : 0);
  const body = rows.map((r, i) => {
    const base = rowStart + i * step;
    return `${icon(r.icon, 29, base - 14.5, 18, 'mut')}<text x="62" y="${base}" class="t">${esc(r.text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(altText(summary))}">
<style>
.bg{fill:#ffffff;stroke:#d1d9e0}.hd{fill:#1f2328;font:600 21px system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em}
.t{fill:#1f2328;font:15px system-ui,-apple-system,"Segoe UI",sans-serif}.mut{stroke:#59636e}.ink{stroke:#1f2328;fill:none}.seg{fill:#d1d9e0}
.lv-high{fill:#1a7f37}.lv-mid{fill:#9a6700}.lv-low{fill:#cf222e}.acc{stroke:#0969da}.thin{stroke-width:2}.plate{stroke-width:6}
.dash{stroke-dasharray:10 8;animation:mv .4s linear infinite}@keyframes mv{to{stroke-dashoffset:18}}
@media (prefers-color-scheme:dark){.bg{fill:#0d1117;stroke:#3d444d}.hd,.t{fill:#f0f6fc}.mut{stroke:#9198a1}.ink{stroke:#f0f6fc}.seg{fill:#3d444d}
.lv-high{fill:#3fb950}.lv-mid{fill:#d29922}.lv-low{fill:#f85149}.acc{stroke:#4493f8}}
</style>
<rect class="bg" x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="12"/>
${battery(level, 25, top + 1)}<text x="62" y="${top + 24}" class="hd">${esc(heading)}</text>
${body}
${scene ? figure(scene, W - 120, (h - 96) / 2) : ''}
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
  // WHOOP rotates refresh tokens; the workflow stores this one as the new secret.
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

// Public events only. Errors are ignored so the card still renders.
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
  // Content hash in the URL so GitHub's image cache can't serve a stale card.
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

  assert.equal(s.scene, 'lift');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'cycling')], now }).rows[0].text, 'Moving this week');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [], now }).scene, 'rest');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'yoga')], now }).scene, 'jacks');
  assert.match(card(s), /<animate attributeName="d"/);

  assert.match(card({ level: 'low', heading: 'a <b> & "c"', rows: [] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.equal((card(summarize({ recovery: 50, sleep: null, workouts: [], now })).match(/class="lv-mid"/g) ?? []).length, 2);
  console.log('ok');
} else {
  await main();
}
