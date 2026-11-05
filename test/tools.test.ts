// Drives the real tools through the real MCP protocol, in memory: a Client talks to an McpServer wired to the same
// registerTools() the Worker uses. This tests schemas, registration, summaries and errors, reading the text replies the same way an assistant does.
import { env } from "cloudflare:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { beforeAll, describe, expect, it } from "vitest";
import { findOrCreateUser } from "../src/data";
import { createFoodApiClients } from "../src/foodapis";
import { registerTools } from "../src/tools";
import { json, REST, mockFetch, offProduct, offSearch, usdaDetail, usdaSearch } from "./helpers";

const net = mockFetch((url) => {
	if (url.host === "api.nal.usda.gov") return url.pathname.includes("/foods/search") ? json(usdaSearch) : json(usdaDetail);
	return url.host === "search.openfoodfacts.org" ? json(offSearch) : json(offProduct);
});

/** An MCP client connected to a server that acts on behalf of one user. */
async function connect(userId: string) {
	const server = new McpServer({ name: "test", version: "0" });
	registerTools(server, { userId, db: env.DB, clients: createFoodApiClients("k", net.fn) });
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0" });
	await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
	return client;
}
/** The tools reply with text only, so tests read ids and numbers from the text, like the assistant does. */
const text = (r: any): string => r.content[0].text;
const idOf = (r: any, key: "food_id" | "workout_id"): string => text(r).match(new RegExp(`${key}=([0-9a-f-]{36})`))![1];
const logIdsOf = (r: any): string[] => text(r).match(/log_ids=\[([^\]]*)\]/)![1].split(", ");
const call = (c: Client, name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: args }) as Promise<any>;

let a: Client, b: Client;
beforeAll(async () => {
	a = await connect((await findOrCreateUser(env.DB, { provider: "github", subject: "4001" })).id);
	b = await connect((await findOrCreateUser(env.DB, { provider: "github", subject: "4002" })).id);
});

describe("tools/list", () => {
	it("lists exactly these tools", async () => {
		const names = (await a.listTools()).tools.map((t) => t.name).sort();
		expect(names).toEqual(
			["add_food", "archive_log", "archive_workout", "get_day", "import_food", "log_entries", "log_workout", "search_foods", "update_food", "update_log", "update_settings", "update_workout"],
		);
	});
	it("no tool accepts a user_id, and every input schema rejects unknown fields", async () => {
		for (const t of (await a.listTools()).tools) {
			const props = Object.keys((t.inputSchema as any).properties ?? {});
			expect(props, t.name).not.toContain("user_id");
			expect((t.inputSchema as any).additionalProperties, t.name).toBe(false);
		}
	});
});

