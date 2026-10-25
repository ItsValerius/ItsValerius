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
  // The most recent workout picks the sport, whatever was done most this week.
  const top = thisWeek.reduce((a, w) => (!a || Date.parse(w.start) > Date.parse(a.start) ? w : a), null)?.sport_name;
  const sport = top ? top.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';
  // The card draws the sport, so its text drops the name; the alt text keeps it.
  rows.push(thisWeek.length >= 3 ? { icon: 'pulse', text: 'On a roll this week', alt: `${sport}, on a roll` }
    : thisWeek.length >= 1 ? { icon: 'pulse', text: 'Moving this week', alt: `${sport} this week` }
    : { icon: 'pulse', text: 'Rest week' });
  const scene = !top ? 'rest' : /basketball/.test(top) ? 'hoops' : /run|jog|track/.test(top) ? 'run' : /walk|hik/.test(top) ? 'walk'
    : /cycl|bik|spin/.test(top) ? 'cycle' : /badminton/.test(top) ? 'badminton' : /lift|strength|weight|power|crossfit|fitness/.test(top) ? 'lift' : 'idle';

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

// Draws text as cells of `size` px with Gen 3's drop shadow one cell down-right; returns [svg, width].
// `color` and `shadow` are class names, so the card's style can recolour them for dark mode.
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
  const paint = (dx, c) => `<path class="${c}" d="${runs.map(([i, j, n]) => `M${x + (i + dx) * size} ${y + (j + dx) * size}h${n * size}v${size}h-${n * size}z`).join('')}"/>`;
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

// A Gen 3 text box: dark outline, two-tone blue band, white inside, with stepped pixel corners.
function box(W, H) {
  const step = (i, c) => `<g class="${c}"><rect x="${i + 4}" y="${i}" width="${W - 2 * i - 8}" height="${H - 2 * i}"/><rect x="${i}" y="${i + 4}" width="${W - 2 * i}" height="${H - 2 * i - 8}"/><rect x="${i + 2}" y="${i + 2}" width="${W - 2 * i - 4}" height="${H - 2 * i - 4}"/></g>`;
  return step(0, 'b0') + step(2, 'b1') + step(5, 'b2') + step(7, 'b3');
}

// Gen 3 battle-box HP bar in 2px cells: a yellow "HP" tag, then a 48-cell bar filled by recovery level.
function hpBar(level, x, y) {
  const cell = (cx, cy, w, h, paint) => `<rect x="${x + cx * 2}" y="${y + cy * 2}" width="${w * 2}" height="${h * 2}" ${paint}/>`;
  const glyph = ['1.1.111', '1.1.1.1', '111.111', '1.1.1..', '1.1.1..'];
  const tag = glyph.flatMap((r, j) => [...r].map((c, i) => (c === '1' ? cell(2 + i, 1 + j, 1, 1, 'fill="#f8d030"') : ''))).join('');
  const fill = { unknown: 0, low: 12, mid: 24, high: 48 }[level];
  const bar = fill ? cell(10, 2, fill, 3, `class="lv-${level}"`) + cell(10, 4, fill, 1, 'fill="#000" fill-opacity=".2"') : '';
  return `<g shape-rendering="crispEdges">${cell(1, 0, 58, 7, 'fill="#283040"')}${cell(0, 1, 60, 5, 'fill="#283040"')}${tag}${cell(10, 2, 48, 3, 'fill="#506070"')}${bar}</g>`;
}

