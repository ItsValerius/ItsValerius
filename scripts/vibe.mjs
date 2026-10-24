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
  const scene = !top ? 'rest' : /basketball/.test(top) ? 'hoops' : /run|jog|track/.test(top) ? 'run' : /walk|hik/.test(top) ? 'walk'
    : /cycl|bik|spin/.test(top) ? 'cycle' : /lift|strength|weight|power|crossfit|fitness/.test(top) ? 'lift' : 'idle';

  // Rolling 7-day windows back from now; the streak ends at the first window without a workout.
  let streak = 0;
  while (streak < 12 && workouts.some((w) => { const age = now - Date.parse(w.start); return age >= streak * 7 * DAY && age < (streak + 1) * 7 * DAY; })) streak++;
  if (streak >= 2) rows.push({ icon: 'flame', text: `${streak === 12 ? '12+' : streak} weeks active in a row` });

  if (repo) rows.push({ icon: 'code', text: `Tinkering with ${repo}` });
  return { level, heading, rows, scene };
}

export const altText = ({ heading, rows }) => [heading, ...rows.map((r) => r.alt ?? r.text)].join(' · ');

const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// 5x7 pixel font (8 rows so g, p, q and y can descend). Glyphs are trimmed to their used columns, so text is proportional.
const FONT = Object.fromEntries(Object.entries({
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.', C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '###..|#..#.|#...#|#...#|#...#|#..#.|###..', E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#', I: '###|.#.|.#.|.#.|.#.|.#.|###',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..', K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#', O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....', Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..', U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|#...#|.#.#.|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  a: '....|....|###.|...#|.###|#..#|.###', b: '#...|#...|###.|#..#|#..#|#..#|###.', c: '....|....|.##.|#...|#...|#...|.###',
  d: '...#|...#|.###|#..#|#..#|#..#|.###', e: '....|....|.##.|#..#|####|#...|.###', f: '..##|.#..|####|.#..|.#..|.#..|.#..',
  g: '....|....|.###|#..#|#..#|.###|...#|###.', h: '#...|#...|###.|#..#|#..#|#..#|#..#', i: '#|.|#|#|#|#|#', j: '..#|...|..#|..#|..#|..#|#.#|.#.',
  k: '#...|#...|#..#|#.#.|##..|#.#.|#..#', l: '##.|.#.|.#.|.#.|.#.|.#.|..#', m: '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#',
  n: '....|....|###.|#..#|#..#|#..#|#..#', o: '....|....|.##.|#..#|#..#|#..#|.##.', p: '....|....|###.|#..#|#..#|###.|#...|#...',
  q: '....|....|.###|#..#|#..#|.###|...#|...#', r: '...|...|#.#|##.|#..|#..|#..', s: '....|....|.###|#...|.##.|...#|###.',
  t: '.#..|.#..|####|.#..|.#..|.#..|..##', u: '....|....|#..#|#..#|#..#|#..#|.###', v: '.....|.....|#...#|#...#|.#.#.|.#.#.|..#..',
  w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.', x: '....|....|#..#|#..#|.##.|#..#|#..#', y: '....|....|#..#|#..#|#..#|.###|...#|###.',
  z: '....|....|####|...#|.##.|#...|####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '.#.|##.|.#.|.#.|.#.|.#.|###', 2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
  3: '####.|....#|....#|.###.|....#|....#|####.', 4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '.###.|#....|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...', 8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|....#|.###.',
  '.': '.|.|.|.|.|.|#', ',': '..|..|..|..|..|.#|.#|#.', "'": '#|#', '-': '...|...|...|###', '_': '.....|.....|.....|.....|.....|.....|.....|#####',
  '!': '#|#|#|#|#|.|#', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', ':': '.|.|#|.|.|#', '+': '...|...|.#.|###|.#.', '/': '...#|...#|..#.|.#..|#...|#...',
  '(': '.#|#.|#.|#.|#.|#.|.#', ')': '#.|.#|.#|.#|.#|.#|#.', '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', '·': '.|.|.|#',
}).map(([ch, g]) => [ch, g.split('|')]));

