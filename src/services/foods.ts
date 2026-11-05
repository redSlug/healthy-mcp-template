// search_foods, add_food and import_food. Your own foods always win; outside databases are only a fallback,
// and anything imported is saved so each food is fetched once.
import { createFood, DataError, findDuplicateFood, getFood, getFoodByExternal, getFoodsByIds, searchFoods as searchLocalFoods, updateFood as dbUpdateFood, type Food, type UserId } from "../data";
import { ExternalApiError, type ExternalFood, type ExternalSource, type FoodApiClients } from "../foodapis";
import { EXTRA_KEYS, NUTRIENT_KEYS, round1, roundKcal, roundNutrients, scale, sum, type ExtraKey, type NutrientValues, type Nutrients } from "../nutrition";

const fail = (message: string, field: string) => new DataError("validation_failed", message, field);
const SOURCES: ExternalSource[] = ["usda", "off"];

const displayPer100 = (f: NutrientValues): Nutrients => roundNutrients(scale(f, 100));

interface MealItem {
	food_id: string;
	grams: number;
}

function savedView(f: Food) {
	return {
		food_id: f.id, saved: true as const, type: f.kind, name: f.name, brand: f.brand, serving_g: f.serving_g, source: f.source, verified: f.verified === 1,
		per_100g: displayPer100(f), notes: f.notes,
	};
}
/** Outside values, rounded for display. A nutrient the source does not list stays null, and is named in `missing`. */
function externalView(f: ExternalFood) {
	const p = f.per_100g;
	const per_100g = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, p[k] == null ? null : k === "kcal" ? roundKcal(p[k]) : round1(p[k])])) as Record<keyof Nutrients, number | null>;
	return {
		food_id: null,
		saved: false as const,
		type: "food" as const,
		external_source: f.external_source,
		external_id: f.external_id,
		name: f.name,
		brand: f.brand,
		serving_g: f.serving_g,
		per_100g,
		missing: EXTRA_KEYS.filter((k) => p[k] == null),
	};
}

/** Outside databases contain bad rows (e.g. 1,280 or 5,330 kcal per 100 g). Nothing exceeds about 900 kcal per 100 g (pure fat). */
function isPlausiblePer100(n: { kcal: number; protein_g: number; fat_g: number; carbs_g: number }): boolean {
	return n.kcal <= 900 && n.protein_g <= 100 && n.fat_g <= 100 && n.carbs_g <= 100 && n.protein_g + n.fat_g + n.carbs_g <= 105;
}

export interface SearchInput {
	query: string;
	limit?: number;
	include_external?: boolean;
}

/** Local foods first; outside databases only when there are fewer local matches than `limit`. */
export async function searchFoods(db: D1Database, userId: UserId, clients: FoodApiClients, input: SearchInput) {
	const query = input.query.trim();
	const limit = input.limit ?? 5;

	const local = await searchLocalFoods(db, userId, query, limit);
	const results: (ReturnType<typeof savedView> | ReturnType<typeof externalView>)[] = local.map(savedView);
	const warnings: string[] = [];

	if ((input.include_external ?? true) && local.length < limit) {
		const settled = await Promise.allSettled(SOURCES.map((s) => clients.search(s, query, limit)));
		let failures = 0;
		const bySource: ExternalFood[][] = [];
		settled.forEach((r, i) => {
			if (r.status === "fulfilled") bySource.push(r.value);
			else {
				failures++;
				warnings.push(`${SOURCES[i] === "usda" ? "USDA" : "Open Food Facts"} is unavailable right now.`);
			}
		});
		if (failures === SOURCES.length && results.length === 0) {
			throw new DataError("external_api_unavailable", "Could not reach USDA or Open Food Facts. Try again, or add the food from its label.");
		}
		// Take turns between sources so one cannot fill every slot (USDA used to push Open Food Facts out entirely).
		const found: ExternalFood[] = [];
		for (let i = 0; bySource.some((l) => i < l.length); i++) for (const l of bySource) if (i < l.length) found.push(l[i]);
		let hidden = 0;
		for (const f of found) {
			if (results.length >= limit) break;
			if (!isPlausiblePer100(f.per_100g)) {
				hidden++;
				continue;
			}
			if (await getFoodByExternal(db, userId, f.external_source, f.external_id)) continue; // already saved, so already listed above
			results.push(externalView(f));
		}
		if (hidden) warnings.push(`Hid ${hidden} outside result${hidden === 1 ? "" : "s"} with impossible nutrient values.`);
	}
	return warnings.length ? { results, warnings } : { results };
}

