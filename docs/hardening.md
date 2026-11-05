# Optional hardening

Extra protection for your deployment. None of it is required for the setup in the README.

## Restrict the `production` environment to `main`

The Deploy workflow runs in an environment named `production`, and `workflow_dispatch` can be started from any branch. Without a branch rule, a branch with an edited workflow or script could run with your Cloudflare token.

1. In your repo: **Settings, Environments, production**.
2. Under **Deployment branches and tags**, choose **Selected branches and tags**, and add `main`.
3. Optional: under **Required reviewers**, add yourself, so every deploy waits for your approval.

(The environment is created the first time the workflow runs. If you do not see it yet, run **Deploy** once.)

## Pin the GitHub Actions to a commit

`.github/workflows/*.yml` use `actions/checkout@v4` and `actions/setup-node@v4`. A tag can be moved; a full commit hash cannot. Only GitHub's own actions are used, so the risk is low, but pinning is the standard hardening.

1. Look up the commit a tag points to (needs the GitHub CLI):

   ```bash
   gh api repos/actions/checkout/commits/v4 --jq .sha
   gh api repos/actions/setup-node/commits/v4 --jq .sha
   ```

2. Replace the tag in `ci.yml` and `deploy.yml`, keeping the tag as a comment:

   ```yaml
   - uses: actions/checkout@<the 40-character hash>  # v4
   ```

3. To keep the pins current, turn on Dependabot for GitHub Actions: add `.github/dependabot.yml` with an `updates` entry for the `github-actions` ecosystem on a weekly schedule.

## Consider: limit which websites can call `/mcp`

Not needed, and low risk as it is. The server answers requests from any website origin (the `agents` package default, and normal for MCP), but every call still needs your sign-in token in the `Authorization` header, and `/mcp` uses no cookies, so another site cannot act as you. If you want it tighter, pass `corsOptions: { origin: "https://your-client.example" }` to `createMcpHandler` in `src/index.ts`. Note that this blocks browser-based clients (such as the MCP Inspector) from other origins; server-side connectors are not affected.
