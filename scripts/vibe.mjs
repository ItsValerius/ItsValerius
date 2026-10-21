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
  const scene = !top ? 'rest' : /basketball/.test(top) ? 'hoops' : /run|jog|track/.test(top) ? 'run' : /walk|hik/.test(top) ? 'walk' : 'idle';

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

// Pixel-art sprite of me in a GBA overworld style, 18x24 cells of 4px. Fills are drawn first, then every empty
// cell touching a fill becomes the dark outline; limbs in front of the body get a second outline pass.
// R/r/d hair base/highlight/shadow, H/h skin/shade, E eyes, M smile, J/j/k jersey base/shadow/highlight,
// W white, F shoes, G shoe stripe (recovery level colour), B/b/c ball base/seam/highlight.
const GW = 18, GH = 24, PX = 4;
const PALETTE = { o: '#283040', R: '#b06a38', r: '#e09a60', d: '#7a4424', H: '#f8d0a8', h: '#d89c70', E: '#283040', M: '#a04838',
  J: '#2c64d0', j: '#1c3f94', k: '#6094f0', W: '#f8f8f8', F: '#e8dcc0', B: '#f08030', b: '#a04010', c: '#f8c070' };

function sprite(draw, overlay = () => {}) {
  const g = Array.from({ length: GH }, () => Array(GW).fill('.'));
  const outline = (inside, onto) => {
    const out = g.map((r) => [...r]);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (onto(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx, y + dy))) out[y][x] = 'o';
    out.forEach((r, y) => { g[y] = r; });
  };
  const pen = (grid) => {
    const set = (x, y, c) => { if (grid[y] && x >= 0 && x < GW) grid[y][x] = c; };
    return [set, (y, x0, x1, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); }];
  };
  draw(...pen(g));
  outline((x, y) => (g[y]?.[x] ?? '.') !== '.', (x, y) => g[y][x] === '.');
  const top = Array.from({ length: GH }, () => Array(GW).fill('.'));
  overlay(...pen(top));
  const on = (x, y) => (top[y]?.[x] ?? '.') !== '.';
  outline(on, (x, y) => !on(x, y));
  top.forEach((r, y) => r.forEach((c, x) => { if (c !== '.') g[y][x] = c; }));
  return g;
}
const limb = (pts, bob = 0) => (set) => pts.forEach(([x, y, c = 'H']) => set(x + 1, y + bob, c));

// Facing the viewer: tousled hair, grin, blue #4 club tank top, shorts, white socks.
function front(set, row, { bob = 0, asleep = false } = {}) {
  const S = (x, y, c) => set(x + 1, y + bob, c), R = (y, a, b, c) => row(y + bob, a + 1, b + 1, c);
  S(6, 0, 'R'); S(9, 0, 'R'); S(11, 1, 'R');
  R(1, 4, 10, 'R'); S(6, 1, 'r'); S(7, 1, 'r');
  R(2, 3, 12, 'R'); S(5, 2, 'r'); S(6, 2, 'r'); S(9, 2, 'r');
  R(3, 2, 13, 'R'); S(4, 3, 'r'); S(12, 3, 'd'); S(13, 3, 'd');
  R(4, 2, 13, 'R'); for (const x of [3, 7, 10, 13]) S(x, 4, 'd');
  R(5, 3, 12, 'H'); for (const x of [2, 3, 4, 8, 12, 13]) S(x, 5, 'R'); S(9, 5, 'd');
  R(6, 2, 13, 'H'); S(2, 6, 'd'); S(13, 6, 'd'); S(1, 6, 'h'); S(14, 6, 'h');
  R(7, 2, 13, 'H'); S(1, 7, 'h'); S(14, 7, 'h');
  if (asleep) { S(5, 7, 'E'); S(10, 7, 'E'); } else { S(5, 6, 'E'); S(5, 7, 'E'); S(10, 6, 'E'); S(10, 7, 'E'); }
  R(8, 3, 12, 'H'); S(3, 8, 'h'); S(12, 8, 'h');
  R(9, 4, 11, 'H');
  if (asleep) R(9, 7, 8, 'M'); else { S(5, 8, 'M'); S(10, 8, 'M'); R(9, 6, 9, 'M'); }
  R(10, 5, 10, 'h');
  R(11, 4, 11, 'J'); R(11, 6, 9, 'h'); S(4, 11, 'k');
  for (let y = 12; y <= 16; y++) { R(y, 4, 11, 'J'); S(4, y, 'k'); S(11, y, 'j'); }
  R(12, 7, 8, 'h');
  for (const [x, y] of [[5, 13], [7, 13], [5, 14], [7, 14], [5, 15], [6, 15], [7, 15], [7, 16]]) S(x, y, 'W'); // 4
  S(10, 13, 'W'); // club badge
  R(11, 2, 3, 'H'); R(12, 2, 3, 'H'); S(2, 13, 'H'); S(2, 14, 'h'); S(2, 15, 'H'); S(3, 12, 'h');
  R(11, 12, 13, 'H'); R(12, 12, 13, 'H'); S(12, 12, 'h');
  R(17, 4, 11, 'j'); R(18, 4, 6, 'J'); R(18, 9, 11, 'J'); S(11, 18, 'j');
  R(19, 5, 6, 'H'); R(19, 9, 10, 'H'); R(20, 5, 6, 'h'); R(20, 9, 10, 'h'); R(21, 5, 6, 'W'); R(21, 9, 10, 'W');
  R(22, 4, 6, 'F'); R(22, 9, 11, 'F'); S(4, 22, 'G'); S(11, 22, 'G');
}

