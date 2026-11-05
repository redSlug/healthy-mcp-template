import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser, getFoodByExternal } from "../src/data";
import { listFoods, REST } from "./helpers";
import { createFoodApiClients } from "../src/foodapis";
import { addFood, importFood, searchFoods } from "../src/services/foods";
import { getDay } from "../src/services/logs";
import { logFood } from "./helpers";
import { json, mockFetch, offProduct, offSearch, usdaDetail, usdaSearch } from "./helpers";

const db = env.DB;
const label = (name: string) => ({ name, kcal: 100, protein_g: 5, fat_g: 2, carbs_g: 15, ...REST, source: "label" as const });

// A fake internet: USDA and Open Food Facts answer from the sample payloads.
function happyInternet() {
	return mockFetch((url) => {
		if (url.host === "api.nal.usda.gov") return url.pathname.includes("/foods/search") ? json(usdaSearch) : json(usdaDetail);
		return url.host === "search.openfoodfacts.org" ? json(offSearch) : json(offProduct);
	});
}
const only = (host: string, healthy: Response = json({}, 500)) =>
	mockFetch((url) => (url.host === host ? healthy : json(url.host === "api.nal.usda.gov" ? usdaSearch : offSearch)));

let a: string, b: string;
beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "3001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "3002" })).id;
});

describe("search_foods", () => {
	it("returns local matches first and makes no outside call when the limit is met", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3010" })).id;
		await createFood(db, u, label("Greek yogurt"));
		const net = happyInternet();
		const r = await searchFoods(db, u, createFoodApiClients("k", net.fn), { query: "greek yogurt", limit: 1 });
		expect(r.results).toHaveLength(1);
		expect(r.results[0]).toMatchObject({ saved: true, name: "Greek yogurt" });
		expect(net.calls).toHaveLength(0);
	});
	it("fills the rest from outside databases when there are fewer local matches than the limit", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3011" })).id;
		await createFood(db, u, label("Yogurt homemade"));
		const net = happyInternet();
		const r = await searchFoods(db, u, createFoodApiClients("k", net.fn), { query: "yogurt", limit: 5 });
		expect(r.results[0]).toMatchObject({ saved: true, food_id: expect.any(String) });
		const ext = r.results.filter((x) => !x.saved);
		expect(ext.length).toBeGreaterThan(0);
		expect(ext[0]).toMatchObject({ food_id: null, external_id: expect.any(String) });
		expect(r.results.length).toBeLessThanOrEqual(5);
		expect(net.calls.length).toBe(2);
	});
	it("does not list an outside food that is already saved, only the saved copy", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3012" })).id;
		const clients = createFoodApiClients("k", happyInternet().fn);
		const imported = await importFood(db, u, clients, { external_source: "usda", external_id: "2035482", fill: { added_sugar_g: 0 } });
		const r = await searchFoods(db, u, clients, { query: "yogurt greek", limit: 10 });
		expect(r.results.filter((x: any) => x.external_id === "2035482")).toHaveLength(0);
		expect(r.results.some((x: any) => x.food_id === imported.food_id)).toBe(true);
	});
	it("still answers when one database is down, with a warning", async () => {
		const r = await searchFoods(db, b, createFoodApiClients("k", only("api.nal.usda.gov").fn), { query: "skyr", limit: 5 });
		expect(r.results.length).toBeGreaterThan(0);
		expect(r).toHaveProperty("warnings");
		expect((r as any).warnings[0]).toMatch(/USDA/);
	});
	it("fails clearly when both are down and nothing is saved locally", async () => {
		const down = mockFetch(() => json({}, 503));
		await expect(searchFoods(db, b, createFoodApiClients("k", down.fn), { query: "nothing saved", limit: 5 })).rejects.toMatchObject({ code: "external_api_unavailable" });
	});
	it("never shows another user's saved foods", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3014" })).id;
		await createFood(db, u, label("Secret recipe pudding"));
		const r = await searchFoods(db, b, createFoodApiClients("k", mockFetch(() => json({ hits: [], foods: [] })).fn), { query: "secret recipe pudding" });
		expect(r.results).toEqual([]);
	});
	it("treats search text as plain text, not search syntax", async () => {
		const c = createFoodApiClients("k", mockFetch(() => json({ foods: [], hits: [] })).fn);
		await expect(searchFoods(db, a, c, { query: 'NEAR( " OR * ) -', include_external: false })).resolves.toBeTruthy();
	});
});

describe("add_food", () => {
	it("converts per-serving label values to per-100g (60 kcal in 30 g is 200 kcal per 100 g)", async () => {
		const r = await addFood(db, a, { name: "Tzatziki", brand: "Trader Joe's", serving_g: 30, per_serving: { ...REST, kcal: 60, protein_g: 1, fat_g: 5, carbs_g: 2, sodium_mg: 150 }, source: "label", verified: true });
		expect(r.per_100g).toMatchObject({ kcal: 200, protein_g: 3.3, fat_g: 16.7, carbs_g: 6.7, sodium_mg: 500 });
	});
	it("requires exactly one of per_100g and per_serving", async () => {
		const n = { kcal: 1, protein_g: 1, fat_g: 1, carbs_g: 1, ...REST };
		await expect(addFood(db, a, { name: "x", source: "label" })).rejects.toMatchObject({ code: "validation_failed" });
		await expect(addFood(db, a, { name: "x", source: "label", per_100g: n, per_serving: n, serving_g: 10 })).rejects.toMatchObject({ code: "validation_failed" });
	});
	it("rejects impossible values, such as per-serving numbers entered as per-100g", async () => {
		await expect(addFood(db, a, { name: "x", source: "label", per_100g: { ...REST, kcal: 1500, protein_g: 1, fat_g: 1, carbs_g: 1 } })).rejects.toMatchObject({ code: "validation_failed" });
		await expect(addFood(db, a, { name: "x", source: "label", per_100g: { ...REST, kcal: 400, protein_g: 60, fat_g: 40, carbs_g: 40 } })).rejects.toMatchObject({ code: "validation_failed" });
	});
});

