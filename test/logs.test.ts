import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser, setTargets } from "../src/data";
import { archiveLog, getDay, logEntries, updateLog } from "../src/services/logs";
import { logFood } from "./helpers";

const db = env.DB;
const yogurt = { name: "Greek yogurt", kcal: 57, protein_g: 10.1, fat_g: 0, carbs_g: 4, fiber_g: 0, sugar_g: 4, added_sugar_g: 0, saturated_fat_g: 0, trans_fat_g: 0, cholesterol_mg: 5, sodium_mg: 36, source: "label" as const };
const oats = { name: "Oats", kcal: 389, protein_g: 16.9, fat_g: 6.9, carbs_g: 66.3, fiber_g: 10.6, sugar_g: 1, added_sugar_g: 0, saturated_fat_g: 1.2, trans_fat_g: 0, cholesterol_mg: 0, sodium_mg: 2, source: "label" as const };

let a: string, b: string, aYogurt: string, aOats: string, bYogurt: string;

beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "2001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "2002" })).id;
	aYogurt = (await createFood(db, a, yogurt)).id;
	aOats = (await createFood(db, a, oats)).id;
	bYogurt = (await createFood(db, b, yogurt)).id;
});

describe("log_entries", () => {
	it("returns the nutrients and the new day totals, computed by the server", async () => {
		const r = await logFood(db, a, { date: "2026-01-10", meal_type: "breakfast", food_id: aYogurt, grams: 150 });
		expect(r.food_name).toBe("Greek yogurt");
		expect(r.nutrients).toMatchObject({ kcal: 86, protein_g: 15.2, fat_g: 0, carbs_g: 6, sodium_mg: 54 });
		expect(r.day.eaten.kcal).toBe(86);
		expect(r.day.date).toBe("2026-01-10");
	});
	it("adds up the day across entries, and remaining uses targets", async () => {
		await setTargets(db, a, { kcal: 2200, protein_g: 180 });
		await logFood(db, a, { date: "2026-01-11", meal_type: "breakfast", food_id: aYogurt, grams: 227 });
		const r = await logFood(db, a, { date: "2026-01-11", meal_type: "breakfast", food_id: aOats, grams: 54 });
		expect(r.day.eaten.kcal).toBe(Math.round(57 * 2.27 + 389 * 0.54));
		expect(r.day.remaining.kcal).toBe(2200 - r.day.eaten.kcal);
		expect(r.day.remaining.protein_g).toBeCloseTo(180 - r.day.eaten.protein_g, 5);
		expect(r.day.targets).toEqual({ kcal: 2200, protein_g: 180 });
	});
});