// Pixel-art sprite of me in a GBA overworld style, 18x24 cells of 4px. Fills are drawn first, then every empty
// cell touching a fill becomes the dark outline; limbs in front of the body get a second outline pass.
// R/r/d hair base/highlight/shadow, H/h skin/shade, E eyes, J/j/k jersey base/shadow/highlight,
// W white, F shoes, G shoe stripe (recovery level colour), B/b/c ball base/seam/highlight, D dark steel, T/S/s tyre/rim/spoke,
// K/X bike and racket red/shade, Q/q/w quilt base/shadow/highlight.
const GW = 18, GH = 24, PX = 4;
const PALETTE = { o: '#283040', R: '#b06a38', r: '#e09a60', d: '#7a4424', H: '#f8d0a8', h: '#d89c70', E: '#283040',
  J: '#2c64d0', j: '#1c3f94', k: '#6094f0', W: '#f8f8f8', F: '#e8dcc0', B: '#f08030', b: '#a04010', c: '#f8c070',
  D: '#485060', T: '#404858', S: '#c8d0d8', s: '#8890a0', K: '#e04040', X: '#a02830', Q: '#f8b830', q: '#c88010', w: '#f8e070' };

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

// Facing the viewer: tousled hair, blue #4 club tank top, shorts, white socks.
// arms: true for both, 'left' to leave the right arm to an overlay, false for none.
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
  R(10, 5, 10, 'h');
  R(11, 4, 11, 'J'); R(11, 6, 9, 'h'); S(4, 11, 'k');
  for (let y = 12; y <= 16; y++) { R(y, 4, 11, 'J'); S(4, y, 'k'); S(11, y, 'j'); }
  R(12, 7, 8, 'h');
  // The number 4 and the club badge.
  for (const [x, y] of [[5, 13], [7, 13], [5, 14], [7, 14], [5, 15], [6, 15], [7, 15], [7, 16]]) S(x, y, 'W');
  S(10, 13, 'W');
  if (arms) { R(11, 2, 3, 'H'); R(12, 2, 3, 'H'); S(2, 13, 'H'); S(2, 14, 'h'); S(2, 15, 'H'); S(3, 12, 'h'); }
  if (arms === true) { R(11, 12, 13, 'H'); R(12, 12, 13, 'H'); S(12, 12, 'h'); }
  R(17, 4, 11, 'j'); R(18, 4, 6, 'J'); R(18, 9, 11, 'J'); S(11, 18, 'j');
  R(19, 5, 6, 'H'); R(19, 9, 10, 'H'); R(20, 5, 6, 'h'); R(20, 9, 10, 'h'); R(21, 5, 6, 'W'); R(21, 9, 10, 'W');
  R(22, 4, 6, 'F'); R(22, 9, 11, 'F'); S(4, 22, 'G'); S(11, 22, 'G');
}