// Side view facing right, for running and walking.
function side(set, row, { legs, bob = 0 }) {
  const S = (x, y, c) => set(x + 1, y + bob, c), R = (y, a, b, c) => row(y + bob, a + 1, b + 1, c);
  S(6, 0, 'R'); S(9, 0, 'R'); S(3, 1, 'R');
  R(1, 4, 10, 'R'); S(7, 1, 'r');
  R(2, 2, 11, 'R'); S(6, 2, 'r'); S(7, 2, 'r'); S(8, 2, 'r');
  R(3, 2, 12, 'R'); S(5, 3, 'r'); S(3, 3, 'd');
  R(4, 2, 12, 'R'); S(3, 4, 'd'); S(7, 4, 'd'); S(10, 4, 'd');
  R(5, 3, 12, 'R'); R(5, 8, 11, 'H'); S(12, 5, 'R');
  R(6, 3, 12, 'H'); R(6, 3, 6, 'R'); S(4, 6, 'd');
  R(7, 4, 13, 'H'); S(4, 7, 'R'); S(5, 7, 'd'); S(7, 7, 'h'); S(7, 6, 'h'); S(11, 6, 'E'); S(11, 7, 'E');
  R(8, 4, 13, 'H'); S(4, 8, 'd'); S(12, 8, 'M');
  R(9, 5, 12, 'H'); S(11, 9, 'M'); S(12, 9, 'h');
  R(10, 6, 11, 'h');
  for (let y = 11; y <= 16; y++) { R(y, 5, 10, 'J'); S(5, y, 'j'); S(10, y, 'k'); }
  R(11, 8, 9, 'h');
  R(17, 5, 10, 'j'); R(18, 5, 10, 'J'); S(5, 18, 'j');
  for (const [x, y, c] of legs) S(x, y, c);
}
const SIDE_LEGS = {
  stride: [[9, 19, 'H'], [10, 19, 'H'], [10, 20, 'H'], [11, 20, 'h'], [11, 21, 'W'], [12, 21, 'W'], [11, 22, 'F'], [12, 22, 'F'], [13, 22, 'G'],
    [6, 19, 'H'], [5, 19, 'h'], [4, 20, 'H'], [3, 20, 'h'], [2, 21, 'W'], [3, 21, 'W'], [0, 22, 'F'], [1, 22, 'G'], [2, 22, 'F']],
  pass: [[7, 19, 'H'], [8, 19, 'H'], [7, 20, 'h'], [8, 20, 'H'], [7, 21, 'W'], [8, 21, 'W'], [7, 22, 'F'], [8, 22, 'F'], [9, 22, 'G'],
    [5, 19, 'H'], [4, 19, 'h'], [3, 19, 'W'], [2, 19, 'F'], [2, 18, 'F'], [3, 18, 'G']],
};
const SIDE_ARM = {
  fwd: [[8, 12], [9, 12], [9, 13], [10, 13], [11, 13], [11, 12], [12, 12], [12, 11, 'h']],
  back: [[7, 12], [7, 13], [6, 13], [6, 14], [5, 14], [5, 15], [4, 15], [3, 15, 'h']],
  down: [[8, 12], [8, 13], [8, 14], [9, 15], [9, 16, 'h']],
};
const RIGHT_ARM_DOWN = [[13, 13], [13, 14], [13, 15, 'h']];
const BALL = ['.cB.', 'cBbB', 'BbBB', '.BB.'];
const Z = ['WWW', '.W.', 'WWW']; // a tiny "z"

