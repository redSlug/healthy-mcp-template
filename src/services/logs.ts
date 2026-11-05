// log_entries, update_log, archive_log and get_day. Business rules live here; src/tools/ only maps MCP calls onto these.
// Input shape (types, ranges, lengths) is validated by the zod schemas in src/tools/; this file holds the rules that need the database.
// Logs hold a pointer and an amount in grams; nutrients are calculated here.
import {
	createFoodLogsAtomically, DataError, archiveFoodLog, findRequest, findWaterFood, getFoodLog, getFoodsByIds, getTargets, listDayFoodLogs, listWorkoutsForDate,
	updateFoodLog as dbUpdateFoodLog, type DayFoodRow, type MealType, type NewFoodLog, type UserId,
} from "../data";
import { dayTotals, mindfulnessFromStored, mindfulnessToStored, NUTRIENT_KEYS, roundNutrients, scale, type DayEntry, type DayTotals, type NutrientValues } from "../nutrition";
import { isValidDate, localDate, localNoonUtc } from "../time";

import { fail, userTimeZone } from "./common";
import { workoutView } from "./workouts";

/** Fields every log tool accepts. */
export interface LogCommon {
	meal_type?: MealType;
	date?: string;
	eaten_at?: string;
	note?: string;
	eaten?: boolean;
	mindfulness_score?: number;
}
/** One food, as grams or as servings (a serving is the food's serving_g). */
export interface EntryInput { food_id: string; grams?: number; servings?: number }
export interface LogEntriesInput extends LogCommon {
	/** Chosen by the assistant for each new request and re-sent unchanged on a retry, so a retry is not saved twice. */
	client_request_id: string;
	entries?: EntryInput[];
	water_ml?: number;
}

/**
 * Time rules: `eaten_at` wins if given, and the day is its date in the user's time zone. With only a `date`,
 * eaten_at is noon that local day. With neither, it is now and the day is today in the user's time zone.
 */
function resolveTime(tz: string, input: { date?: string; eaten_at?: string }): { date: string; eaten_at: string } {
	if (input.date != null && !isValidDate(input.date)) throw fail("Date must be YYYY-MM-DD.", "date");
	if (input.eaten_at != null) {
		const t = new Date(input.eaten_at);
		if (Number.isNaN(t.getTime())) throw fail("eaten_at must be an ISO 8601 time.", "eaten_at");
		return { date: localDate(t, tz), eaten_at: t.toISOString() };
	}
	if (input.date != null) return { date: input.date, eaten_at: localNoonUtc(input.date, tz) };
	const t = new Date();
	return { date: localDate(t, tz), eaten_at: t.toISOString() };
}

const storedScore = (s: number | undefined) => (s == null ? null : mindfulnessToStored(s));
const shownScore = (s: number | null) => (s == null ? null : mindfulnessFromStored(s));

const foodValues = (r: DayFoodRow): NutrientValues => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, r[k]])) as unknown as NutrientValues;

function foodLogView(r: DayFoodRow) {
	return {
		log_id: r.id, meal_type: r.meal_type, food_id: r.food_id, food_name: r.food_name, grams: r.grams, note: r.note,
		eaten: r.eaten === 1, mindfulness_score: shownScore(r.mindfulness_score), eaten_at: r.eaten_at,
		nutrients: roundNutrients(scale(foodValues(r), r.grams)),
	};
}
export async function getDay(db: D1Database, userId: UserId, date?: string) {
	// The time zone is only needed to work out "today", so a call with a date skips that query.
	const day = date ?? localDate(new Date(), await userTimeZone(db, userId));
	if (!isValidDate(day)) throw fail("Date must be YYYY-MM-DD.", "date");

	const [rows, targets, workouts] = await Promise.all([listDayFoodLogs(db, userId, day), getTargets(db, userId), listWorkoutsForDate(db, userId, day)]);
	const entries: DayEntry[] = rows.map((r) => ({ eaten: r.eaten === 1, nutrients: scale(foodValues(r), r.grams) }));
	const waterMl = rows.filter((r) => r.meal_type === "water" && r.eaten === 1).reduce((sum, r) => sum + r.grams, 0); // 1 g of water = 1 ml
	const totals: DayTotals = dayTotals(day, entries, targets, waterMl);
	// Average mindfulness (1 to 10) over the eaten, non-water entries that have a score; null if none.
	const scored = rows.filter((r) => r.eaten === 1 && r.meal_type !== "water" && r.mindfulness_score != null);
	const mindfulness_avg = scored.length === 0 ? null : mindfulnessFromStored(scored.reduce((s, r) => s + r.mindfulness_score!, 0) / scored.length);
	return { date: day, food_logs: rows.map(foodLogView), workouts: workouts.map(workoutView), totals, mindfulness_avg };
}

async function logResult(db: D1Database, userId: UserId, logId: string, date: string) {
	const { food_logs, totals } = await getDay(db, userId, date);
	const e = food_logs.find((l) => l.log_id === logId)!;
	return { log_id: logId, meal_type: e.meal_type, food_name: e.food_name, grams: e.grams, nutrients: e.nutrients, day: totals };
}