// Draws text as cells of `size` px with Gen 3's light drop shadow one cell down-right; returns [svg, width].
function pixText(str, x, y, size, color, shadow) {
  const runs = [];
  let cx = 0;
  for (const ch of str) {
    if (ch === ' ') { cx += 3; continue; }
    const g = FONT[ch] ?? FONT['?'];
    g.forEach((line, j) => { for (let i = 0; i < line.length; ) {
      if (line[i] !== '#') { i++; continue; }
      let n = 0;
      while (line[i + n] === '#') n++;
      runs.push([cx + i, j, n]);
      i += n;
    } });
    cx += g[0].length + 1;
  }
  const paint = (dx, c) => `<path fill="${c}" d="${runs.map(([i, j, n]) => `M${x + (i + dx) * size} ${y + (j + dx) * size}h${n * size}v${size}h-${n * size}z`).join('')}"/>`;
  return [runs.length ? paint(1, shadow) + paint(0, color) : '', (cx - 1) * size];
}
const textWidth = (str, size) => pixText(str, 0, 0, size, '', '')[1];
// Shortens text with ".." until it fits.
function fit(str, size, max) {
  if (textWidth(str, size) <= max) return str;
  while (str.length > 1 && textWidth(str + '..', size) > max) str = str.slice(0, -1);
  return str.trimEnd() + '..';
}

// 7x7 pixel icons with their colours.
const ICONS = {
  moon: ['#f8d038', '..####.|.###...|###....|###....|###....|.###...|..####.'],
  pulse: ['#f85878', '.##.##.|#######|#######|.#####.|..###..|...#...'],
  flame: ['#f87828', '...#...|..##...|..###.#|.#####.|#######|##.####|.#####.'],
  code: ['#3890f8', '..#.#..|.#...#.|#.....#|.#...#.|..#.#..'],
};
const pixIcon = (name, x, y, size) => {
  const [c, g] = ICONS[name];
  return g.split('|').flatMap((line, j) => [...line].map((p, i) => p === '#' ? `<rect x="${x + i * size}" y="${y + j * size}" width="${size}" height="${size}" fill="${c}"/>` : '')).join('');
};

// HP bar colours per recovery level: [highlight, base], plus how many of the 60 bar cells are filled.
const HP = { high: ['#70f8a8', '#18c020', 60], mid: ['#f8e038', '#c8a800', 32], low: ['#f89878', '#e83018', 12], unknown: ['#c0c0c0', '#909090', 0] };
function hpBar(level, x, y) {
  const [hi, base, n] = HP[level], c = 2;
  const H = '#.#|#.#|###|#.#|#.#', P = '##.|#.#|##.|#..|#..';
  const label = [H, P].flatMap((g, k) => g.split('|').flatMap((line, j) => [...line].map((p, i) => p === '#' ? `<rect x="${x + 4 + (k * 4 + i) * c}" y="${y + 2 + j * c}" width="${c}" height="${c}" fill="#f8b030"/>` : ''))).join('');
  const bx = x + 26, by = y + 4;
  return `<rect x="${x + 2}" y="${y}" width="${150 - 4}" height="14" fill="#384850"/><rect x="${x}" y="${y + 2}" width="150" height="10" fill="#384850"/>${label}
<rect x="${bx}" y="${by}" width="120" height="6" fill="#506070"/>${n ? `<rect x="${bx}" y="${by}" width="${n * c}" height="6" fill="${base}"/><rect x="${bx}" y="${by}" width="${n * c}" height="2" fill="${hi}"/>` : ''}`;
}

// A Gen 3 text box: dark outline, two-tone blue band, white inside, with stepped pixel corners.
function box(W, H) {
  const step = (i, c) => `<rect x="${i + 4}" y="${i}" width="${W - 2 * i - 8}" height="${H - 2 * i}" fill="${c}"/><rect x="${i}" y="${i + 4}" width="${W - 2 * i}" height="${H - 2 * i - 8}" fill="${c}"/><rect x="${i + 2}" y="${i + 2}" width="${W - 2 * i - 4}" height="${H - 2 * i - 4}" fill="${c}"/>`;
  return step(0, '#283040') + step(2, '#a8c8f0') + step(5, '#6890c8') + step(7, '#f8f8f8');
}

// Pixel-art sprite of me in a GBA overworld style, 18x24 cells of 4px. Fills are drawn first, then every empty
// cell touching a fill becomes the dark outline; limbs in front of the body get a second outline pass.
// R/r/d hair base/highlight/shadow, H/h skin/shade, E eyes, M smile, J/j/k jersey base/shadow/highlight,
// W white, F shoes, G shoe stripe (recovery level colour), B/b/c ball base/seam/highlight.
const GW = 18, GH = 24, PX = 4;
const PALETTE = { o: '#283040', R: '#b06a38', r: '#e09a60', d: '#7a4424', H: '#f8d0a8', h: '#d89c70', E: '#283040', M: '#a04838',
  J: '#2c64d0', j: '#1c3f94', k: '#6094f0', W: '#f8f8f8', F: '#e8dcc0', B: '#f08030', b: '#a04010', c: '#f8c070',
  X: '#e04040', x: '#a02830', T: '#404850', g: '#b8c0c8', K: '#303038', P: '#485068', p: '#7880a0' };