export type NutrientInput = NutrientValues;
export interface AddFoodInput {
	name: string;
	/** Required with per_100g or per_serving. Use "estimate" if even one value is a guess. A meal made from items is a 'recipe' (or 'estimate' if an ingredient is); one made from totals is an 'estimate'. */
	source?: "label" | "usda" | "off" | "estimate";
	brand?: string | null;
	serving_g?: number | null;
	per_100g?: NutrientInput;
	per_serving?: NutrientInput;
	/** A meal (recipe) made from foods the user already saved. The server adds up the nutrients. */
	items?: MealItem[];
	/** A figure the user states for a whole meal ("about 600 calories"); the weight is required. */
	totals?: NutrientInput & { total_grams: number };
	external_id?: string | null;
	verified?: boolean;
	notes?: string | null;
}

/** Sanity limits on per-100g values, to catch a per-serving or whole-meal number entered as per-100g. */
function checkPer100(n: NutrientValues) {
	if (n.kcal > 1000) throw fail("More than 1000 kcal per 100 g is not possible. Are these per-serving values?", "per_100g");
	for (const k of NUTRIENT_KEYS) if (k !== "kcal" && !k.endsWith("_mg") && n[k] > 100) throw fail("A nutrient above 100 g per 100 g is not possible.", "per_100g");
	if (n.protein_g + n.fat_g + n.carbs_g > 105) throw fail("Protein, fat and carbs together cannot exceed 100 g per 100 g.", "per_100g");
	// Parts cannot exceed their whole (1 g of slack for label rounding).
	if (n.saturated_fat_g + n.trans_fat_g > n.fat_g + 1) throw fail("Saturated plus trans fat cannot exceed total fat.", "per_100g");
	if (n.sugar_g > n.carbs_g + 1 || n.fiber_g > n.carbs_g + 1) throw fail("Sugar and fiber cannot exceed total carbs.", "per_100g");
	if (n.added_sugar_g > n.sugar_g + 1) throw fail("Added sugar cannot exceed total sugar.", "per_100g");
	if (n.sodium_mg > 40000 || n.cholesterol_mg > 40000) throw fail("Sodium or cholesterol above 40000 mg per 100 g is not possible.", "per_100g");
}

/** Calories should roughly match the macros at 4/4/9 kcal per gram. A big gap usually means a mistyped number. */
function calorieWarnings(n: NutrientValues): string[] {
	const fromMacros = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g;
	if (Math.abs(n.kcal - fromMacros) <= 0.25 * Math.max(n.kcal, fromMacros) + 20) return [];
	return [`Check these numbers: ${roundKcal(n.kcal)} kcal per 100 g, but the macros add up to about ${roundKcal(fromMacros)} kcal (4 kcal per g of protein and carbs, 9 per g of fat). Fix it with update_food if one is wrong.`];
}

const times = (n: Nutrients, k: number): Nutrients => Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, n[key] * k])) as unknown as Nutrients;

/** Adds up saved foods into one meal: its per-100g values, its weight, its source (estimate if any ingredient is one) and a "Made of" line for its notes. */
async function sumItems(db: D1Database, userId: UserId, items: MealItem[]) {
	const foods = await getFoodsByIds(db, userId, items.map((it) => it.food_id));
	let totalGrams = 0;
	let source: Food["source"] = "recipe";
	const parts: Nutrients[] = [];
	const names: string[] = [];
	for (const [i, it] of items.entries()) {
		const food = foods.get(it.food_id);
		if (!food) throw new DataError("unknown_food_id", "No food with that id. Use search_foods to get a food_id.", `items[${i}].food_id`);
		parts.push(scale(food, it.grams));
		totalGrams += it.grams;
		names.push(`${it.grams} g ${food.name}`);
		if (food.source === "estimate") source = "estimate";
	}
	return { per100: times(sum(parts), 100 / totalGrams), servingG: totalGrams, source, madeOf: `Made of: ${names.join(", ")}.` };
}

/** A name and brand (ignoring case) can be used by only one active food. */
async function requireUniqueName(db: D1Database, userId: UserId, name: string, brand: string | null, exceptId?: string) {
	const dup = await findDuplicateFood(db, userId, name, brand, exceptId);
	if (dup) throw new DataError("duplicate", `A food named "${name}" is already saved (food_id=${dup.id}). Use update_food to fix it, archive it first, or pick another name.`, "name");
}

