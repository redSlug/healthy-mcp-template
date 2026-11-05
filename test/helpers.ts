// Fakes for the food APIs (tests never touch the network) and a one-food logging shortcut.
import type { Food } from "../src/data";
import { getDay, logEntries } from "../src/services/logs";
import offProductFx from "./fixtures/off-product.json";
import offSearchFx from "./fixtures/off-search.json";
import usdaDetailFx from "./fixtures/usda-detail.json";
import usdaSearchFx from "./fixtures/usda-search.json";

export function mockFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
	const calls: { url: URL; headers: Headers }[] = [];
	const fn = (async (input: any, init: RequestInit = {}) => {
		const url = new URL(typeof input === "string" ? input : input.url);
		calls.push({ url, headers: new Headers(init.headers) });
		return handler(url, init);
	}) as unknown as typeof fetch;
	return { fn, calls };
}
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// REAL responses captured from the live APIs (see fixtures/README.md).
export const usdaSearch = usdaSearchFx; // search "greek yogurt": first food is fdcId 2035482
export const usdaDetail = usdaDetailFx; // detail for fdcId 2035482
export const offSearch = offSearchFx; // search-a-licious "skyr"
export const offProduct = offProductFx; // barcode 3017620422003 (Nutella)

/** The label nutrients a test does not care about, all 0. Spread it into a food: { kcal: 100, ..., ...REST }. */
export const REST = { fiber_g: 0, sugar_g: 0, added_sugar_g: 0, saturated_fat_g: 0, trans_fat_g: 0, cholesterol_mg: 0, sodium_mg: 0 };

// SYNTHETIC edge cases: shapes real data rarely contains, so we write them by hand.
export const usdaEdge = {
	foods: [
		{ fdcId: 900001, description: "Missing carbs", foodNutrients: [{ nutrientId: 1008, value: 100 }, { nutrientId: 1003, value: 1 }, { nutrientId: 1004, value: 1 }] },
		{ fdcId: 900002, description: "Energy only as Atwater", foodNutrients: [{ nutrientId: 2047, value: 120 }, { nutrientId: 1003, value: 5 }, { nutrientId: 1004, value: 2 }, { nutrientId: 1005, value: 20 }] },
	],
};
export const offEdge = {
	hits: [
		{ code: "900101", product_name: "Kilojoules only", brands: "Maker A, Maker B", nutriments: { energy_100g: 1046, proteins_100g: 5, fat_100g: 10, carbohydrates_100g: 30 } },
		{ code: "900102", product_name: "Salt but no sodium", brands: [], nutriments: { "energy-kcal_100g": 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1, salt_100g: 2.5 } },
		{ code: "900103", product_name: "No nutrition data", nutriments: {} },
		{ code: "900104", product_name: "", nutriments: { "energy-kcal_100g": 1, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 } },
	],
};

/** All of a user's foods (active ones unless includeArchived). Test-only: the app searches instead of listing. */
export async function listFoods(db: D1Database, userId: string, includeArchived = false): Promise<Food[]> {
	const where = includeArchived ? "" : "AND archived_at IS NULL";
	return (await db.prepare(`SELECT * FROM foods WHERE user_id = ? ${where} ORDER BY name`).bind(userId).all<Food>()).results;
}

/** Logs one food in grams and returns that log with its nutrients and the day's totals. */
export async function logFood(db: D1Database, userId: string, input: { meal_type: any; food_id: string; grams: number; date?: string; eaten_at?: string; note?: string; eaten?: boolean; mindfulness_score?: number }) {
	const { food_id, grams, ...rest } = input;
	const r = await logEntries(db, userId, { ...rest, ...{ client_request_id: crypto.randomUUID() }, entries: [{ food_id, grams }] });
	const log = (await getDay(db, userId, r.day.date)).food_logs.find((l) => l.log_id === r.log_ids[0])!;
	return { log_id: log.log_id, meal_type: log.meal_type, food_name: log.food_name, grams: log.grams, nutrients: log.nutrients, day: r.day };
}