/**
 * One or more foods under one meal type, all or nothing. Each entry is grams, or servings of a saved meal or packaged food.
 * water_ml is a shortcut for drinking water (the server finds the Water food and files it under meal type water).
 * A request id seen before returns the first result without saving again.
 */
export async function logEntries(db: D1Database, userId: UserId, input: LogEntriesInput) {
	const seen = await findRequest(db, userId, input.client_request_id);
	if (seen) return { log_ids: seen.ids, day: (await getDay(db, userId, seen.date)).totals, already_logged: true as const };

	const entries = input.entries ?? [];
	if (entries.length === 0 && input.water_ml === undefined) throw fail("Send entries (food_id with grams or servings), water_ml, or both.", "entries");
	if (entries.length > 0 && input.meal_type === undefined) throw fail("meal_type is required with entries (breakfast, lunch, dinner, snack or dessert).", "meal_type");
	if (input.meal_type === "water" && entries.length > 0 && input.water_ml !== undefined) throw fail("Use water_ml for water, and meal_type for the other foods.", "water_ml");

	const t = resolveTime(await userTimeZone(db, userId), input);
	const foodsById = await getFoodsByIds(db, userId, entries.map((e) => e.food_id));

	// Validate every entry before anything is written, so a bad one is reported by name.
	const logs: NewFoodLog[] = [];
	const row = (food_id: string, grams: number, meal_type: MealType): NewFoodLog => ({ date: t.date, eaten_at: t.eaten_at, meal_type, food_id, grams, note: input.note, eaten: input.eaten, mindfulness_score: storedScore(input.mindfulness_score) });
	for (const [i, e] of entries.entries()) {
		const at = `entries[${i}]`;
		const food = foodsById.get(e.food_id);
		if (!food) throw new DataError("unknown_food_id", `No food with that id (${at}). Use search_foods to get a food_id (a result marked "not saved" needs import_food first).`, `${at}.food_id`);
		if ((e.grams === undefined) === (e.servings === undefined)) throw fail(`${at} needs exactly one of grams or servings.`, at);
		let grams = e.grams;
		if (grams === undefined) {
			if (food.serving_g == null) throw fail(`${food.name} has no serving size, so give grams (${at}). Or set one with update_food (serving_g).`, `${at}.servings`);
			grams = e.servings! * food.serving_g;
		}
		if (!(grams > 0 && grams <= 5000)) throw fail(`The amount must be greater than 0 and at most 5000 g (${at}).`, at);
		logs.push(row(e.food_id, grams, input.meal_type!));
	}
	if (input.water_ml !== undefined) {
		if (!(input.water_ml > 0 && input.water_ml <= 5000)) throw fail("water_ml must be greater than 0 and at most 5000.", "water_ml");
		const water = await findWaterFood(db, userId);
		if (!water) throw fail('There is no food named "Water". Add one with add_food (all nutrients 0), then log it with meal_type water.', "water_ml");
		logs.push(row(water.id, input.water_ml, "water")); // 1 g of water = 1 ml
	}
	let ids: string[];
	try {
		ids = await createFoodLogsAtomically(db, userId, logs, { id: input.client_request_id, date: t.date });
	} catch (e) {
		// A second copy of the same request arrived at the same moment: return the first one's result.
		const raced = String(e).includes("UNIQUE") && (await findRequest(db, userId, input.client_request_id));
		if (!raced) throw e;
		return { log_ids: raced.ids, day: (await getDay(db, userId, raced.date)).totals, already_logged: true as const };
	}
	return { log_ids: ids, day: (await getDay(db, userId, t.date)).totals, already_logged: false as const };
}

export interface UpdateLogInput {
	log_id: string;
	grams?: number;
	meal_type?: MealType;
	date?: string;
	eaten_at?: string;
	note?: string | null;
	eaten?: boolean;
	mindfulness_score?: number | null;
}

export async function updateLog(db: D1Database, userId: UserId, input: UpdateLogInput) {
	const out: Parameters<typeof dbUpdateFoodLog>[3] = { grams: input.grams, meal_type: input.meal_type, note: input.note, eaten: input.eaten };
	if (input.mindfulness_score !== undefined) out.mindfulness_score = input.mindfulness_score === null ? null : mindfulnessToStored(input.mindfulness_score);
	if (input.date !== undefined || input.eaten_at !== undefined) {
		const t = resolveTime(await userTimeZone(db, userId), input);
		out.date = t.date;
		out.eaten_at = t.eaten_at;
	}
	const log = await dbUpdateFoodLog(db, userId, input.log_id, out);
	return logResult(db, userId, log.id, log.date);
}

/** Archives a log: it is kept but left out of every day and total. Archiving one that is already archived is not an error. */
export async function archiveLog(db: D1Database, userId: UserId, logId: string) {
	const log = await getFoodLog(db, userId, logId); // active logs only
	if (!log || !(await archiveFoodLog(db, userId, logId))) return { archived: false as const, already_archived: true as const, log_id: logId };
	const name = (await getFoodsByIds(db, userId, [log.food_id])).get(log.food_id)?.name ?? "food";
	return { archived: true as const, log_id: logId, meal_type: log.meal_type, food_name: name, grams: log.grams, date: log.date, day: (await getDay(db, userId, log.date)).totals };
}