// '_' marks see-through cells that still count as solid, e.g. inside a wheel, so they don't get outlined.
function sprite(draw, overlay = () => {}, gw = GW, gh = GH) {
  const g = Array.from({ length: gh }, () => Array(gw).fill('.'));
  const outline = (inside, onto) => {
    const out = g.map((r) => [...r]);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++)
      if (onto(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx, y + dy))) out[y][x] = 'o';
    out.forEach((r, y) => { g[y] = r; });
  };
  const pen = (grid) => {
    const set = (x, y, c) => { if (grid[y] && x >= 0 && x < gw) grid[y][x] = c; };
    return [set, (y, x0, x1, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); }];
  };
  draw(...pen(g));
  outline((x, y) => (g[y]?.[x] ?? '.') !== '.', (x, y) => g[y][x] === '.');
  const top = Array.from({ length: gh }, () => Array(gw).fill('.'));
  overlay(...pen(top));
  const on = (x, y) => (top[y]?.[x] ?? '.') !== '.';
  outline(on, (x, y) => !on(x, y));
  top.forEach((r, y) => r.forEach((c, x) => { if (c !== '.') g[y][x] = c; }));
  return g;
}
const limb = (pts, bob = 0) => (set) => pts.forEach(([x, y, c = 'H']) => set(x + 1, y + bob, c));
// Cells on a straight line between two points (Bresenham).
function cells(x0, y0, x1, y1) {
  const out = [], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  for (let err = dx + dy; ; ) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Facing the viewer: tousled hair, grin, blue #4 club tank top, shorts, white socks.
function front(set, row, { bob = 0, asleep = false, arms = true } = {}) {
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
  R(11, 2, 3, 'H'); R(12, 2, 3, 'H'); S(3, 12, 'h');
  if (arms) { S(2, 13, 'H'); S(2, 14, 'h'); S(2, 15, 'H'); }
  R(11, 12, 13, 'H'); R(12, 12, 13, 'H'); S(12, 12, 'h');
  R(17, 4, 11, 'j'); R(18, 4, 6, 'J'); R(18, 9, 11, 'J'); S(11, 18, 'j');
  R(19, 5, 6, 'H'); R(19, 9, 10, 'H'); R(20, 5, 6, 'h'); R(20, 9, 10, 'h'); R(21, 5, 6, 'W'); R(21, 9, 10, 'W');
  R(22, 4, 6, 'F'); R(22, 9, 11, 'F'); S(4, 22, 'G'); S(11, 22, 'G');
}

// Side view facing right, for running and walking.
function side(set, row, { legs, bob = 0, dx = 1, seated = false }) {
  const S = (x, y, c) => set(x + dx, y + bob, c), R = (y, a, b, c) => row(y + bob, a + dx, b + dx, c);
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
  const hem = seated ? 13 : 16;
  for (let y = 11; y <= hem; y++) { R(y, 5, 10, 'J'); S(5, y, 'j'); S(10, y, 'k'); }
  R(11, 8, 9, 'h');
  R(hem + 1, 5, 10, 'j');
  if (!seated) { R(18, 5, 10, 'J'); S(5, 18, 'j'); }
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
// On a red bike, side view, 24x24. Wheels spin (spokes alternate) and the pedals turn a quarter per frame.
function bike(k) {
  const BB = [11, 20], hip = [12, 14];
  const pedal = (a) => [BB[0] + Math.round(2 * Math.cos(a)), BB[1] + Math.round(2 * Math.sin(a))];
  const leg = (set, p, skin, shoe) => {
    const knee = [Math.round((hip[0] + p[0]) / 2) + 2, Math.round((hip[1] + p[1]) / 2) - 1];
    for (const [x, y] of [...cells(...hip, ...knee), ...cells(...knee, ...p)]) set(x, y, skin);
    const [sx, sy] = cells(...knee, ...p).at(-2) ?? knee;
    set(sx, sy, 'W'); set(p[0], p[1], shoe); set(p[0] + 1, p[1], shoe);
  };
  const a = (k * Math.PI) / 2;
  return sprite((s, r) => {
    for (const [cx, cy] of [[5, 19], [18, 19]]) {
      for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= 3.5) s(x, y, d >= 2.5 ? 'T' : '_');
      }
      const spokes = k % 2 ? [[1, 1], [-1, -1], [1, -1], [-1, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
      for (const [dx, dy] of spokes) s(cx + dx, cy + dy, 'g');
      s(cx, cy, 'K');
    }
    leg(s, pedal(a + Math.PI), 'h', 'F');
    for (const seg of [[5, 19, 11, 20], [11, 20, 9, 16], [9, 16, 5, 19], [9, 16, 16, 16], [16, 16, 18, 19], [16, 16, 16, 14]]) for (const [x, y] of cells(...seg)) s(x, y, 'X');
    s(9, 17, 'x'); s(14, 16, 'x');
    r(15, 8, 10, 'K'); s(16, 13, 'K'); s(17, 13, 'K');
    side(s, r, { legs: [], dx: 3, seated: true });
  }, (s) => {
    leg(s, pedal(a), 'H', 'F');
    for (const [x, y] of cells(12, 12, 15, 13)) s(x, y, 'H');
    s(16, 12, 'h');
  }, 24, 24);
}

// Overhead press, front view, 18x26 (two extra rows above the head for the bar).
const PRESS = { rack: [12, [[2, 13], [2, 12]]], mid: [7, [[2, 12], [1, 11], [1, 10], [2, 9], [2, 8]]], top: [1, [[2, 12], [2, 11], [2, 10], [2, 9], [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2]]] };
function press(pose) {
  const [by, arm] = PRESS[pose];
  return sprite((s, r) => front(s, r, { bob: 2, arms: false }), (s, r) => {
    r(by, 0, 17, 'g');
    for (const x of [0, 1, 16, 17]) for (let y = by - 1; y <= by + 1; y++) s(x, y, x === 1 || x === 16 ? 'p' : 'P');
    for (const [x, y] of arm) { s(x, y, 'H'); s(17 - x, y, 'H'); }
    s(2, by, 'H'); s(15, by, 'H');
  }, 18, 26);
}

// [loop seconds, frames, backdrop, whether the backdrop scrolls, shadow width in cells]
const SCENES = {
  cycle: [0.5, [0, 1, 2, 3].map(bike), 'road', true, 20],
  lift: [2.4, ['rack', 'mid', 'top', 'top', 'mid', 'rack'].map(press), 'gym', false, 12],
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

// Backdrops are SVG patterns of 4px cells: route grass, a cycling road, a wooden gym floor or gym mats.
function backdrop(kind, x, y, w, h, dur, scroll) {
  const cell = (cx, cy, c) => `<rect x="${cx * PX}" y="${cy * PX}" width="${PX}" height="${PX}" fill="${c}"/>`;
  if (kind === 'gym') {
    return `<pattern id="bd" width="${8 * PX}" height="${8 * PX}" patternUnits="userSpaceOnUse" x="${x}" y="${y}"><rect width="${8 * PX}" height="${8 * PX}" fill="#98a8c0"/>
<rect width="${8 * PX}" height="${PX}" fill="#7888a0"/><rect width="${PX}" height="${8 * PX}" fill="#7888a0"/>${cell(1, 1, '#b8c8e0')}</pattern>
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#bd)"/>`;
  }
  if (kind === 'road') {
    // Grass verge on top, asphalt with a kerb line and a dashed centre line below; scrolls like the grass.
    const top = y + 15 * PX, anim = scroll ? ` class="fx" style="animation:scroll ${dur}s steps(2,end) infinite"` : '';
    return `<pattern id="bd" width="${8 * PX}" height="${8 * PX}" patternUnits="userSpaceOnUse" x="${x}" y="${y}"><rect width="${8 * PX}" height="${8 * PX}" fill="#90d070"/>${cell(1, 1, '#58a840')}${cell(2, 0, '#58a840')}${cell(5, 4, '#58a840')}${cell(6, 3, '#58a840')}</pattern>
<pattern id="rd" width="${8 * PX}" height="${8 * PX}" patternUnits="userSpaceOnUse" x="${x}" y="${top}"><rect width="${8 * PX}" height="${8 * PX}" fill="#a0a0a8"/>${cell(2, 3, '#b0b0b8')}${cell(6, 6, '#909098')}</pattern>
<g${anim}><rect x="${x}" y="${y}" width="${w + 8 * PX}" height="${h}" fill="url(#bd)"/><rect x="${x}" y="${top}" width="${w + 8 * PX}" height="${y + h - top}" fill="url(#rd)"/>
<rect x="${x}" y="${top}" width="${w + 8 * PX}" height="${PX}" fill="#e0e0e0"/>${Array.from({ length: 5 }, (_, i) => `<rect x="${x + i * 8 * PX}" y="${top + 9 * PX}" width="${4 * PX}" height="${PX}" fill="#f8f8f8"/>`).join('')}</g>`;
  }
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
  const [dur, frames, kind, scroll, shadow = 10] = SCENES[name];
  const n = frames.length, w = 116, h = 108, px = x - 10, py = y - 6, gw = frames[0][0].length, gh = frames[0].length;
  const ox = px + Math.round((w - gw * PX) / 2 / PX) * PX, oy = py + Math.max(3, h - 4 - gh * PX);
  const body = frames.map((g, k) => {
    // One path per colour, made of horizontal runs of cells, keeps the file small.
    const runs = {};
    g.forEach((r, j) => r.forEach((c, i) => {
      if (c === '.' || c === '_' || r[i - 1] === c) return;
      let n = 1;
      while (r[i + n] === c) n++;
      (runs[c] ??= []).push(`M${ox + i * PX} ${oy + j * PX}h${n * PX}v${PX}h-${n * PX}z`);
    }));
    const rects = Object.entries(runs).map(([c, d]) => `<path fill="${c === 'G' ? HP[level][1] : PALETTE[c]}" d="${d.join('')}"/>`).join('');
    return `<g class="fr${k ? '' : ' fr0'}" style="animation:flip${n} ${dur}s steps(1,end) infinite;animation-delay:${(-(n - k) * dur / n).toFixed(3)}s">${rects}</g>`;
  }).join('');
  return `<style>@keyframes flip${n}{0%{opacity:1}${+(100 / n).toFixed(2)}%{opacity:0}100%{opacity:0}}@keyframes scroll{to{transform:translateX(-${8 * PX}px)}}
.fr{opacity:0}@media (prefers-reduced-motion:reduce){.fr,.fx{animation:none!important}.fr0{opacity:1}}</style>
<clipPath id="panel"><rect x="${px}" y="${py}" width="${w}" height="${h}" rx="10"/></clipPath>
<g clip-path="url(#panel)" shape-rendering="crispEdges">${backdrop(kind, px, py, w, h, dur, scroll)}
<rect x="${ox + ((gw - shadow) / 2) * PX}" y="${oy + (gh - 2) * PX}" width="${shadow * PX}" height="${2 * PX}" fill="#000" fill-opacity=".22"/>${body}</g>
<rect x="${px}" y="${py}" width="${w}" height="${h}" rx="10" fill="none" stroke="#283040" stroke-width="2"/>`;
}

export function card(summary) {
  const { level, heading, rows, scene } = summary;
  const W = 540, ink = '#404850', shade = '#d0d0c8', textMax = W - 134 - 12 - 46, rowStart = 84, step = 28;
  const H = Math.max(rowStart + rows.length * step + 6, scene ? 140 : 0);
  const body = rows.map((r, i) => {
    const y = rowStart + i * step;
    return pixIcon(r.icon, 24, y, 2) + pixText(fit(r.text, 2, textMax), 46, y, 2, ink, shade)[0];
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(altText(summary))}">
<g shape-rendering="crispEdges">${box(W, H)}
${pixText(fit(heading, 3, textMax + 46 - 24), 24, 20, 3, ink, shade)[0]}
${hpBar(level, 24, 52)}
${body}</g>
${scene ? figure(scene, level, W - 124, (H - 108) / 2 + 6) : ''}
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
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'yoga')], now }).scene, 'idle');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'basketball')], now }).scene, 'hoops');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'running')], now }).scene, 'run');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'cycling')], now }).scene, 'cycle');
  for (const sc of Object.keys(SCENES)) assert.match(card({ ...s, scene: sc }), /class="fr fr0"/);

  assert.match(card({ level: 'low', heading: 'a <b> & "c"', rows: [] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  // HP bar fill tracks the level; long text is shortened to fit beside the sprite.
  assert.match(card(summarize({ recovery: 50, sleep: null, workouts: [], now })), /width="64" height="6" fill="#c8a800"/);
  assert.equal(fit('Tinkering with a-very-long-repository-name-indeed', 2, 200).endsWith('..'), true);
  assert.ok(textWidth(fit('Tinkering with a-very-long-repository-name-indeed', 2, 200), 2) <= 200);
  console.log('ok');
} else {
  await main();
}