// Side view facing right: head, then the standing torso and legs for running and walking.
function sideHead(S, R) {
  S(6, 0, 'R'); S(9, 0, 'R'); S(3, 1, 'R');
  R(1, 4, 10, 'R'); S(7, 1, 'r');
  R(2, 2, 11, 'R'); S(6, 2, 'r'); S(7, 2, 'r'); S(8, 2, 'r');
  R(3, 2, 12, 'R'); S(5, 3, 'r'); S(3, 3, 'd');
  R(4, 2, 12, 'R'); S(3, 4, 'd'); S(7, 4, 'd'); S(10, 4, 'd');
  R(5, 3, 12, 'R'); R(5, 8, 11, 'H'); S(12, 5, 'R');
  R(6, 3, 12, 'H'); R(6, 3, 6, 'R'); S(4, 6, 'd');
  R(7, 4, 13, 'H'); S(4, 7, 'R'); S(5, 7, 'd'); S(7, 7, 'h'); S(7, 6, 'h'); S(11, 6, 'E'); S(11, 7, 'E');
  R(8, 4, 13, 'H'); S(4, 8, 'd');
  R(9, 5, 12, 'H'); S(12, 9, 'h');
  R(10, 6, 11, 'h');
}
function side(set, row, { legs, bob = 0 }) {
  const S = (x, y, c) => set(x + 1, y + bob, c), R = (y, a, b, c) => row(y + bob, a + 1, b + 1, c);
  sideHead(S, R);
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
const Z = ['WWWW', '..W.', '.W..', 'WWWW'];
const stamp = (s, art, x, y) => art.forEach((line, j) => [...line].forEach((c, i) => c !== '.' && s(x + i, y + j, c)));

// Bike wheel of radius 3 around (cx, cy); the spokes alternate between + and x so the wheel turns.
function wheel(S, cx, cy, k) {
  const rim = ['..TTT..', '.TSSST.', 'TSSSSST', 'TSSDSST', 'TSSSSST', '.TSSST.', '..TTT..'];
  rim.forEach((line, j) => [...line].forEach((c, i) => c !== '.' && S(cx - 3 + i, cy - 3 + j, c)));
  for (const [dx, dy] of k % 2 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[0, -2], [0, 2], [-2, 0], [2, 0]]) S(cx + dx, cy + dy, 's');
}
// Riding a red bike side-on like the Gen 3 Mach Bike; k is the pedal phase, a quarter turn per frame.
function cyclist(set, row, k) {
  const S = (x, y, c) => set(x + 1, y, c), R = (y, a, b, c) => row(y, a + 1, b + 1, c);
  wheel(S, 2, 20, k); wheel(S, 13, 20, k);
  R(17, 6, 12, 'K'); R(18, 6, 11, 'X'); S(12, 18, 'K'); S(13, 19, 'K'); S(6, 19, 'X'); R(20, 3, 6, 'X');
  R(16, 4, 6, 'D'); S(12, 15, 'D'); S(12, 14, 'D'); S(13, 14, 'D'); S(7, 20, 'D');
  sideHead(S, R);
  for (let y = 11; y <= 14; y++) { R(y, 5, 10, 'J'); S(5, y, 'j'); S(10, y, 'k'); }
  R(11, 8, 9, 'h'); R(15, 4, 10, 'J'); S(4, 15, 'j');
  // The near leg is drawn with the bike so they share one outline.
  for (const [x, y, c] of PEDAL[k]) S(x, y, c);
}
const PEDAL = [
  [[11, 15, 'J'], [11, 16, 'H'], [12, 16, 'H'], [11, 17, 'H'], [12, 17, 'h'], [11, 18, 'h'], [11, 19, 'W'], [10, 20, 'F'], [11, 20, 'F'], [12, 20, 'G']],
  [[11, 15, 'J'], [11, 16, 'H'], [12, 16, 'h'], [10, 17, 'H'], [11, 17, 'h'], [10, 18, 'h'], [9, 19, 'W'], [10, 19, 'W'], [8, 20, 'F'], [9, 20, 'F'], [10, 20, 'G']],
  [[10, 15, 'J'], [10, 16, 'H'], [11, 16, 'h'], [9, 17, 'H'], [10, 17, 'h'], [8, 18, 'H'], [9, 18, 'h'], [7, 19, 'W'], [5, 20, 'F'], [6, 20, 'F'], [7, 20, 'G']],
  [[11, 14, 'J'], [11, 15, 'H'], [12, 15, 'h'], [10, 16, 'H'], [11, 16, 'h'], [9, 17, 'H'], [10, 17, 'h'], [8, 17, 'W'], [7, 18, 'F'], [8, 18, 'F'], [9, 18, 'G']],
];

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
  cycle: [0.6, [0, 1, 2, 3].map((k) => sprite((s, r) => cyclist(s, r, k),
    limb([[9, 12], [10, 13], [11, 13], [12, 13, 'h']]))), 'grass', true],
  // Back squat: bar across the shoulders, sinking two cells with the knees out.
  lift: [1.6, [0, 1, 2, 1].map((d) => sprite((s, r) => {
    front(s, r, { bob: d, arms: false });
    // Bent legs replace the straight ones below the shorts.
    if (d) {
      for (let y = 18 + d; y <= 23; y++) r(y, 0, 17, '.');
      const knee = d === 2 ? 1 : 0;
      for (const x of [4 - knee, 10 + knee]) { r(19 + d, x + 1, x + 2, 'H'); r(20 + d, x + 1, x + 2, 'h'); }
      if (d < 2) { r(21 + d, 5, 6, 'W'); r(21 + d, 10, 11, 'W'); }
      r(22, 4, 6, 'F'); r(22, 10, 12, 'F'); s(4, 22, 'G'); s(12, 22, 'G');
    }
  }, (s) => {
    const y = 10 + d;
    for (let x = 0; x <= 17; x++) s(x, y, 'S');
    for (const x of [0, 1, 16, 17]) for (let j = -2; j <= 2; j++) s(x, y + j, 'D');
    limb([[2, y + 1], [2, y, 'h'], [12, y + 1], [12, y, 'h']])(s);
  })), 'court', false],
  // Overhead smash: the shuttle drops in from the left, the racket comes over, then follows through low.
  badminton: [1.2, [[1, 7, 'back'], [7, 0, 'up'], [11, 0, 'hit'], [2, 1, 'through']].map(([sx, sy, pose]) => sprite((s, r) => front(s, r, { arms: 'left' }), (s) => {
    const RACKET = ['.KK.', 'KsSK', 'KSsK', 'KsSK', '.KK.'];
    if (pose === 'through') {
      limb(RIGHT_ARM_DOWN)(s); s(14, 16, 'D'); s(14, 17, 'D'); stamp(s, RACKET, 13, 18);
    } else {
      limb({ back: [[13, 11], [14, 10], [15, 9, 'h']], up: [[13, 11], [13, 10], [14, 9, 'h']], hit: [[13, 11], [13, 10], [13, 9, 'h']] }[pose])(s);
      const [hx, hy] = { back: [16, 8], up: [15, 8], hit: [14, 8] }[pose];
      s(hx, hy - 1, 'D'); stamp(s, RACKET, hx - 1 - (pose === 'hit'), hy - 7);
    }
    stamp(s, ['W.W', '.c.'], sx, sy);
  })), 'court', false],
  idle: [0.9, [0, -1].map((bob) => sprite((s, r) => front(s, r, { bob }), limb(RIGHT_ARM_DOWN, bob))), 'grass', false],
  // Asleep in bed, seen from above like the Gen 3 bedrooms; the quilt swells on each breath and a z floats up.
  rest: [2.4, [0, 1, 2, 3].map((k) => sprite((s, r) => {
    for (let y = 5; y <= 11; y++) r(y, 0, 17, y === 11 ? 'F' : 'W');
    front(s, r, { asleep: true, bob: 3 });
    const swell = k % 2;
    r(13, 1, 16, 'W'); r(14, 1, 16, 'F');
    for (let y = 15; y <= 22; y++) {
      r(y, 1 - (swell && y >= 16 && y <= 18), 16 + (swell && y >= 16 && y <= 18), 'Q');
      for (let x = 2; x <= 15; x++) if (((x >> 1) + (y >> 1)) % 2) s(x, y, 'w');
      s(16, y, 'q');
    }
    r(22, 1, 16, 'q');
  }, (s) => stamp(s, Z, 13, 3 - k))), 'court', false],
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
  const tuft = [[1, 1, '#70b858'], [2, 0, '#70b858'], [3, 1, '#70b858'], [5, 4, '#70b858'], [6, 3, '#70b858'], [7, 4, '#70b858'], [2, 6, '#c8f0a0'], [6, 0, '#c8f0a0']];
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
    // One path per colour, made of horizontal runs of cells, keeps the file small.
    const runs = {};
    g.forEach((r, j) => r.forEach((c, i) => {
      if (c === '.' || r[i - 1] === c) return;
      let n = 1;
      while (r[i + n] === c) n++;
      (runs[c] ??= []).push(`M${ox + i * PX} ${oy + j * PX}h${n * PX}v${PX}h-${n * PX}z`);
    }));
    const rects = Object.entries(runs).map(([c, d]) => `<path ${c === 'G' ? `class="shoe lv-${level}"` : `fill="${PALETTE[c]}"`} d="${d.join('')}"/>`).join('');
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
  const W = 540, ink = 'ink', shade = 'shade', textMax = W - 134 - 12 - 46, rowStart = 84, step = 28;
  const H = Math.max(rowStart + rows.length * step + 6, scene ? 140 : 0);
  const body = rows.map((r, i) => {
    const y = rowStart + i * step;
    return pixIcon(r.icon, 24, y, 2) + pixText(fit(r.text, 2, textMax), 46, y, 2, ink, shade)[0];
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(altText(summary))}">
<style>.lv-high{fill:#70f8a8}.lv-mid{fill:#f8e038}.lv-low{fill:#f85838}
.b0{fill:#283040}.b1{fill:#a8c8f0}.b2{fill:#6890c8}.b3{fill:#f8f8f8}.ink{fill:#404850}.shade{fill:#d0d0c8}
@media (prefers-color-scheme:dark){.b0{fill:#8098c8}.b1{fill:#3a5890}.b2{fill:#24406c}.b3{fill:#161c28}.ink{fill:#e8ecf4}.shade{fill:#000}}</style>
<g shape-rendering="crispEdges">${box(W, H)}
${pixText(fit(heading, 3, textMax + 22), 24, 20, 3, ink, shade)[0]}
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
  // Content hash in the URL so GitHub's image cache can't serve a stale card. The URL is absolute because on the
  // profile page a relative src redirects to raw.githubusercontent.com and drops the query.
  const v = createHash('sha256').update(svg).digest('hex').slice(0, 8);
  const readme = readFileSync('README.md', 'utf8');
  const img = `<img src="https://raw.githubusercontent.com/${USER}/${USER}/main/vibe.svg?v=${v}" alt="${esc(altText(summary))}">`;
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
  // The streak breaks on an empty current week.
  assert.equal(altText(s), 'Low-power mode · Rest week');

  s = summarize({ recovery: null, sleep: 50, workouts: Array.from({ length: 13 }, (_, i) => ago(i * 7 + 1, 'functional-fitness')), now });
  assert.equal(altText(s), 'Signal lost · Running on coffee · Functional fitness this week · 12+ weeks active in a row');

  assert.equal(s.scene, 'lift');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'cycling')], now }).rows[0].text, 'Moving this week');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [], now }).scene, 'rest');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'yoga')], now }).scene, 'idle');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'basketball')], now }).scene, 'hoops');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'running')], now }).scene, 'run');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'badminton')], now }).scene, 'badminton');
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(1, 'cycling')], now }).scene, 'cycle');
  // Order of the API response doesn't matter; the latest start wins over a more frequent sport.
  assert.equal(summarize({ recovery: 50, sleep: null, workouts: [ago(2, 'cycling'), ago(0.5, 'basketball'), ago(3, 'cycling'), ago(4, 'cycling')], now }).scene, 'hoops');
  for (const sc of ['run', 'walk', 'hoops', 'idle', 'rest', 'cycle', 'lift', 'badminton']) assert.match(card({ ...s, scene: sc }), /class="fr fr0"/);

  assert.match(card({ level: 'low', heading: 'a <b> & "c"', rows: [] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.match(card(summarize({ recovery: 50, sleep: null, workouts: [], now })), /width="48" height="6" class="lv-mid"/);
  assert.doesNotMatch(card({ level: 'unknown', heading: 'x', rows: [] }), /class="lv-unknown"/);
  // The box and text follow the viewer's colour scheme.
  assert.match(card({ level: 'mid', heading: 'x', rows: [] }), /@media \(prefers-color-scheme:dark\)\{\.b0/);
  // Long text is shortened to fit beside the sprite.
  assert.ok(fit('Tinkering with a-very-long-repository-name-indeed', 2, 200).endsWith('..'));
  assert.ok(textWidth(fit('Tinkering with a-very-long-repository-name-indeed', 2, 200), 2) <= 200);
  console.log('ok');
} else {
  await main();
}