describe("time rules", () => {
	it("date only: noon that day in the user's time zone", async () => {
		await logFood(db, a, { date: "2026-01-15", meal_type: "lunch", food_id: aYogurt, grams: 100 });
		expect((await getDay(db, a, "2026-01-15")).food_logs[0].eaten_at).toBe("2026-01-15T17:00:00.000Z"); // default zone New York, EST
	});
	it("eaten_at: the day comes from the user's zone, not UTC", async () => {
		// 02:30 UTC on Jan 17 is still the evening of Jan 16 in New York
		const r = await logFood(db, a, { meal_type: "dinner", food_id: aYogurt, grams: 100, eaten_at: "2026-01-17T02:30:00Z" });
		expect(r.day.date).toBe("2026-01-16");
	});
	it("with neither, logs now on today's local date", async () => {
		const r = await logFood(db, a, { meal_type: "snack", food_id: aYogurt, grams: 100 });
		expect(r.day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect((await getDay(db, a)).food_logs.some((l) => l.log_id === r.log_id)).toBe(true);
	});
});

describe("user separation", () => {
	it("user B cannot log against user A's food", async () => {
		await expect(logFood(db, b, { date: "2026-01-10", meal_type: "lunch", food_id: aYogurt, grams: 100 })).rejects.toMatchObject({ code: "unknown_food_id" });
	});
	it("user B's day never shows or counts user A's logs, even on the same date", async () => {
		await logFood(db, b, { date: "2026-01-11", meal_type: "lunch", food_id: bYogurt, grams: 100 });
		const day = await getDay(db, b, "2026-01-11");
		expect(day.food_logs).toHaveLength(1);
		expect(day.food_logs[0].food_id).toBe(bYogurt);
		expect(day.totals.eaten.kcal).toBe(57);
		expect(day.totals.targets).toEqual({}); // A's targets do not leak
		expect(day.totals.remaining).toEqual({});
	});
});

describe("get_day mindfulness and water", () => {
	it("shows each score and the average of eaten, scored, non-water entries", async () => {
		await logFood(db, a, { date: "2026-07-01", meal_type: "lunch", food_id: aYogurt, grams: 100, mindfulness_score: 4 });
		await logFood(db, a, { date: "2026-07-01", meal_type: "dinner", food_id: aYogurt, grams: 100, mindfulness_score: 9 });
		await logFood(db, a, { date: "2026-07-01", meal_type: "snack", food_id: aYogurt, grams: 100 }); // no score
		await logFood(db, a, { date: "2026-07-01", meal_type: "snack", food_id: aYogurt, grams: 100, mindfulness_score: 1, eaten: false }); // planned
		const day = await getDay(db, a, "2026-07-01");
		expect(day.food_logs.map((l) => l.mindfulness_score)).toEqual(expect.arrayContaining([4, 9, null, 1]));
		expect(day.mindfulness_avg).toBe(6.5);
		expect(day.totals.water_ml).toBe(0);
		expect((await getDay(db, a, "2026-07-02")).mindfulness_avg).toBeNull();
	});
});

describe("update_log and archive_log", () => {
	it("changes only the fields sent, and the day totals follow", async () => {
		const l = await logFood(db, a, { date: "2026-05-01", meal_type: "lunch", food_id: aYogurt, grams: 100, note: "first" });
		const u = await updateLog(db, a, { log_id: l.log_id, grams: 200, mindfulness_score: 8, eaten: false });
		expect(u.grams).toBe(200);
		expect(u.nutrients).toMatchObject({ kcal: 114 }); // 57 x 2
		expect(u.day.eaten.kcal).toBe(0); // now planned, not eaten
		expect(u.day.planned.kcal).toBe(114);
		const row = (await getDay(db, a, "2026-05-01")).food_logs[0];
		expect(row).toMatchObject({ meal_type: "lunch", note: "first", mindfulness_score: 8, eaten: false }); // untouched fields kept
	});
	it("moving to another day moves the log and recomputes both days", async () => {
		const l = await logFood(db, a, { date: "2026-05-03", meal_type: "dinner", food_id: aYogurt, grams: 100 });
		const u = await updateLog(db, a, { log_id: l.log_id, date: "2026-05-04" });
		expect(u.day.date).toBe("2026-05-04");
		expect((await getDay(db, a, "2026-05-03")).food_logs).toEqual([]);
		expect((await getDay(db, a, "2026-05-04")).food_logs).toHaveLength(1);
	});
	it("archiving hides the log from the day and totals, keeps the row, and blocks further changes", async () => {
		const l1 = await logFood(db, a, { date: "2026-05-06", meal_type: "lunch", food_id: aYogurt, grams: 100 });
		await logFood(db, a, { date: "2026-05-06", meal_type: "lunch", food_id: aOats, grams: 100 });
		const r = await archiveLog(db, a, l1.log_id);
		expect(r).toMatchObject({ archived: true, food_name: "Greek yogurt", grams: 100, meal_type: "lunch" });
		expect(r.archived && r.day.eaten.kcal).toBe(389);
		expect((await getDay(db, a, "2026-05-06")).food_logs).toHaveLength(1);
		expect(await archiveLog(db, a, l1.log_id)).toEqual({ archived: false, already_archived: true, log_id: l1.log_id });
		await expect(updateLog(db, a, { log_id: l1.log_id, grams: 5 })).rejects.toMatchObject({ code: "unknown_food_log_id" });
		const row = await db.prepare("SELECT archived_at FROM food_logs WHERE id = ?").bind(l1.log_id).first<{ archived_at: string }>();
		expect(row?.archived_at).toBeTruthy(); // kept, not deleted
	});
});

describe("retries and water_ml", () => {
	it("the same client_request_id is saved once and returns the first result", async () => {
		const input = { client_request_id: "retry-test-0001", meal_type: "lunch" as const, date: "2026-06-01", entries: [{ food_id: aYogurt, grams: 150 }, { food_id: aOats, grams: 40 }] };
		const first = await logEntries(db, a, input);
		const second = await logEntries(db, a, input);
		expect(first.already_logged).toBe(false);
		expect(second).toMatchObject({ already_logged: true, log_ids: first.log_ids });
		expect((await getDay(db, a, "2026-06-01")).food_logs).toHaveLength(2);
	});
	it("the same client_request_id from another user is a separate request", async () => {
		const id = "retry-test-0002";
		await logEntries(db, a, { client_request_id: id, meal_type: "snack", date: "2026-06-02", entries: [{ food_id: aYogurt, grams: 10 }] });
		const r = await logEntries(db, b, { client_request_id: id, meal_type: "snack", date: "2026-06-02", entries: [{ food_id: bYogurt, grams: 10 }] });
		expect(r.already_logged).toBe(false);
	});
	it("water_ml logs the Water food under meal type water, alone or with foods", async () => {
		await logEntries(db, a, { client_request_id: crypto.randomUUID(), date: "2026-06-03", water_ml: 500 });
		await logEntries(db, a, { client_request_id: crypto.randomUUID(), date: "2026-06-03", meal_type: "lunch", entries: [{ food_id: aYogurt, grams: 100 }], water_ml: 250 });
		const day = await getDay(db, a, "2026-06-03");
		expect(day.totals.water_ml).toBe(750);
		expect(day.food_logs.filter((l) => l.meal_type === "water").map((l) => l.food_name)).toEqual(["Water", "Water"]);
	});
	it("needs entries or water_ml, and a meal_type for entries", async () => {
		await expect(logEntries(db, a, { client_request_id: crypto.randomUUID() })).rejects.toMatchObject({ code: "validation_failed" });
		await expect(logEntries(db, a, { client_request_id: crypto.randomUUID(), entries: [{ food_id: aYogurt, grams: 5 }] })).rejects.toMatchObject({ code: "validation_failed", field: "meal_type" });
	});
});