describe("the voice flow, through the protocol", () => {
	it("add_food, log_entries and get_day, with server-computed numbers and a short spoken summary", async () => {
		const added = await call(a, "add_food", { name: "Cottage cheese", per_100g: { ...REST, kcal: 98, protein_g: 11.1, fat_g: 4.3, carbs_g: 3.4 }, source: "label" });
		expect(added.isError).toBeFalsy();
		const foodId = idOf(added, "food_id");
		
		const logged = await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: foodId, grams: 150 }], date: "2026-03-01" });
		expect(logged.isError).toBeFalsy();
		const logId = logIdsOf(logged)[0];
		expect(logged.content[0].text).toBe(`Logged 1 entry. log_ids=[${logId}]. Day total so far: 147 kcal, 16.7 g protein, 6.5 g fat, 5.1 g carbs, 0 g fiber.`);

		const day = await call(a, "get_day", { date: "2026-03-01" });
		expect(day.content[0].text).toMatch(/^1 food entry and 0 workouts on 2026-03-01/);
		// Claude reads only the text block, so the entry itself must be in it.
		expect(day.content[0].text).toContain(`lunch: 150 g Cottage cheese (eaten) 147 kcal, 16.7 g protein, 6.5 g fat, 5.1 g carbs, 0 g fiber [log_id=${logId}]`);
	});
	it("add_food rejects a missing nutrient, and totals without macros or weight", async () => {
		const { sodium_mg, ...noSodium } = { ...REST, kcal: 98, protein_g: 11.1, fat_g: 4.3, carbs_g: 3.4 };
		const full = (n: object) => ({ ...REST, kcal: 242, protein_g: 7.3, fat_g: 8.4, carbs_g: 34.3, ...n });
		const t1 = await call(a, "add_food", { name: "No sodium", per_100g: noSodium, source: "label" });
		const t2 = await call(a, "add_food", { name: "No weight", totals: full({}) });
		const { fat_g, ...noFat } = full({ total_grams: 268 });
		const t3 = await call(a, "add_food", { name: "No fat", totals: noFat });
		expect([t1.isError, t2.isError, t3.isError]).toEqual([true, true, true]);
		const ok = await call(a, "add_food", { name: "Whole smoothie", totals: full({ total_grams: 268 }) });
		expect(ok.isError).toBeFalsy();
		expect(text(ok)).toMatch(/^Saved meal Whole smoothie \(source estimate\): 90 kcal, 2\.7 g protein, 3\.1 g fat/);
	});
	it("search_foods, import_food, then log it", async () => {
		const found = await call(a, "search_foods", { query: "greek yogurt", limit: 5 });
		expect(text(found)).toMatch(/external_source=usda external_id=2035482 \[not saved: call import_food first\]/);
		expect(text(found)).toMatch(/NOT LISTED .*: added_sugar_g/);
		const refused = await call(a, "import_food", { external_source: "usda", external_id: "2035482" });
		expect(refused.isError).toBe(true);
		expect(text(refused)).toMatch(/does not list: added_sugar_g/);
		const imp = await call(a, "import_food", { external_source: "usda", external_id: "2035482", fill: { added_sugar_g: 0 } });
		expect(text(imp)).toMatch(/^Saved: .*source estimate/);
		const again = await call(a, "import_food", { external_source: "usda", external_id: "2035482" });
		expect(text(again)).toMatch(/^Already saved/);
		expect(idOf(again, "food_id")).toBe(idOf(imp, "food_id"));
		const logged = await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "snack", entries: [{ food_id: idOf(imp, "food_id"), grams: 30 }], date: "2026-03-02" });
		expect(text(logged)).toContain("Day total so far: 140 kcal"); // 467 per 100 g x 0.3
	});
});

describe("a saved meal through the protocol", () => {
	it("add_food with items, find it, then log servings with log_entries", async () => {
		const rice = idOf(await call(a, "add_food", { name: "Rice for meals", per_100g: { ...REST, kcal: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28 }, source: "label" }), "food_id");
		const meal = await call(a, "add_food", { name: "Tool lasagna", items: [{ food_id: rice, grams: 800 }] });
		expect(meal.isError).toBeFalsy();
		const mealId = idOf(meal, "food_id");
		expect(text(meal)).toContain("serving 800 g");
		expect((await call(a, "search_foods", { query: "lasagna", include_external: false })).content[0].text).toContain(`food_id=${mealId}`);

		const logged = await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "dinner", date: "2026-03-10", entries: [{ food_id: mealId, servings: 0.25 }, { food_id: rice, grams: 100 }] });
		expect(logged.isError).toBeFalsy();
		expect(text(logged)).toContain("Day total so far: 390 kcal"); // 0.25 x 800 g x 1.3 + 100 g x 1.3
		const day = await call(a, "get_day", { date: "2026-03-10" });
		expect(text(day)).toMatch(/^2 food entries/);
		expect(day.content[0].text).toContain("[log_id=");
	});
});

describe("tighter inputs", () => {
	it("rejects an eaten_at without an offset, a food source of usda, and a food_id on update_log", async () => {
		const food = idOf(await call(a, "add_food", { name: "Strict food", per_100g: { ...REST, kcal: 10, protein_g: 1, fat_g: 0, carbs_g: 1 }, source: "label" }), "food_id");
		const rid = () => ({ client_request_id: crypto.randomUUID() });
		const bad: [string, Record<string, unknown>][] = [
			["log_entries", { ...rid(), meal_type: "lunch", entries: [{ food_id: food, grams: 5 }], eaten_at: "2026-03-14 08:30" }],
			["add_food", { name: "x", per_100g: { ...REST, kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0 }, source: "usda" }],
			["add_food", { name: "x", per_100g: { ...REST, kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0 }, verified: true }],
			["update_log", { log_id: crypto.randomUUID(), food_id: food }],
		];
		for (const [name, args] of bad) {
			const r: any = await call(a, name, args).catch((e) => ({ isError: true, thrown: e }));
			expect(r.isError, name).toBe(true);
		}
		const ok = await call(a, "log_entries", { ...rid(), meal_type: "lunch", entries: [{ food_id: food, grams: 5 }], eaten_at: "2026-03-14T08:30:00-05:00" });
		expect(ok.isError).toBeUndefined();
	});
});