const stride = [
  sprite((s, r) => side(s, r, { legs: SIDE_LEGS.stride }), limb(SIDE_ARM.back)),
  sprite((s, r) => side(s, r, { legs: SIDE_LEGS.pass, bob: -1 }), limb(SIDE_ARM.down, -1)),
  sprite((s, r) => side(s, r, { legs: SIDE_LEGS.stride }), limb(SIDE_ARM.fwd)),
  sprite((s, r) => side(s, r, { legs: SIDE_LEGS.pass, bob: -1 }), limb(SIDE_ARM.down, -1)),
];
// [loop seconds, frames, backdrop, whether the backdrop scrolls]
const SCENES = {
  run: [0.6, stride, 'grass', true],
  walk: [1.1, stride, 'grass', true],
  hoops: [0.8, [14, 16, 18, 16].map((by) => sprite((s, r) => {
    front(s, r);
    BALL.forEach((line, j) => [...line].forEach((c, i) => c !== '.' && s(14 + i, by + 1 + j, c)));
  }, limb([[13, 13], [14, 13], [14, 14], [15, 14, 'h']]))), 'court', false],
  idle: [0.9, [0, -1].map((bob) => sprite((s, r) => front(s, r, { bob }), limb(RIGHT_ARM_DOWN, bob))), 'grass', false],
  rest: [2.4, [0, 1, 2, 3].map((k) => sprite((s, r) => front(s, r, { asleep: true, bob: k % 2 ? -1 : 0 }), (s) => {
    limb(RIGHT_ARM_DOWN, k % 2 ? -1 : 0)(s);
    Z.forEach((line, j) => [...line].forEach((c, i) => c !== '.' && s(15 + i, 3 - k + j, c)));
  })), 'grass', false],
};

// Backdrops are SVG patterns of 4px cells: route grass, or a wooden gym floor.
function backdrop(kind, x, y, w, h, dur, scroll) {
  const cell = (cx, cy, c) => `<rect x="${cx * PX}" y="${cy * PX}" width="${PX}" height="${PX}" fill="${c}"/>`;
  if (kind === 'court') {
    const planks = [[0, 0, 16], [0, 3, 16]].map(([cx, cy, n]) => `<rect x="${cx}" y="${cy * PX}" width="${n * PX}" height="${PX}" fill="#c08048"/>`).join('')
      + [[5, 1], [13, 2], [9, 4], [1, 5]].map(([cx, cy]) => cell(cx, cy, '#c08048')).join('');
    return `<pattern id="bd" width="${16 * PX}" height="${6 * PX}" patternUnits="userSpaceOnUse" x="${x}" y="${y}"><rect width="${16 * PX}" height="${6 * PX}" fill="#e0a868"/>${planks}</pattern>
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#bd)"/>`;
  }
  const tuft = [[1, 1, '#58a840'], [2, 0, '#58a840'], [3, 1, '#58a840'], [5, 4, '#58a840'], [6, 3, '#58a840'], [7, 4, '#58a840'], [2, 6, '#c8f0a0'], [6, 0, '#c8f0a0']];
  const anim = scroll ? ` class="fx" style="animation:scroll ${dur}s steps(2,end) infinite"` : '';
  // One tile wider than the panel so it can scroll left by a tile and loop.
  return `<pattern id="bd" width="${8 * PX}" height="${8 * PX}" patternUnits="userSpaceOnUse" x="${x}" y="${y}"><rect width="${8 * PX}" height="${8 * PX}" fill="#90d070"/>${tuft.map(([cx, cy, c]) => cell(cx, cy, c)).join('')}</pattern>
<g${anim}><rect x="${x}" y="${y}" width="${w + 8 * PX}" height="${h}" fill="url(#bd)"/></g>`;
}

