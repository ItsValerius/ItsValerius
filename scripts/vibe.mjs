// Turns WHOOP data into a deliberately vague status line. No raw numbers ever leave this file.
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.prod.whoop.com/developer/v2';

// Coarse buckets on purpose: 3 levels each, so the README can't be used to track trends.
export function vibe({ recovery, sleep, workouts }) {
  const energy = recovery == null ? '🌫️ signal lost' : recovery >= 67 ? '🔋 fully charged' : recovery >= 34 ? '🪫 cruising' : '🐢 low-power mode';
  const rest = sleep == null ? '' : sleep >= 85 ? '😴 slept like a log' : sleep >= 60 ? '☕ decent night' : '☕☕ running on coffee';
  const move = workouts >= 3 ? '🏃 on a streak' : workouts >= 1 ? '🚶 moving' : '🛋️ rest week';
  return [energy, rest, move].filter(Boolean).join(' · ');
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
  return (await res.json()).access_token;
}

async function get(path, accessToken) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()).records ?? [];
}

async function main() {
  const at = await token();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [rec, slp, wo] = await Promise.all([
    get('/recovery?limit=1', at),
    get('/activity/sleep?limit=1', at),
    get(`/activity/workout?limit=25&start=${weekAgo}`, at),
  ]);
  const line = vibe({
    recovery: rec[0]?.score?.recovery_score ?? null,
    sleep: slp[0]?.score?.sleep_performance_percentage ?? null,
    workouts: wo.length,
  });
  const readme = readFileSync('README.md', 'utf8');
  writeFileSync('README.md', readme.replace(/(<!-- VIBE:START -->)[\s\S]*?(<!-- VIBE:END -->)/, `$1\n${line}\n$2`));
  console.log(line);
}

if (process.argv[2] === 'test') {
  const { strict: assert } = await import('node:assert');
  assert.equal(vibe({ recovery: 80, sleep: 90, workouts: 3 }), '🔋 fully charged · 😴 slept like a log · 🏃 on a streak');
  assert.equal(vibe({ recovery: 10, sleep: null, workouts: 0 }), '🐢 low-power mode · 🛋️ rest week');
  assert.equal(vibe({ recovery: null, sleep: 50, workouts: 1 }), '🌫️ signal lost · ☕☕ running on coffee · 🚶 moving');
  console.log('ok');
} else {
  await main();
}
