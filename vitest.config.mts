import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						GITHUB_CLIENT_ID: "test",
						GITHUB_CLIENT_SECRET: "test",
						COOKIE_ENCRYPTION_KEY: "test",
						USDA_API_KEY: "test",
					},
				},
			}),
		],
		test: { setupFiles: ["./test/apply-migrations.ts"] },
	};
});
