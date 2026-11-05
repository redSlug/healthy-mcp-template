// Creates what the Worker needs in YOUR Cloudflare account (only what is missing) and writes the deploy config.
// Run by the "Deploy" GitHub workflow; see the README. It only ever creates, never deletes or renames,
// so it is safe to run again. It talks to Cloudflare's REST API with CLOUDFLARE_API_TOKEN (no wrangler output parsing).
//
// Input (environment variables):
//   APP_NAME                your name for the app: the Worker name, and the base of the database and KV names
//   WORKER_URL              the Worker's public address, https://<APP_NAME>.<your-subdomain>.workers.dev
//   CLOUDFLARE_API_TOKEN    token with Workers Scripts, D1 and Workers KV Storage edit permission
//   CLOUDFLARE_ACCOUNT_ID   your account id
// Output: .wrangler-deploy.json (git-ignored): wrangler.jsonc with your names, the resource ids and MCP_RESOURCE.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.cloudflare.com/client/v4";

/** wrangler.jsonc has comments; strip them (outside of strings) so JSON.parse can read it. */
export function parseJsonc(text) {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && text[i + 1] === "*") {
			i = text.indexOf("*/", i + 2) + 1;
			if (i === 0) throw new Error("unterminated comment in wrangler.jsonc");
		} else out += c;
	}
	return JSON.parse(out); // so wrangler.jsonc must not have trailing commas
}

export function namesFor(appName) {
	if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(appName ?? "")) {
		throw new Error("APP_NAME must be 1 to 40 characters: lowercase letters, digits and dashes, starting and ending with a letter or digit.");
	}
	return { worker: appName, d1: `${appName}-db`, kv: `${appName}-oauth` };
}

export function workerUrl(raw) {
	let u;
	try { u = new URL(raw); } catch { throw new Error("WORKER_URL must be a full address like https://my-app.my-subdomain.workers.dev"); }
	if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash) throw new Error("WORKER_URL must be https and have no path, for example https://my-app.my-subdomain.workers.dev");
	return u.origin;
}

function cloudflare({ token, accountId, fetchFn }) {
	return async function call(method, path, body) {
		const res = await fetchFn(`${API}/accounts/${accountId}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
		const json = await res.json().catch(() => null);
		if (!res.ok || !json?.success) {
			const why = json?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
			throw new Error(`Cloudflare API ${method} ${path} failed (${why}). Check the token's permissions in the README.`);
		}
		return json;
	};
}

/** Returns { id, created } for the D1 database with this name, creating it if it does not exist. */
export async function ensureD1(call, name) {
	const found = (await call("GET", `/d1/database?name=${encodeURIComponent(name)}`)).result.filter((d) => d.name === name);
	if (found.length > 1) throw new Error(`More than one D1 database is named ${name}; remove the extras.`);
	if (found.length === 1) return { id: found[0].uuid, created: false };
	return { id: (await call("POST", "/d1/database", { name })).result.uuid, created: true };
}

/** Returns { id, created } for the KV namespace with this exact title, creating it if it does not exist. */
export async function ensureKv(call, title) {
	const matches = [];
	for (let page = 1; ; page++) {
		const r = await call("GET", `/storage/kv/namespaces?per_page=100&page=${page}`);
		matches.push(...r.result.filter((n) => n.title === title));
		if (r.result.length < 100) break;
	}
	if (matches.length > 1) throw new Error(`More than one KV namespace is titled ${title}; remove the extras.`);
	if (matches.length === 1) return { id: matches[0].id, created: false };
	return { id: (await call("POST", "/storage/kv/namespaces", { title })).result.id, created: true };
}

/** wrangler.jsonc (parsed) -> the config to deploy with: your names, resource ids and public address. */
export function buildDeployConfig(base, { names, d1Id, kvId, url }) {
	const config = structuredClone(base);
	config.name = names.worker;
	config.vars = { ...config.vars, MCP_RESOURCE: `${url}/mcp` };
	const kv = config.kv_namespaces?.find((k) => k.binding === "OAUTH_KV");
	const d1 = config.d1_databases?.find((d) => d.binding === "DB");
	if (!kv || !d1) throw new Error("wrangler.jsonc must have an OAUTH_KV and a DB binding.");
	kv.id = kvId;
	d1.database_name = names.d1;
	d1.database_id = d1Id;
	return config;
}

export async function provision({ env, fetchFn = fetch, read = (p) => fs.readFileSync(p, "utf8"), write = (p, t) => fs.writeFileSync(p, t), log = console.log }) {
	const names = namesFor(env.APP_NAME);
	const url = workerUrl(env.WORKER_URL);
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
	// A workers.dev address must start with the app name, or every token would be bound to a URL that is not this Worker.
	// Custom domains are not checked.
	const host = new URL(url).hostname;
	if (host.endsWith(".workers.dev") && host.split(".")[0] !== names.worker) {
		throw new Error(`WORKER_URL (${url}) must start with the APP_NAME: https://${names.worker}.<your-subdomain>.workers.dev`);
	}
	const call = cloudflare({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, fetchFn });

	const d1 = await ensureD1(call, names.d1);
	log(`D1 database ${names.d1}: ${d1.created ? "created" : "already exists"}`);
	const kv = await ensureKv(call, names.kv);
	log(`KV namespace ${names.kv}: ${kv.created ? "created" : "already exists"}`);

	const config = buildDeployConfig(parseJsonc(read("wrangler.jsonc")), { names, d1Id: d1.id, kvId: kv.id, url });
	write(".wrangler-deploy.json", JSON.stringify(config, null, 2) + "\n");
	log("Wrote .wrangler-deploy.json");
	return { names, d1, kv, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	provision({ env: process.env }).catch((e) => {
		console.error(`provision failed: ${e.message}`);
		process.exit(1);
	});
}
