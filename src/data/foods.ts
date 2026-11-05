import { NUTRIENT_KEYS, type NutrientValues } from "../nutrition";
import { DataError, newId, now, type UserId } from "./types";
import { updateRow } from "./update";
import { WATER_FOOD_NAME } from "./users";

/** Nutrient values here are per 100 g. */
export interface NewFood extends NutrientValues {
	name: string;
	brand?: string | null;
	/** A meal is a food made of several foods. */
	kind?: "food" | "meal";
	serving_g?: number | null;
	source: "label" | "usda" | "off" | "estimate" | "recipe";
	external_id?: string | null;
	verified?: boolean;
	notes?: string | null;
}

/** A saved food. Nutrient values are per 100 g. */
export interface Food extends NutrientValues {
	id: string;
	user_id: string;
	name: string;
	brand: string | null;
	kind: "food" | "meal";
	serving_g: number | null;
	source: "label" | "usda" | "off" | "estimate" | "recipe";
	external_id: string | null;
	verified: number;
	notes: string | null;
	archived_at: string | null;
}

/** Two active foods cannot share a name and brand (ignoring case). Returns the existing one, if any. */
export async function findDuplicateFood(db: D1Database, userId: UserId, name: string, brand: string | null, exceptId?: string): Promise<{ id: string } | null> {
	return db
		.prepare("SELECT id FROM foods WHERE user_id = ? AND lower(name) = lower(?) AND lower(COALESCE(brand, '')) = lower(?) AND archived_at IS NULL AND id != ? LIMIT 1")
		.bind(userId, name, brand ?? "", exceptId ?? "")
		.first<{ id: string }>();
}

export async function createFood(db: D1Database, userId: UserId, f: NewFood): Promise<Food> {
	const id = newId();
	const ts = now();
	try {
		const cols = ["id", "user_id", "name", "brand", "kind", "serving_g", ...NUTRIENT_KEYS, "source", "external_id", "verified", "notes", "created_at", "updated_at"];
		await db.batch([
			db
				.prepare(`INSERT INTO foods (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
				.bind(id, userId, f.name, f.brand ?? null, f.kind ?? "food", f.serving_g ?? null, ...NUTRIENT_KEYS.map((k) => f[k]), f.source, f.external_id ?? null, f.verified ? 1 : 0, f.notes ?? null, ts, ts),
			db.prepare("INSERT INTO foods_fts (food_id, user_id, name, brand) VALUES (?, ?, ?, ?)").bind(id, userId, f.name, f.brand ?? ""),
		]);
	} catch (e) {
		if (String(e).includes("UNIQUE")) throw new DataError("duplicate", "That food was already saved.", "external_id");
		throw e;
	}
	return (await getFood(db, userId, id)) as Food;
}

export async function getFood(db: D1Database, userId: UserId, foodId: string): Promise<Food | null> {
	return db.prepare("SELECT * FROM foods WHERE id = ? AND user_id = ?").bind(foodId, userId).first<Food>();
}

/** Several of the user's foods in one query, by id. Ids that are not theirs are simply missing from the map. */
export async function getFoodsByIds(db: D1Database, userId: UserId, ids: string[]): Promise<Map<string, Food>> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return new Map();
	const rows = (await db.prepare(`SELECT * FROM foods WHERE user_id = ? AND id IN (${unique.map(() => "?").join(",")})`).bind(userId, ...unique).all<Food>()).results;
	return new Map(rows.map((f) => [f.id, f]));
}

/** Local food search over name and brand. Each term is quoted so user text can't inject FTS syntax. */
export async function searchFoods(db: D1Database, userId: UserId, query: string, limit = 5): Promise<Food[]> {
	const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
	if (terms.length === 0) return [];
	const match = terms.map((t) => `"${t}"*`).join(" ");
	const rows = await db
		.prepare(
			`SELECT f.* FROM foods_fts x JOIN foods f ON f.id = x.food_id AND f.user_id = x.user_id
			 WHERE x.user_id = ? AND foods_fts MATCH ? AND f.archived_at IS NULL LIMIT ?`,
		)
		.bind(userId, match, limit)
		.all<Food>();
	return rows.results;
}

export async function getFoodByExternal(db: D1Database, userId: UserId, source: string, externalId: string): Promise<Food | null> {
	return db
		.prepare("SELECT * FROM foods WHERE user_id = ? AND source IN (?, 'estimate') AND external_id = ?") // an import with estimated values is saved as 'estimate'
		.bind(userId, source, externalId)
		.first<Food>();
}

export interface FoodChanges {
	name?: string;
	brand?: string | null;
	serving_g?: number | null;
	notes?: string | null;
	archived?: boolean;
	/** New per-100g values; every nutrient is replaced together. */
	per_100g?: NutrientValues;
	source?: Food["source"];
}

/** Edits a food. Logs point at the food, so a fix changes every past and future total that uses it. Keeps the search index in step. */
export async function updateFood(db: D1Database, userId: UserId, foodId: string, c: FoodChanges): Promise<Food> {
	const n = c.per_100g;
	const row = await updateRow<Food>(
		db, "foods", userId, foodId,
		{
			name: c.name, brand: c.brand, serving_g: c.serving_g, notes: c.notes,
			archived_at: c.archived === undefined ? undefined : c.archived ? now() : null,
			source: c.source,
			...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n?.[k]])),
		},
		() => new DataError("unknown_food_id", "No food with that id. Use search_foods to get a food_id.", "food_id"),
	);
	if (c.name !== undefined || c.brand !== undefined) {
		await db.batch([
			db.prepare("DELETE FROM foods_fts WHERE food_id = ? AND user_id = ?").bind(foodId, userId),
			db.prepare("INSERT INTO foods_fts (food_id, user_id, name, brand) VALUES (?, ?, ?, ?)").bind(foodId, userId, row.name, row.brand ?? ""),
		]);
	}
	return row;
}

/** The user's "Water" food (seeded at sign-in). Null only if they renamed it. */
export async function findWaterFood(db: D1Database, userId: UserId): Promise<{ id: string } | null> {
	return db.prepare("SELECT id FROM foods WHERE user_id = ? AND name = ? AND source = 'label' ORDER BY created_at LIMIT 1").bind(userId, WATER_FOOD_NAME).first<{ id: string }>();
}