/** Saves a food. A saved meal is a food too: its weight is serving_g, so one serving is the whole meal. */
export async function addFood(db: D1Database, userId: UserId, input: AddFoodInput) {
	const name = input.name.trim();
	if (name.length < 1) throw fail("Name cannot be empty.", "name");
	const given = [input.per_100g, input.per_serving, input.items, input.totals].filter((x) => x != null).length;
	if (given !== 1) throw fail("Give exactly one of per_100g, per_serving, items or totals.", "per_100g");
	await requireUniqueName(db, userId, name, input.brand ?? null);

	let per100: NutrientInput;
	let servingG: number | null = input.serving_g ?? null;
	let source: Food["source"] | undefined = input.source;
	let kind: Food["kind"] = "food";
	let madeOf: string | undefined;
	if (input.items) {
		// Add up the foods' nutrients once, now. Editing a food later does not change this meal.
		({ per100, servingG, source, madeOf } = await sumItems(db, userId, input.items));
		kind = "meal";
	} else if (input.totals) {
		const { total_grams, ...n } = input.totals;
		servingG = total_grams;
		per100 = times(n, 100 / total_grams);
		source = "estimate";
		kind = "meal";
		checkPer100(per100);
	} else {
		if (!source) throw fail("source is required (label, usda, off or estimate).", "source");
		if (input.per_100g) {
			per100 = input.per_100g;
		} else {
			if (!(servingG != null && servingG > 0)) throw fail("per_serving needs serving_g greater than 0.", "serving_g");
			per100 = times(input.per_serving!, 100 / servingG);
		}
		checkPer100(per100);
	}

	const food = await createFood(db, userId, { ...per100, name, brand: input.brand ?? null, kind, serving_g: servingG, source: source!, external_id: input.external_id ?? null, verified: input.verified, notes: [madeOf, input.notes].filter(Boolean).join(" ") || null });
	return { food_id: food.id, name: food.name, type: food.kind, serving_g: food.serving_g, source: food.source, per_100g: displayPer100(food), warnings: calorieWarnings(food) };
}

export interface UpdateFoodInput {
	food_id: string;
	name?: string;
	brand?: string | null;
	serving_g?: number | null;
	notes?: string | null;
	archived?: boolean;
	per_100g?: NutrientInput;
}

/** Fix a food or meal, or archive it (hide it from search). Every past and future log that points at it follows the fix. */
export async function updateFood(db: D1Database, userId: UserId, input: UpdateFoodInput) {
	const { food_id, name, ...rest } = input;
	const trimmed = name?.trim();
	if (trimmed !== undefined && trimmed.length < 1) throw fail("Name cannot be empty.", "name");
	const changes: Parameters<typeof dbUpdateFood>[3] = { ...rest, name: trimmed };
	let warnings: string[] = [];
	if (rest.per_100g) {
		checkPer100(rest.per_100g);
		warnings = calorieWarnings(rest.per_100g);
	}
	if (trimmed !== undefined || rest.brand !== undefined) {
		const current = await getFood(db, userId, food_id);
		if (current) await requireUniqueName(db, userId, trimmed ?? current.name, rest.brand === undefined ? current.brand : rest.brand, food_id);
	}
	const food = await dbUpdateFood(db, userId, food_id, changes);
	return { food_id: food.id, name: food.name, type: food.kind, serving_g: food.serving_g, archived: food.archived_at !== null, per_100g: displayPer100(food), warnings };
}

/** Values the assistant estimated for what the outside database leaves out. */
export type Fill = Partial<Record<ExtraKey, number>>;

/**
 * Copy an outside food into the user's foods. Importing the same item twice returns the existing food.
 * Anything the source does not list must be sent in `fill` (estimated by the assistant); a food with even one
 * filled value is saved with source "estimate".
 */
export async function importFood(db: D1Database, userId: UserId, clients: FoodApiClients, input: { external_source: ExternalSource; external_id: string; fill?: Fill }) {
	const existing = await getFoodByExternal(db, userId, input.external_source, input.external_id);
	if (existing) return { food_id: existing.id, name: existing.name, source: existing.source, per_100g: displayPer100(existing), already_saved: true };

	let ext: ExternalFood | null;
	try {
		ext = await clients.get(input.external_source, input.external_id);
	} catch (e) {
		if (e instanceof ExternalApiError) throw new DataError("external_api_unavailable", e.message);
		throw e;
	}
	if (!ext) throw fail("No food with that id at that source, or it is missing calories or macros.", "external_id");

	if (!isPlausiblePer100(ext.per_100g)) throw fail("That entry has impossible nutrient values (bad data at the source). Pick another result, or use add_food with the label values.", "external_id");

	const missing = EXTRA_KEYS.filter((k) => ext!.per_100g[k] == null);
	const stillMissing = missing.filter((k) => input.fill?.[k] == null);
	if (stillMissing.length) throw fail(`That food does not list: ${stillMissing.join(", ")}. Estimate them per 100 g and send them in fill (the food is then saved as an estimate).`, "fill");

	const per100 = { ...ext.per_100g } as Nutrients;
	for (const k of missing) per100[k] = input.fill![k]!;

	const food = await createFood(db, userId, { ...per100, name: ext.name, brand: ext.brand, serving_g: ext.serving_g, source: missing.length ? "estimate" : ext.external_source, external_id: ext.external_id, verified: false });
	return { food_id: food.id, name: food.name, source: food.source, per_100g: displayPer100(food), already_saved: false };
}
