import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { summarize, altText, card, fit, textWidth } from '../src/card.js';

const DAY = 864e5;
const now = Date.parse('2026-10-19T12:00:00Z');
const ago = (d, sport = 'running') => ({ start: new Date(now - d * DAY).toISOString(), sport_name: sport });

test('summary text', () => {
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
});

test('scenes', () => {
  const scene = (workouts) => summarize({ recovery: 50, sleep: null, workouts, now }).scene;
  assert.equal(scene([]), 'rest');
  assert.equal(scene([ago(1, 'yoga')]), 'idle');
  assert.equal(scene([ago(1, 'basketball')]), 'hoops');
  assert.equal(scene([ago(1, 'running')]), 'run');
  assert.equal(scene([ago(1, 'badminton')]), 'badminton');
  assert.equal(scene([ago(1, 'cycling')]), 'cycle');
  // Order of the API response doesn't matter; the latest start wins over a more frequent sport.
  assert.equal(scene([ago(2, 'cycling'), ago(0.5, 'basketball'), ago(3, 'cycling'), ago(4, 'cycling')]), 'hoops');
});

test('card', () => {
  const s = summarize({ recovery: null, sleep: 50, workouts: [], now });
  for (const sc of ['run', 'walk', 'hoops', 'idle', 'rest', 'cycle', 'lift', 'badminton']) assert.match(card({ ...s, scene: sc }), /class="fr fr0"/);
  assert.match(card({ level: 'low', heading: 'a <b> & "c"', rows: [] }), /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.match(card(summarize({ recovery: 50, sleep: null, workouts: [], now })), /width="48" height="6" class="lv-mid"/);
  assert.doesNotMatch(card({ level: 'unknown', heading: 'x', rows: [] }), /class="lv-unknown"/);
  // The box and text follow the viewer's colour scheme.
  assert.match(card({ level: 'mid', heading: 'x', rows: [] }), /@media \(prefers-color-scheme:dark\)\{\.b0/);
  // Long text is shortened to fit beside the sprite.
  assert.ok(fit('Tinkering with a-very-long-repository-name-indeed', 2, 200).endsWith('..'));
  assert.ok(textWidth(fit('Tinkering with a-very-long-repository-name-indeed', 2, 200), 2) <= 200);
});