// One frame visible at a time: frame k shows during [k/n, (k+1)/n) of each loop. Reduced motion keeps frame 0.
function figure(name, level, x, y) {
  const [dur, frames, kind, scroll] = SCENES[name];
  const n = frames.length, w = 116, h = 108, px = x - 10, py = y - 6, ox = x + 12, oy = y + 2;
  const body = frames.map((g, k) => {
    // One rect per horizontal run of same-coloured cells keeps the file small.
    const rects = g.flatMap((r, j) => r.map((c, i) => {
      if (c === '.' || r[i - 1] === c) return '';
      let n = 1;
      while (r[i + n] === c) n++;
      const paint = c === 'G' ? `class="shoe lv-${level}"` : `fill="${PALETTE[c]}"`;
      return `<rect x="${ox + i * PX}" y="${oy + j * PX}" width="${n * PX}" height="${PX}" ${paint}/>`;
    })).join('');
    return `<g class="fr${k ? '' : ' fr0'}" style="animation:flip${n} ${dur}s steps(1,end) infinite;animation-delay:${(-(n - k) * dur / n).toFixed(3)}s">${rects}</g>`;
  }).join('');
  return `<style>@keyframes flip${n}{0%{opacity:1}${+(100 / n).toFixed(2)}%{opacity:0}100%{opacity:0}}@keyframes scroll{to{transform:translateX(-${8 * PX}px)}}
.fr{opacity:0}@media (prefers-reduced-motion:reduce){.fr,.fx{animation:none!important}.fr0{opacity:1}}</style>
<clipPath id="panel"><rect x="${px}" y="${py}" width="${w}" height="${h}" rx="10"/></clipPath>
<g clip-path="url(#panel)" shape-rendering="crispEdges">${backdrop(kind, px, py, w, h, dur, scroll)}
<rect x="${ox + 4 * PX}" y="${oy + 22 * PX}" width="${10 * PX}" height="${2 * PX}" fill="#000" fill-opacity=".22"/>${body}</g>
<rect x="${px}" y="${py}" width="${w}" height="${h}" rx="10" fill="none" stroke="#283040" stroke-width="2"/>`;
}

export function card(summary) {
  const { level, heading, rows, scene } = summary;
  const W = 480, top = 28, rowStart = 92, step = 30;
  const h = Math.max(rowStart + (rows.length - 1) * step + 28, scene ? 124 : 0);
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
${scene ? figure(scene, level, W - 120, (h - 96) / 2) : ''}
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

  assert.equal(s.scene, 'idle');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'cycling')], now }).rows[0].text, 'Moving this week');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [], now }).scene, 'rest');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'yoga')], now }).scene, 'idle');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'basketball')], now }).scene, 'hoops');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'running')], now }).scene, 'run');
  for (const sc of ['run', 'walk', 'hoops', 'idle', 'rest']) assert.match(card({ ...s, scene: sc }), /class="fr fr0"/);

  assert.match(card({ level: 'low', heading: 'a <b> & "c"', rows: [] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.equal((card(summarize({ recovery: 50, sleep: null, workouts: [], now })).match(/class="lv-mid"/g) ?? []).length, 2);
  console.log('ok');
} else {
  await main();
}