describe("update and archive a log through the protocol", () => {
	it("update_log then archive_log, with ids and totals in the text", async () => {
		const food = idOf(await call(a, "add_food", { name: "Tool update food", per_100g: { ...REST, kcal: 100, protein_g: 10, fat_g: 1, carbs_g: 5 }, source: "label" }), "food_id");
		const logged = await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: food, grams: 100 }], date: "2026-03-20" });
		const id = logIdsOf(logged)[0];
		const upd = await call(a, "update_log", { log_id: id, grams: 250, meal_type: "dinner", note: "bigger" });
		expect(upd.isError).toBeFalsy();
		expect(upd.content[0].text).toContain("Updated: 250 g Tool update food 250 kcal, 25 g protein, 2.5 g fat, 12.5 g carbs, 0 g fiber.");
		const day = await call(a, "get_day", { date: "2026-03-20" });
		expect(text(day)).toContain(`dinner: 250 g Tool update food (eaten) 250 kcal, 25 g protein, 2.5 g fat, 12.5 g carbs, 0 g fiber [log_id=${id}]`);
		const del = await call(a, "archive_log", { log_id: id });
		expect(del.content[0].text).toMatch(/^Archived 250 g .* \(dinner, 2026-03-20\)\. Day total so far: 0 kcal/);
		const again = await call(a, "archive_log", { log_id: id });
		expect(again.isError).toBeUndefined();
		expect(again.content[0].text).toMatch(/already archived/);
	});
	it("B cannot update or archive A's log", async () => {
		const food = idOf(await call(a, "add_food", { name: "A only food", per_100g: { ...REST, kcal: 10, protein_g: 1, fat_g: 0, carbs_g: 1 }, source: "label" }), "food_id");
		const id = logIdsOf(await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "snack", entries: [{ food_id: food, grams: 10 }], date: "2026-03-21" }))[0];
		const upd = await call(b, "update_log", { log_id: id, grams: 99 });
		expect(upd.isError).toBe(true);
		expect(text(upd)).toContain("No log with that id");
		const del = await call(b, "archive_log", { log_id: id });
		expect(text(del)).toMatch(/already archived/); // looks the same as "never existed"
		expect(text(await call(a, "get_day", { date: "2026-03-21" }))).toContain("snack: 10 g A only food");
	});
});

describe("errors come back as results Claude can read", () => {
	it("an unknown food id is a tool error that says what to do next", async () => {
		const r = await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: crypto.randomUUID(), grams: 100 }] });
		expect(r.isError).toBe(true);
		expect(text(r)).toMatch(/No food with that id \(entries\[0\]\)\. Use search_foods/);
	});
	it("bad arguments are rejected before any code runs: zero grams, a user_id, a made-up field", async () => {
		const id = crypto.randomUUID();
		const rid = { client_request_id: crypto.randomUUID() };
		for (const args of [{ meal_type: "lunch", entries: [{ food_id: id, grams: 0 }] }, { meal_type: "lunch", entries: [{ food_id: id, grams: 5 }], user_id: "someone-else" }, { meal_type: "lunch", entries: [{ food_id: id, grams: 5 }], bogus: 1 }, { meal_type: "lunch", entries: [{ food_id: "not-a-uuid", grams: 5 }] }, { meal_type: "brunch", entries: [{ food_id: id, grams: 5 }] }].map((x) => ({ ...rid, ...x }))) {
			const r: any = await call(a, "log_entries", args).catch((e) => ({ isError: true, thrown: e }));
			expect(r.isError, JSON.stringify(args)).toBe(true);
		}
	});
});

describe("two users, through the protocol", () => {
	it("B cannot log A's food or see A's day", async () => {
		const aFood = idOf(await call(a, "add_food", { name: "A private food", per_100g: { ...REST, kcal: 100, protein_g: 5, fat_g: 1, carbs_g: 10 }, source: "label" }), "food_id");
		await call(a, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: aFood, grams: 100 }], date: "2026-03-05" });

		const stolen = await call(b, "log_entries", { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: aFood, grams: 100 }], date: "2026-03-05" });
		expect(stolen.isError).toBe(true);
		expect(text(stolen)).toContain("No food with that id");

		const bDay = await call(b, "get_day", { date: "2026-03-05" });
		expect(text(bDay)).toMatch(/^0 food entries and 0 workouts on 2026-03-05/);

		const bSearch = await call(b, "search_foods", { query: "A private food", include_external: false });
		expect(text(bSearch)).toMatch(/^No matches/);
	});
});
