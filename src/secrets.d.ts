// Worker secrets. They are not in wrangler.jsonc (CI sets them from GitHub secrets; locally they come from .dev.vars),
// so `wrangler types` cannot know them on a fresh checkout. Declared here so type-checking works everywhere.
interface WorkerSecrets {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	COOKIE_ENCRYPTION_KEY: string;
	USDA_API_KEY: string;
}
interface Env extends WorkerSecrets {}
declare namespace Cloudflare {
	interface Env extends WorkerSecrets {}
}
