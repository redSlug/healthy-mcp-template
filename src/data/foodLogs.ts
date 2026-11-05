import { NUTRIENT_KEYS, type NutrientValues } from "../nutrition";
import { requestInsert } from "./requests";
import { updateRow } from "./update";
import { DataError, newId, now, type MealType, type UserId } from "./types";

export interface NewFoodLog {
	date: string;
	meal_type: MealType;
	food_id: string;
	grams: number;
	note?: string | null;
	eaten?: boolean;
	mindfulness_score?: number | null;
	eaten_at?: string;
}

export interface FoodLog {
	id: string;
	user_id: string;
	date: string;
	meal_type: MealType;
	food_id: string;
	grams: number;
	note: string | null;
	eaten: number;
	mindfulness_score: number | null;
	eaten_at: string;
	archived_at: string | null;
}

/** The INSERT for one food log, so a caller can run several together in one db.batch. */
function foodLogInsert(db: D1Database, userId: UserId, l: NewFoodLog, id = newId(), ts = now()) {
	return db
		.prepare(
			`INSERT INTO food_logs (id, user_id, date, meal_type, food_id, grams, note, eaten, mindfulness_score, eaten_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(id, userId, l.date, l.meal_type, l.food_id, l.grams, l.note ?? null, l.eaten === false ? 0 : 1, l.mindfulness_score ?? null, l.eaten_at ?? ts, ts, ts);
}

const unknownFood = () => new DataError("unknown_food_id", "No food with that id. Use search_foods to get a food_id.", "food_id");

async function requireOwnFood(db: D1Database, userId: UserId, foodId: string) {
	if (!(await db.prepare("SELECT 1 AS ok FROM foods WHERE id = ? AND user_id = ?").bind(foodId, userId).first())) throw unknownFood();
}

export async function createFoodLog(db: D1Database, userId: UserId, l: NewFoodLog): Promise<FoodLog> {
	await requireOwnFood(db, userId, l.food_id);
	const id = newId();
	await foodLogInsert(db, userId, l, id).run();
	return (await getFoodLog(db, userId, id))!;
}

/**
 * Writes several food logs, and the request record that makes a retry safe, in ONE db.batch (a single transaction): every row is saved or none is.
 * The composite foreign key rejects a row that points at another user's food, which rolls the whole batch back.
 */
export async function createFoodLogsAtomically(db: D1Database, userId: UserId, logs: NewFoodLog[], request: { id: string; date: string }): Promise<string[]> {
	const ids = logs.map(() => newId());
	await db.batch([...logs.map((l, i) => foodLogInsert(db, userId, l, ids[i])), requestInsert(db, userId, request.id, request.date, ids)]);
	return ids;
}

export async function getFoodLog(db: D1Database, userId: UserId, logId: string): Promise<FoodLog | null> {
	return db.prepare("SELECT * FROM food_logs WHERE id = ? AND user_id = ? AND archived_at IS NULL").bind(logId, userId).first<FoodLog>();
}

export interface FoodLogChanges {
	meal_type?: MealType;
	date?: string;
	eaten_at?: string;
	note?: string | null;
	eaten?: boolean;
	mindfulness_score?: number | null;
	grams?: number;
}

export async function updateFoodLog(db: D1Database, userId: UserId, logId: string, c: FoodLogChanges): Promise<FoodLog> {
	const { eaten, ...rest } = c;
	return updateRow<FoodLog>(db, "food_logs", userId, logId, { ...rest, eaten: eaten === undefined ? undefined : eaten ? 1 : 0 }, () => new DataError("unknown_food_log_id", "No log with that id. Use get_day to see log_ids.", "log_id"));
}

/** Archives a log (it is kept, but left out of every day and total). False if it was not there or already archived. */
export async function archiveFoodLog(db: D1Database, userId: UserId, logId: string): Promise<boolean> {
	const ts = now();
	const r = await db.prepare("UPDATE food_logs SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL").bind(ts, ts, logId, userId).run();
	return (r.meta.changes ?? 0) > 0;
}

export interface DayFoodRow extends NutrientValues {
	id: string;
	meal_type: MealType;
	food_id: string;
	grams: number;
	note: string | null;
	eaten: number;
	mindfulness_score: number | null;
	eaten_at: string;
	food_name: string;
}

/** A day's food logs joined with their foods' per-100g values, in eaten order. */
export async function listDayFoodLogs(db: D1Database, userId: UserId, date: string): Promise<DayFoodRow[]> {
	return (
		await db
			.prepare(
				`SELECT l.id, l.meal_type, l.food_id, l.grams, l.note, l.eaten, l.mindfulness_score, l.eaten_at,
				        f.name AS food_name, ${NUTRIENT_KEYS.map((k) => `f.${k}`).join(", ")}
				 FROM food_logs l JOIN foods f ON f.id = l.food_id AND f.user_id = l.user_id
				 WHERE l.user_id = ? AND l.date = ? AND l.archived_at IS NULL
				 ORDER BY l.eaten_at, l.created_at`,
			)
			.bind(userId, date)
			.all<DayFoodRow>()
	).results;
}
