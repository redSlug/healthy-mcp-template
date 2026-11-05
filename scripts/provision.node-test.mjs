// Tests for scripts/provision.mjs on node:test with a fake Cloudflare API. Run: npm run test:scripts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeployConfig, namesFor, parseJsonc, provision, workerUrl } from "./provision.mjs";

const wranglerText = `{
  // comment with "quotes" and a // slash
  "name": "healthy", /* block */
  "vars": { "MCP_RESOURCE": "http://localhost:8788/mcp" },
  "kv_namespaces": [ { "binding": "OAUTH_KV", "id": "REPLACED_BY_PROVISION" } ],
  "d1_databases": [ { "binding": "DB", "database_name": "x", "database_id": "REPLACED_BY_PROVISION", "migrations_dir": "migrations" } ]
}`;
const env = { APP_NAME: "my-app", WORKER_URL: "https://my-app.me.workers.dev", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" };

/** A fake Cloudflare API holding D1 databases and KV namespaces in memory. */
function fakeApi({ d1 = [], kv = [], fail = null } = {}) {
	const calls = [];
	const fn = async (url, init = {}) => {
		const u = new URL(url);
		const method = init.method ?? "GET";
		calls.push(`${method} ${u.pathname}${u.search}`);
		const reply = (result, status = 200, success = true, errors = []) => new Response(JSON.stringify({ success, result, errors }), { status });
		if (fail) return reply(null, 403, false, [{ code: 10000, message: fail }]);
		const body = init.body ? JSON.parse(init.body) : null;
		if (u.pathname.endsWith("/d1/database")) {
			if (method === "GET") return reply(d1.filter((d) => d.name === u.searchParams.get("name")));
			const row = { uuid: `d1-${d1.length + 1}`, name: body.name };
			d1.push(row);
			return reply(row);
		}
		if (u.pathname.endsWith("/storage/kv/namespaces")) {
			if (method === "GET") {
				const per = Number(u.searchParams.get("per_page")), page = Number(u.searchParams.get("page"));
				return reply(kv.slice((page - 1) * per, page * per));
			}
			const row = { id: `kv-${kv.length + 1}`, title: body.title };
			kv.push(row);
			return reply(row);
		}
		return reply(null, 404, false, [{ code: 1, message: "unknown" }]);
	};
	return { fn, calls, d1, kv };
}

async function run(api, over = {}) {
	const written = {};
	const r = await provision({ env: { ...env, ...over }, fetchFn: api.fn, read: () => wranglerText, write: (p, t) => (written[p] = t), log: () => {} });
	return { r, written };
}

test("creates the database and namespace when missing, and writes the deploy config", async () => {
	const api = fakeApi();
	const { r, written } = await run(api);
	assert.deepEqual(api.d1, [{ uuid: "d1-1", name: "my-app-db" }]);
	assert.deepEqual(api.kv, [{ id: "kv-1", title: "my-app-oauth" }]);
	const cfg = JSON.parse(written[".wrangler-deploy.json"]);
	assert.equal(cfg.name, "my-app");
	assert.equal(cfg.vars.MCP_RESOURCE, "https://my-app.me.workers.dev/mcp");
	assert.deepEqual(cfg.kv_namespaces, [{ binding: "OAUTH_KV", id: "kv-1" }]);
	assert.deepEqual(cfg.d1_databases[0], { binding: "DB", database_name: "my-app-db", database_id: "d1-1", migrations_dir: "migrations" });
	assert.equal(r.d1.created && r.kv.created, true);
});

test("running again creates nothing and reuses the same ids", async () => {
	const api = fakeApi();
	await run(api);
	const before = JSON.stringify([api.d1, api.kv]);
	const { r, written } = await run(api);
	assert.equal(JSON.stringify([api.d1, api.kv]), before);
	assert.equal(r.d1.created || r.kv.created, false);
	assert.equal(JSON.parse(written[".wrangler-deploy.json"]).d1_databases[0].database_id, "d1-1");
});

test("only ever creates: it never sends DELETE or PUT", async () => {
	const api = fakeApi();
	await run(api);
	await run(api);
	assert.ok(api.calls.every((c) => c.startsWith("GET ") || c.startsWith("POST ")), api.calls.join("\n"));
});

test("an API error stops with a message that points at the token permissions", async () => {
	await assert.rejects(run(fakeApi({ fail: "Authentication error" })), /Authentication error.*README/s);
});

test("bad APP_NAME, WORKER_URL or missing credentials are refused before any call", async () => {
	const api = fakeApi();
	for (const bad of ["", "My App", "-x", "x-", "a".repeat(41), "under_score"]) assert.throws(() => namesFor(bad), /APP_NAME/);
	for (const bad of ["http://x.workers.dev", "https://x.workers.dev/mcp", "x.workers.dev", "https://x.workers.dev/?a=1"]) assert.throws(() => workerUrl(bad), /WORKER_URL/);
	await assert.rejects(run(api, { CLOUDFLARE_API_TOKEN: "" }), /required/);
	assert.equal(api.calls.length, 0);
});

test("the real wrangler.jsonc parses and yields a complete deploy config", async () => {
	const { readFileSync } = await import("node:fs");
	const base = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
	const cfg = buildDeployConfig(base, { names: namesFor("demo"), d1Id: "d", kvId: "k", url: "https://demo.me.workers.dev" });
	assert.equal(cfg.main, "src/index.ts");
	assert.equal(cfg.d1_databases[0].migrations_dir, "migrations");
	assert.ok(!JSON.stringify(cfg).includes("REPLACED_BY_PROVISION"));
});

test("a workers.dev address that does not start with APP_NAME is refused, a custom domain is not", async () => {
	await assert.rejects(run(fakeApi(), { WORKER_URL: "https://other.me.workers.dev" }), /must start with the APP_NAME/);
	await run(fakeApi(), { WORKER_URL: "https://health.example.com" });
});
