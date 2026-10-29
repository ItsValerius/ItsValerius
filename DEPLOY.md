# Deploying the vibe card

The card is refreshed by a Cloudflare Worker (`src/worker.js`) on a daily cron at 08:07 UTC. It reads WHOOP,
renders `vibe.svg` (`src/card.js`), and commits it with the README through the GitHub API, replacing the
previous `vibe update` commit so history keeps only the latest card.

## Setup

```sh
npm install
npx wrangler login
npx wrangler kv namespace create VIBE_KV   # paste the id into wrangler.jsonc
npx wrangler secret put WHOOP_CLIENT_ID
npx wrangler secret put WHOOP_CLIENT_SECRET
npx wrangler secret put GITHUB_TOKEN       # fine-grained PAT, this repo only, Contents: read and write
npx wrangler secret put ADMIN_TOKEN        # any long random string, e.g. `openssl rand -hex 32`
npm run deploy
```

## Moving the WHOOP token over from GitHub Actions

WHOOP rotates the refresh token on every use, and the current one only exists as a GitHub secret.

1. Deploy the Worker as above.
2. Merge this change, so the old scheduled Action is gone and can't spend the token again.
3. In the repo settings, add the secret `VIBE_ADMIN_TOKEN` (same value as `ADMIN_TOKEN`) and the variable
   `VIBE_WORKER_URL` (e.g. `https://vibe.<your-subdomain>.workers.dev`).
4. Run **Actions → Hand WHOOP token to the Worker** once.
5. Check it works: `curl -X POST "$VIBE_WORKER_URL/run" -H "Authorization: Bearer $ADMIN_TOKEN"`
6. Clean up: delete `.github/workflows/handoff-whoop-token.yml` and the repo secrets `WHOOP_CLIENT_ID`,
   `WHOOP_CLIENT_SECRET`, `WHOOP_REFRESH_TOKEN`, `SECRETS_PAT` and `VIBE_ADMIN_TOKEN`, and revoke the PAT
   behind `SECRETS_PAT`.

If the token is ever lost, re-authorize the WHOOP app and store the new refresh token with the same
`/seed` request: `curl -X POST "$VIBE_WORKER_URL/seed" -H "Authorization: Bearer $ADMIN_TOKEN" --data-binary "<token>"`.

## Everyday use

- `npm test` runs the tests.
- `npm run dev`, then open `http://localhost:8787/__scheduled`, runs the cron locally (it talks to the real APIs
  and needs the secrets in `.dev.vars`).
- `POST /run` with the admin token updates the card now. Logs are under the Worker's Observability tab.