describe("import_food", () => {
	it("saves an outside food as unverified, keeping its source and id", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3020" })).id;
		const r = await importFood(db, u, createFoodApiClients("k", happyInternet().fn), { external_source: "usda", external_id: "2035482", fill: { added_sugar_g: 0 } });
		expect(r).toMatchObject({ name: "GREEK YOGURT", already_saved: false });
		const saved = await getFoodByExternal(db, u, "usda", "2035482");
		expect(saved).toMatchObject({ id: r.food_id, source: "estimate", verified: 0, kcal: 467, brand: "OCEAN SPRAY", serving_g: 30 });
	});
	it("refuses an import until every nutrient the source leaves out is filled in", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3023" })).id;
		const clients = createFoodApiClients("k", happyInternet().fn);
		await expect(importFood(db, u, clients, { external_source: "usda", external_id: "2035482" })).rejects.toMatchObject({ code: "validation_failed", field: "fill" });
		expect(await getFoodByExternal(db, u, "usda", "2035482")).toBeNull();
	});
	it("returns the existing food on a second import and calls the outside API only once", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3021" })).id;
		const net = happyInternet();
		const clients = createFoodApiClients("k", net.fn);
		const first = await importFood(db, u, clients, { external_source: "usda", external_id: "2035482", fill: { added_sugar_g: 0 } });
		const second = await importFood(db, u, clients, { external_source: "usda", external_id: "2035482", fill: { added_sugar_g: 0 } });
		expect(second).toMatchObject({ food_id: first.food_id, already_saved: true });
		expect(net.calls).toHaveLength(1);
		expect((await listFoods(db, u)).filter((f) => f.name !== "Water")).toHaveLength(1);
	});
	it("an imported food can be logged and counted: search, import, log, get_day", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3022" })).id;
		const clients = createFoodApiClients("k", happyInternet().fn);
		const found = await searchFoods(db, u, clients, { query: "greek yogurt", limit: 10 });
		const pick: any = found.results.find((r: any) => r.external_id === "2035482");
		const imported = await importFood(db, u, clients, { external_source: pick.external_source, external_id: pick.external_id, fill: { added_sugar_g: 0 } });
		const logged = await logFood(db, u, { date: "2026-02-01", meal_type: "breakfast", food_id: imported.food_id, grams: 200 });
		expect(logged.nutrients!.kcal).toBe(934); // 467 per 100 g x 2
		expect((await getDay(db, u, "2026-02-01")).totals.eaten.protein_g).toBe(6.7); // 3.33 per 100 g x 2 = 6.66
	});
});

// Regressions found in production use (Claude connector bug report, 2026-11-03).
describe("outside search quality", () => {
	const ext = (source: "usda" | "off", id: string, kcal = 100) => ({
		external_source: source,
		external_id: id,
		name: `${source} ${id}`,
		brand: null,
		serving_g: null,
		per_100g: { kcal, protein_g: 5, fat_g: 2, carbs_g: 15, fiber_g: 0, sugar_g: 0, added_sugar_g: 0, saturated_fat_g: 0, trans_fat_g: 0, cholesterol_mg: 0, sodium_mg: 0 },
	});
	const stub = (usda: ReturnType<typeof ext>[], off: ReturnType<typeof ext>[]) => ({
		search: async (s: "usda" | "off") => (s === "usda" ? usda : off),
		get: async (s: "usda" | "off", id: string) => [...usda, ...off].find((f) => f.external_source === s && f.external_id === id) ?? null,
	});

	it("Open Food Facts gets slots even when USDA alone could fill the limit", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3020" })).id;
		const clients = stub([ext("usda", "1"), ext("usda", "2"), ext("usda", "3"), ext("usda", "4")], [ext("off", "9"), ext("off", "8")]);
		const r = await searchFoods(db, u, clients, { query: "anything", limit: 4 });
		const sources = r.results.map((x: any) => x.external_source);
		expect(sources).toContain("off");
		expect(sources.filter((s: string) => s === "usda").length).toBe(2); // they take turns
	});
	it("hides impossible rows (1,280 and 5,330 kcal per 100 g) and says so", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3021" })).id;
		const clients = stub([ext("usda", "bad1", 1280), ext("usda", "bad2", 5330), ext("usda", "ok", 400)], []);
		const r = await searchFoods(db, u, clients, { query: "muesli", limit: 5 });
		expect(r.results.map((x: any) => x.external_id)).toEqual(["ok"]);
		expect(r.warnings).toEqual(["Hid 2 outside results with impossible nutrient values."]);
	});
	it("import_food refuses an impossible row instead of saving it", async () => {
		const u = (await findOrCreateUser(db, { provider: "github", subject: "3022" })).id;
		const clients = stub([ext("usda", "bad", 5330)], []);
		await expect(importFood(db, u, clients, { external_source: "usda", external_id: "bad" })).rejects.toMatchObject({ code: "validation_failed" });
		expect(await getFoodByExternal(db, u, "usda", "bad")).toBeNull();
	});
});
