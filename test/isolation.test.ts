import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createFood, createFoodLog, createWorkout, DataError, archiveFoodLog, archiveWorkout, findOrCreateUser,
	getFood, getFoodLog, getTargets, getTimeZone, listWorkoutsForDate, searchFoods, setTargets, updateWorkout,
} from "../src/data";
import { listFoods, REST } from "./helpers";

const db = env.DB;
const yogurt = { name: "Greek yogurt", brand: "Fage", kcal: 57, protein_g: 10.1, fat_g: 0, carbs_g: 4, ...REST, source: "label" as const };

let a: string;
let b: string;
let aFood: string;
let aLog: string;
let aWorkout: string;

beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "1001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "1002" })).id;
	aFood = (await createFood(db, a, yogurt)).id;
	aLog = (await createFoodLog(db, a, { date: "2026-11-02", meal_type: "breakfast", food_id: aFood, grams: 150 })).id;
	await setTargets(db, a, { kcal: 2200, protein_g: 180 });
	aWorkout = (await createWorkout(db, a, { date: "2026-11-02", type: "run", duration_minutes: 30, kcal_burned: 300, intensity: "moderate", source: "estimate" }, crypto.randomUUID())).id;
});

describe("sign-in", () => {
	it("creates a user and settings once per provider identity", async () => {
		const again = await findOrCreateUser(db, { provider: "github", subject: "1001" });
		expect(again.id).toBe(a);
		expect(await getTimeZone(db, a)).toBe("America/New_York");
	});
	it("treats the same subject from another provider as a different user", async () => {
		const g = await findOrCreateUser(db, { provider: "google", subject: "1001" });
		expect(g.id).not.toBe(a);
	});
});

describe("user separation: user B cannot see or change user A's rows", () => {
	it("foods", async () => {
		expect(await getFood(db, b, aFood)).toBeNull();
		expect((await listFoods(db, b)).map((f) => f.name)).toEqual(["Water"]); // the only food a new user has
		expect(await searchFoods(db, b, "greek yogurt")).toEqual([]);
		expect((await searchFoods(db, a, "greek yog")).map((f) => f.id)).toEqual([aFood]);
	});
	it("food logs", async () => {
		expect(await getFoodLog(db, b, aLog)).toBeNull();
		expect(await archiveFoodLog(db, b, aLog)).toBe(false);
		expect(await getFoodLog(db, a, aLog)).not.toBeNull();
	});
	it("cannot log another user's food", async () => {
		await expect(createFoodLog(db, b, { date: "2026-11-02", meal_type: "lunch", food_id: aFood, grams: 100 })).rejects.toMatchObject({
			code: "unknown_food_id",
		});
	});
	it("the database itself rejects a cross-user log even if the code check were skipped", async () => {
		await expect(
			db
				.prepare("INSERT INTO food_logs (id, user_id, date, meal_type, food_id, grams) VALUES ('x', ?, '2026-11-02', 'lunch', ?, 100)")
				.bind(b, aFood)
				.run(),
		).rejects.toThrow();
	});
	it("targets", async () => {
		expect(await getTargets(db, b)).toBeNull();
		expect((await getTargets(db, a))?.kcal).toBe(2200);
	});
	it("workouts", async () => {
		expect(await listWorkoutsForDate(db, b, "2026-11-02")).toEqual([]);
		expect(await archiveWorkout(db, b, aWorkout)).toBe(false);
		await expect(updateWorkout(db, b, aWorkout, { type: "walk" })).rejects.toMatchObject({ code: "unknown_workout_id" });
		expect(await listWorkoutsForDate(db, a, "2026-11-02")).toHaveLength(1);
	});
});

describe("data rules", () => {
	it("the database rejects a meal_type outside the six allowed", async () => {
		await expect(db.prepare("INSERT INTO food_logs (id, user_id, date, meal_type, food_id, grams) VALUES ('y', ?, '2026-11-02', 'brunch', ?, 100)").bind(a, aFood).run()).rejects.toThrow();
		expect((await getFoodLog(db, a, aLog))?.meal_type).toBe("breakfast");
	});
});

describe("account deletion", () => {
	it("cascades to all of a user's data", async () => {
		const c = (await findOrCreateUser(db, { provider: "github", subject: "1003" })).id;
		const f = await createFood(db, c, yogurt);
		await createFoodLog(db, c, { date: "2026-11-02", meal_type: "lunch", food_id: f.id, grams: 100 });
		await db.prepare("DELETE FROM foods_fts WHERE user_id = ?").bind(c).run();
		await db.prepare("DELETE FROM users WHERE id = ?").bind(c).run();
		for (const t of ["foods", "food_logs", "targets", "workouts"]) {
			const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(c).first<{ n: number }>();
			expect(r?.n).toBe(0);
		}
	});
});
