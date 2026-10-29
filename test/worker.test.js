import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import worker, { run } from '../src/worker.js';

const README = '# Hi\n<!-- VIBE:START -->\n<img src="old">\n<!-- VIBE:END -->\n';
let kv, calls, gh;

// A tiny fake of the WHOOP and GitHub APIs, enough for one run.
function fakeFetch(url, opts = {}) {
  const u = new URL(url), method = opts.method ?? 'GET';
  calls.push(`${method} ${u.pathname}`);
  const json = (b) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/oauth/oauth2/token') {
    assert.equal(opts.body.get('refresh_token'), 'rt-1');
    return json({ access_token: 'at', refresh_token: 'rt-2' });
  }
  if (u.pathname.endsWith('/recovery')) return json({ records: [{ score: { recovery_score: 80 } }] });
  if (u.pathname.endsWith('/activity/sleep')) return json({ records: [{ score: { sleep_performance_percentage: 70 } }] });
  if (u.pathname.endsWith('/activity/workout')) return json({ records: [{ start: new Date(Date.now() - 864e5).toISOString(), sport_name: 'basketball' }] });
  if (u.hostname !== 'api.github.com') throw new Error(`unexpected ${url}`);
  assert.equal(opts.headers['User-Agent'], 'vibe-worker');
  if (u.pathname.includes('/events/public')) return json([{ type: 'PushEvent', repo: { name: 'ItsValerius/kg-eventplan' } }]);
  if (u.pathname === '/repos/ItsValerius/ItsValerius/git/ref/heads/main') return json({ object: { sha: gh.refs.shift() ?? gh.head } });
  if (u.pathname === '/repos/ItsValerius/ItsValerius/git/commits/head' && method === 'GET') return json(gh.headCommit);
  if (u.pathname === '/repos/ItsValerius/ItsValerius/contents/README.md') return new Response(gh.readme);
  if (u.pathname.endsWith('/git/trees')) { gh.tree = JSON.parse(opts.body); return json({ sha: 'tree2' }); }
  if (u.pathname.endsWith('/git/commits') && method === 'POST') { gh.commit = JSON.parse(opts.body); return json({ sha: 'new' }); }
  if (u.pathname.endsWith('/git/refs/heads/main') && method === 'PATCH') { gh.patch = JSON.parse(opts.body); return json({}); }
  throw new Error(`unexpected ${method} ${url}`);
}

const env = () => ({
  VIBE_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) },
  WHOOP_CLIENT_ID: 'id', WHOOP_CLIENT_SECRET: 'secret', GITHUB_TOKEN: 'ghp', ADMIN_TOKEN: 'admin',
});

beforeEach(() => {
  kv = new Map([['whoop_refresh_token', 'rt-1']]);
  calls = [];
  gh = { head: 'head', refs: [], readme: README,
    headCommit: { message: 'vibe update\n', author: { name: 'github-actions[bot]' }, parents: [{ sha: 'parent' }], tree: { sha: 'tree1' } } };
  globalThis.fetch = fakeFetch;
});

test('amends the previous bot commit and rotates the token', async () => {
  const out = await run(env());
  assert.match(out, /^updated: Fully charged · Decent night · Basketball this week · Tinkering with kg-eventplan$/);
  assert.equal(kv.get('whoop_refresh_token'), 'rt-2');
  assert.equal(gh.tree.base_tree, 'tree1');
  assert.deepEqual(gh.tree.tree.map((t) => t.path), ['README.md', 'vibe.svg']);
  assert.match(gh.tree.tree[0].content, /<!-- VIBE:START -->\n<img src="https:\/\/raw\.githubusercontent\.com\/ItsValerius\/ItsValerius\/main\/vibe\.svg\?v=[0-9a-f]{8}" alt="Fully charged/);
  assert.match(gh.tree.tree[1].content, /^<svg /);
  assert.deepEqual(gh.commit.parents, ['parent']);
  assert.equal(gh.commit.author.name, 'vibe-worker');
  assert.deepEqual(gh.patch, { sha: 'new', force: true });
});

test('stacks a new commit on top of a human commit, without force', async () => {
  gh.headCommit = { ...gh.headCommit, message: 'Update README', author: { name: 'Valentin' } };
  await run(env());
  assert.deepEqual(gh.commit.parents, ['head']);
  assert.deepEqual(gh.patch, { sha: 'new', force: false });
});

test('skips the commit when the card is unchanged', async () => {
  await run(env());
  gh.readme = gh.tree.tree[0].content;
  kv.set('whoop_refresh_token', 'rt-1');
  gh.patch = undefined;
  assert.match(await run(env()), /^unchanged:/);
  assert.equal(gh.patch, undefined);
});

test('does not force over a push that landed mid-run', async () => {
  gh.refs = ['head', 'someone-elses-push'];
  await assert.rejects(run(env()), /main moved/);
  assert.equal(gh.patch, undefined);
  // The rotated token is saved even though the run failed.
  assert.equal(kv.get('whoop_refresh_token'), 'rt-2');
});

test('admin endpoints need the token', async () => {
  const req = (path, auth, body) => new Request(`https://vibe.example${path}`, { method: 'POST', body, headers: auth ? { Authorization: auth } : {} });
  assert.equal((await worker.fetch(req('/seed', null, 'x'), env())).status, 404);
  assert.equal((await worker.fetch(req('/seed', 'Bearer wrong', 'x'), env())).status, 404);
  assert.equal((await worker.fetch(req('/seed', 'Bearer admin', ' rt-9\n'), env())).status, 200);
  assert.equal(kv.get('whoop_refresh_token'), 'rt-9');
  assert.equal((await worker.fetch(req('/seed', 'Bearer admin', 'x'), { ...env(), ADMIN_TOKEN: undefined })).status, 404);
});
