import { describe, expect, it } from "vitest";
import { createFoodApiClients, ExternalApiError } from "../src/foodapis";
import { json, mockFetch, offEdge, offProduct, offSearch, usdaDetail, usdaEdge, usdaSearch } from "./helpers";

describe("USDA client (real captured responses)", () => {
	it("searches, sends the key and a User-Agent, and normalizes per-100g values", async () => {
		const m = mockFetch(() => json(usdaSearch));
		const foods = await createFoodApiClients("test-key", m.fn).search("usda", "greek yogurt", 10);
		expect(m.calls[0].url.host).toBe("api.nal.usda.gov");
		expect(m.calls[0].url.pathname).toBe("/fdc/v1/foods/search");
		expect(m.calls[0].url.searchParams.get("query")).toBe("greek yogurt");
		expect(m.calls[0].headers.get("x-api-key")).toBe("test-key");
		expect(m.calls[0].headers.get("user-agent")).toMatch(/Healthy/);
		expect(foods[0]).toMatchObject({
			external_source: "usda", external_id: "2035482", name: "GREEK YOGURT", brand: "OCEAN SPRAY", serving_g: 30,
			per_100g: { kcal: 467, protein_g: 3.33, fat_g: 20, carbs_g: 70, fiber_g: 3.3, sodium_mg: 33 },
		});
		expect(Object.keys(foods[0].per_100g).sort()).toEqual(["added_sugar_g", "carbs_g", "cholesterol_mg", "fat_g", "fiber_g", "kcal", "protein_g", "saturated_fat_g", "sodium_mg", "sugar_g", "trans_fat_g"]);
		expect(foods).toHaveLength(usdaSearch.foods.length); // every real result had complete nutrition
	});
	it("reads the detail shape (nutrient.id and amount), matching the search result", async () => {
		const m = mockFetch(() => json(usdaDetail));
		const f = await createFoodApiClients("k", m.fn).get("usda", "2035482");
		expect(m.calls[0].url.pathname).toBe("/fdc/v1/food/2035482");
		expect(f).toMatchObject({ external_id: "2035482", brand: "OCEAN SPRAY", per_100g: { kcal: 467, protein_g: 3.33, fat_g: 20, carbs_g: 70, sodium_mg: 33 } });
	});
	it("skips foods missing a macro, and falls back to Atwater energy (synthetic edge cases)", async () => {
		const foods = await createFoodApiClients("k", mockFetch(() => json(usdaEdge)).fn).search("usda", "x", 10);
		expect(foods.map((f) => f.external_id)).toEqual(["900002"]);
		expect(foods[0].per_100g.kcal).toBe(120);
	});
	it("turns HTTP errors and network failures into ExternalApiError", async () => {
		await expect(createFoodApiClients("k", mockFetch(() => json({}, 500)).fn).search("usda", "x", 5)).rejects.toBeInstanceOf(ExternalApiError);
		await expect(createFoodApiClients("k", mockFetch(() => json({}, 403)).fn).search("usda", "x", 5)).rejects.toMatchObject({ source: "usda" });
		const down = mockFetch(() => { throw new Error("offline"); });
		await expect(createFoodApiClients("k", down.fn).search("usda", "x", 5)).rejects.toBeInstanceOf(ExternalApiError);
	});
});

describe("Open Food Facts client (real captured responses)", () => {
	it("searches the search-a-licious service with no key, sends a User-Agent, and converts sodium from grams to mg", async () => {
		const m = mockFetch(() => json(offSearch));
		const foods = await createFoodApiClients("test-key", m.fn).search("off", "skyr", 10);
		expect(m.calls[0].url.host).toBe("search.openfoodfacts.org");
		expect(m.calls[0].url.searchParams.get("q")).toBe("skyr");
		expect(m.calls[0].headers.get("user-agent")).toMatch(/Healthy/);
		expect(m.calls[0].headers.get("x-api-key")).toBeNull();
		expect(foods[0]).toMatchObject({ external_source: "off", external_id: "4316268627979", name: "Compote", brand: "Skyr", serving_g: null });
		expect(foods[0].per_100g).toMatchObject({ kcal: 65, protein_g: 10.6, fat_g: 0.2, carbs_g: 4.4 });
		expect(foods[0].per_100g.sodium_mg).toBeCloseTo(76, 6); // 0.076 g
	});
	it("fetches one product by barcode, taking the first brand", async () => {
		const m = mockFetch(() => json(offProduct));
		const f = await createFoodApiClients("k", m.fn).get("off", "3017620422003");
		expect(m.calls[0].url.pathname).toBe("/api/v2/product/3017620422003.json");
		expect(f).toMatchObject({ external_id: "3017620422003", name: "Nutella", brand: "Nutella" });
		expect(f?.per_100g).toMatchObject({ kcal: 539 });
	});
	it("returns null for a barcode that does not exist (the real API answers HTTP 200 with status 0)", async () => {
		const body = { code: null, status: 0, status_verbose: "no code or invalid code" };
		expect(await createFoodApiClients("k", mockFetch(() => json(body)).fn).get("off", "1")).toBeNull();
	});
	it("handles kJ-only energy, salt-only sodium, comma-separated brands and unusable products (synthetic edge cases)", async () => {
		const foods = await createFoodApiClients("k", mockFetch(() => json(offEdge)).fn).search("off", "x", 10);
		expect(foods.map((f) => f.external_id)).toEqual(["900101", "900102"]); // no-nutrition and no-name products are skipped
		expect(foods[0].per_100g.kcal).toBeCloseTo(250, 0); // 1046 kJ
		expect(foods[0].brand).toBe("Maker A");
		expect(foods[1].per_100g.sodium_mg).toBeCloseTo(1000, 6); // 2.5 g salt is 1 g sodium
		expect(foods[1].brand).toBeNull();
	});
	it("turns failures, including the HTML 503 page the old search endpoint returned, into ExternalApiError", async () => {
		const html503 = () => new Response("<!DOCTYPE html><title>Page temporarily unavailable</title>", { status: 503, headers: { "content-type": "text/html" } });
		await expect(createFoodApiClients("k", mockFetch(html503).fn).search("off", "x", 5)).rejects.toMatchObject({ source: "off" });
	});
});
