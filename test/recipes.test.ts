import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser, searchFoods as dbSearch } from "../src/data";
import { createFoodApiClients } from "../src/foodapis";
import { addFood, searchFoods, updateFood } from "../src/services/foods";
import { getDay, logEntries } from "../src/services/logs";

import { REST } from "./helpers";
const db = env.DB;
const noInternet = createFoodApiClients("k", (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
let a: string, b: string, oats: string, milk: string;

beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "6001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "6002" })).id;
	oats = (await createFood(db, a, { name: "Oats", kcal: 400, protein_g: 10, fat_g: 5, carbs_g: 70, ...REST, source: "label" })).id;
	milk = (await createFood(db, a, { name: "Milk", kcal: 50, protein_g: 3, fat_g: 2, carbs_g: 5, ...REST, source: "label" })).id;
});

describe("a saved meal is a food with kind meal", () => {
	it("add_food with items sums the foods; its weight is one serving", async () => {
		const r = await addFood(db, a, { name: "Porridge", items: [{ food_id: oats, grams: 50 }, { food_id: milk, grams: 150 }] });
		expect(r.serving_g).toBe(200);
		expect(r.per_100g).toMatchObject({ kcal: 138 }); // (200 + 75) kcal over 200 g is 137.5 per 100 g, shown rounded
		const log = await logEntries(db, a, { client_request_id: crypto.randomUUID(), meal_type: "breakfast", date: "2026-04-01", entries: [{ food_id: r.food_id, servings: 1 }] });
		expect(log.day.eaten.kcal).toBe(275);
		const half = await logEntries(db, a, { client_request_id: crypto.randomUUID(), meal_type: "snack", date: "2026-04-02", entries: [{ food_id: r.food_id, servings: 0.5 }] });
		expect(half.day.eaten.kcal).toBe(138); // 137.5 rounded
	});
	it("add_food with totals needs the meal's weight, and the stated figures are for the whole meal", async () => {
		const r = await addFood(db, a, { name: "Restaurant lunch", totals: { ...REST, total_grams: 300, kcal: 600, protein_g: 30, fat_g: 20, carbs_g: 70 } });
		expect(r).toMatchObject({ type: "meal", source: "estimate", serving_g: 300, per_100g: { kcal: 200, protein_g: 10 } });
		const log = await logEntries(db, a, { client_request_id: crypto.randomUUID(), meal_type: "lunch", date: "2026-04-03", entries: [{ food_id: r.food_id, servings: 1 }] });
		expect(log.day.eaten).toMatchObject({ kcal: 600, protein_g: 30 });
	});
	it("a whole-meal total stored as per-100g (the Regular Smoothie bug) is caught by the sanity limits", async () => {
		await expect(addFood(db, a, { name: "Bad smoothie", totals: { ...REST, total_grams: 20, kcal: 242, protein_g: 7.3, fat_g: 8.4, carbs_g: 34.3 } })).rejects.toMatchObject({ code: "validation_failed" });
	});
	it("a meal from items lists its ingredients in notes, shown by search", async () => {
		await addFood(db, a, { name: "Overnight oats", notes: "No sugar added.", items: [{ food_id: oats, grams: 40 }, { food_id: milk, grams: 100 }] });
		const found = (await searchFoods(db, a, noInternet, { query: "overnight oats", include_external: false })).results[0] as any;
		expect(found).toMatchObject({ type: "meal", source: "recipe", notes: "Made of: 40 g Oats, 100 g Milk. No sugar added." });
	});
	it("a meal with an estimated ingredient is itself an estimate", async () => {
		const guess = (await createFood(db, a, { name: "Homemade sauce", kcal: 80, protein_g: 1, fat_g: 4, carbs_g: 10, ...REST, source: "estimate" })).id;
		expect((await addFood(db, a, { name: "Pasta night", items: [{ food_id: oats, grams: 50 }, { food_id: guess, grams: 50 }] })).source).toBe("estimate");
	});
	it("a food without a serving size needs grams, not servings", async () => {
		await expect(logEntries(db, a, { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: oats, servings: 1 }] })).rejects.toMatchObject({ code: "validation_failed" });
	});
	it("a bad entry in a batch saves nothing, and another user's food is refused", async () => {
		await expect(logEntries(db, a, { client_request_id: crypto.randomUUID(), meal_type: "lunch", date: "2026-04-04", entries: [{ food_id: oats, grams: 10 }, { food_id: "00000000-0000-4000-8000-000000000000", grams: 10 }] })).rejects.toMatchObject({ code: "unknown_food_id" });
		expect((await getDay(db, a, "2026-04-04")).food_logs).toEqual([]);
		await expect(logEntries(db, b, { client_request_id: crypto.randomUUID(), meal_type: "lunch", entries: [{ food_id: oats, grams: 10 }] })).rejects.toMatchObject({ code: "unknown_food_id" });
	});
});

