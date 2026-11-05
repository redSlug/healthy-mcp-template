# Healthy: reference

Day-to-day use, troubleshooting, how it works and local development. Setup is in the [README](../README.md). Extra protection is in [docs/hardening.md](hardening.md).

## Day to day

- **Add or remove a person:** edit `config/allowed-users.json`, commit, run **Deploy** again. The allowlist is checked on every request, so once the deploy finishes the removed person is locked out immediately, even with a token they already hold.
- **Deploy on every push to `main`:** set the repository variable `DEPLOY_ENABLED` to `true`. Without it, pushes only run the tests, and you deploy by clicking **Run workflow**.
- **Update to newer code:** see [Updating your copy](#updating-your-copy), then run **Deploy**. Database changes are applied automatically.
- **Require approval for deploys:** create an environment named `production` (Settings, Environments) and add yourself as a required reviewer.
- **Remove everything:** nothing here deletes anything for you. In the Cloudflare dashboard delete the Worker, the D1 database and the KV namespace, then revoke the API token and delete the GitHub OAuth App.

## Updating your copy

A copy made from the template does not stay linked to it, so pull in new versions yourself. Run these in your copy.

**The first time.** Git sees your copy and the template as unrelated, so every file that differs from the template's shows up as a conflict. That is expected:

```bash
git remote add template https://github.com/redSlug/healthy-mcp-template.git   # or your own template's address
git fetch template
git merge template/main --allow-unrelated-histories    # reports conflicts in several files
git checkout --theirs .                                # take the template's version of every conflicted file
git checkout --ours config/allowed-users.json          # but keep your own list of people
git add -A
git commit
```

If you edited any other file yourself, do not use `--theirs` for it: open it and merge by hand. Then push and run **Deploy**.

**Every time after that.** The histories are connected now, so it is simply:

```bash
git fetch template
git merge template/main
```

Changes you made are kept, and `config/allowed-users.json` is left alone unless the template changes it. Then push and run **Deploy**. Database changes arrive as new numbered files in `migrations/` and are applied for you.

## Troubleshooting

| You see | Cause and fix |
| --- | --- |
| Deploy stops with "Not set: ..." | A secret or variable from step 5 is missing or misspelled |
| "config/allowed-users.json is empty" | Put your GitHub username in `ALLOWED_GITHUB_USERS` and run the script again (README step 5) |
| "WORKER_URL ... must start with the APP_NAME" | A `workers.dev` address has to be `https://<APP_NAME>.<your-subdomain>.workers.dev` (your subdomain is in README step 2) |
| "Cloudflare API ... failed" | The token lacks a permission or the account id is wrong (README step 2) |
| "This server is private" at sign-in | Your GitHub id is not in `config/allowed-users.json`, or the change is not deployed |
| GitHub says "redirect_uri mismatch" | The OAuth App's callback is not exactly `WORKER_URL/callback` (README step 3) |
| The last deploy step fails | The server did not answer 401 to a request without a token within about 90 seconds; the log lists every attempt. Check `APP_NAME` and your subdomain, and the Worker in your Cloudflare dashboard |

## How it works

The assistant (Claude or your favorite LLM) decides which tool to call. The server knows who you are from the sign-in token, does all the logic and nutrition math, and reads and writes your data. GitHub Actions deploys the code and never serves requests.

Diagrams, one per page: [architecture](diagrams/architecture.md), [one tool call](diagrams/tool-call.md), [sign-in](diagrams/sign-in.md), [deploy](diagrams/deploy.md), [data model](diagrams/data-model-overview.md) and [all fields](diagrams/data-model-fields.md).

**Tools:** `search_foods`, `add_food`, `import_food`, `update_food`, `log_entries`, `update_log`, `archive_log`, `get_day`, `log_workout`, `update_workout`, `archive_workout`, `update_settings`.

**Data:** `foods` hold nutrients per 100 g. Every nutrient on the standard label is required (calories, protein, fat, saturated fat, trans fat, carbs, fiber, sugar, added sugar, cholesterol, sodium). When a value is not listed, Claude estimates it and the food is saved with source `estimate`. A saved meal is a food too (kind `meal`): its weight is the serving size, so you log it in grams or in servings. A meal made from saved foods gets a "Made of" line in its notes, but its nutrients are a snapshot added up when it was saved, so editing an ingredient later does not change the meal. Two active foods cannot share a name and brand. A fix with `update_food` applies to every log of that food, past days included. `food_logs` hold only a pointer to a food and an amount in grams, so every number is calculated by the server. Meal types are breakfast, lunch, dinner, snack, dessert and water. Water is just a food (every user gets one called "Water"; grams are millilitres, totalled against a water target). `get_day` reports the water total (and what is left of the goal), each entry's mindfulness score (1 to 10) and the day's average over eaten entries that have one. `workouts` are small but complete: a day, a type (run, walk, cycle, swim, strength, yoga, hiit or other), a duration, calories burned and an intensity (easy, moderate or hard), all required. A value the user does not give is estimated by Claude and the workout is saved with source `estimate` (`reported` when the user gave the numbers). Each user has a time zone and one set of daily targets. Nothing is deleted: `archive_log` and `archive_workout` set `archived_at`, and archived entries are left out of every day and total. Logging tools take a `client_request_id`; a repeated id returns the first result instead of saving again (the `request_log` table). The data model diagrams are in [diagrams](diagrams/README.md) and the whole schema is in [`migrations/0001_schema.sql`](../migrations/0001_schema.sql).

**Security:** only people in `config/allowed-users.json` get in, and that is re-checked on every request. The sign-in endpoints are rate limited per IP address (20 requests a minute, set in `wrangler.jsonc`). CI hands each secret only to the step that needs it and installs dependencies without running their install scripts. Every query is scoped to the signed-in user, and tests check that one user cannot see another's rows. The owner of the Cloudflare account can read everything in the database, so this is a personal tool, not a service for strangers.

## Develop locally

```bash
npm install
cp /dev/null .dev.vars   # then add the lines below
npx wrangler d1 migrations apply DB --local
npx wrangler dev         # http://localhost:8788
npm test
```

`.dev.vars` (gitignored) needs: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (a separate GitHub OAuth App whose callback is `http://localhost:8788/callback`), `COOKIE_ENCRYPTION_KEY` and `USDA_API_KEY`. Your GitHub id must also be in `config/allowed-users.json`. Test the server without an assistant using `npx @modelcontextprotocol/inspector` and the URL `http://localhost:8788/mcp`.

Other commands: `npm run type-check` (generates the Cloudflare types first; they are not stored in the repo) and `npm run test:scripts` (tests the provisioning script).

## Where things are

- `src/data/`: the only place with SQL; every function takes a `userId`
- `src/services/`: the rules behind each tool; `src/nutrition.ts`: the math (pure functions)
- `src/tools/`: MCP tool registration; `src/github-handler.ts`: GitHub sign-in
- `src/foodapis/`: USDA and Open Food Facts clients
- `docs/`: reference, data-model diagrams, hardening; `migrations/`: database schema; `config/allowed-users.json`: who may sign in
- `scripts/provision.mjs`: creates the D1 database and KV namespace if missing (used by the Deploy workflow)
- `.github/workflows/`: `ci.yml` (tests) and `deploy.yml` (the only way anything is deployed)