describe("names are unique", () => {
	it("refuses a second active food with the same name and brand (ignoring case), on add and on rename", async () => {
		const n = { ...REST, kcal: 100, protein_g: 5, fat_g: 2, carbs_g: 15 };
		await addFood(db, a, { name: "Regular Smoothie", source: "estimate", per_100g: n });
		await expect(addFood(db, a, { name: "regular smoothie", source: "estimate", per_100g: n })).rejects.toMatchObject({ code: "duplicate" });
		const other = await addFood(db, a, { name: "Regular Smoothie", brand: "Trimona", source: "estimate", per_100g: n });
		await expect(updateFood(db, a, { food_id: other.food_id, brand: null })).rejects.toMatchObject({ code: "duplicate" });
		await updateFood(db, a, { food_id: other.food_id, archived: true });
		await expect(addFood(db, a, { name: "Regular Smoothie", brand: "Trimona", source: "estimate", per_100g: n })).resolves.toBeTruthy();
	});
	it("warns when calories do not match the macros", async () => {
		const bad = await addFood(db, a, { name: "Odd shake", source: "estimate", per_100g: { ...REST, kcal: 242, protein_g: 7.3, fat_g: 0, carbs_g: 0 } });
		expect(bad.warnings[0]).toMatch(/macros add up to about 29 kcal/);
		const ok = await addFood(db, a, { name: "Fine shake", source: "estimate", per_100g: { ...REST, kcal: 90, protein_g: 2.7, fat_g: 3.1, carbs_g: 12.8 } });
		expect(ok.warnings).toEqual([]);
	});
	it("rejects parts bigger than their whole", async () => {
		await expect(addFood(db, a, { name: "Odd", source: "label", per_100g: { ...REST, kcal: 100, protein_g: 1, fat_g: 2, carbs_g: 10, saturated_fat_g: 5 } })).rejects.toMatchObject({ code: "validation_failed" });
	});
});

describe("update_food", () => {
	it("fixes nutrients for past logs too, renames in search, and archives", async () => {
		const f = await createFood(db, a, { name: "Yoghurt", kcal: 100, protein_g: 5, fat_g: 1, carbs_g: 10, ...REST, source: "label" });
		await logEntries(db, a, { client_request_id: crypto.randomUUID(), meal_type: "snack", date: "2026-04-05", entries: [{ food_id: f.id, grams: 100 }] });
		await updateFood(db, a, { food_id: f.id, per_100g: { ...REST, kcal: 60, protein_g: 5, fat_g: 1, carbs_g: 10 } });
		expect((await getDay(db, a, "2026-04-05")).totals.eaten.kcal).toBe(60);

		await updateFood(db, a, { food_id: f.id, name: "Skyr" });
		expect((await dbSearch(db, a, "skyr")).map((x) => x.id)).toContain(f.id);
		expect((await dbSearch(db, a, "yoghurt")).map((x) => x.id)).not.toContain(f.id);

		await updateFood(db, a, { food_id: f.id, archived: true });
		expect((await dbSearch(db, a, "skyr")).map((x) => x.id)).not.toContain(f.id);
	});
	it("another user cannot change my food", async () => {
		await expect(updateFood(db, b, { food_id: oats, name: "Hacked" })).rejects.toMatchObject({ code: "unknown_food_id" });
	});
});
