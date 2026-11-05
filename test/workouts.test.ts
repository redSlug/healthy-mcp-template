import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { findOrCreateUser, setTargets } from "../src/data";
import { getDay } from "../src/services/logs";
import { listFoods, logFood } from "./helpers";
import { archiveWorkout, logWorkout, updateWorkout } from "../src/services/workouts";

const db = env.DB;
let a: string, b: string, aWater: string;

beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "4001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "4002" })).id;
	aWater = (await listFoods(db, a)).find((f) => f.name === "Water")!.id;
});

describe("workouts", () => {
	it("log, show in get_day, update and archive", async () => {
		const w = await logWorkout(db, a, { client_request_id: crypto.randomUUID(), type: "run", duration_minutes: 32.5, kcal_burned: 320, intensity: "easy", source: "estimate", date: "2026-03-01", note: "easy" });
		expect(w).toMatchObject({ type: "run", duration_minutes: 32.5, kcal_burned: 320, intensity: "easy", source: "estimate", date: "2026-03-01", note: "easy" });
		const { already_logged, ...view } = w;
		expect((await getDay(db, a, "2026-03-01")).workouts).toEqual([view]);
		expect((await getDay(db, a, "2026-03-02")).workouts).toEqual([]);

		const u = await updateWorkout(db, a, { workout_id: w.workout_id, duration_minutes: 40, kcal_burned: 400, source: "reported", note: null });
		expect(u).toMatchObject({ type: "run", duration_minutes: 40, kcal_burned: 400, intensity: "easy", source: "reported", note: null });
		expect(await archiveWorkout(db, a, w.workout_id)).toEqual({ archived: true, workout_id: w.workout_id, type: "run", duration_minutes: 40, date: "2026-03-01" });
		expect(await archiveWorkout(db, a, w.workout_id)).toEqual({ archived: false, already_archived: true, workout_id: w.workout_id });
		expect((await getDay(db, a, "2026-03-01")).workouts).toEqual([]);
	});
	it("the same client_request_id logs one workout", async () => {
		const input = { client_request_id: "workout-retry-1", type: "walk" as const, duration_minutes: 20, kcal_burned: 90, intensity: "easy" as const, source: "estimate" as const, date: "2026-03-09" };
		const first = await logWorkout(db, a, input);
		const second = await logWorkout(db, a, input);
		expect(second).toMatchObject({ workout_id: first.workout_id, already_logged: true });
		expect((await getDay(db, a, "2026-03-09")).workouts).toHaveLength(1);
	});
});

describe("water and dessert", () => {
	it("every user has a Water food at 0 kcal", async () => {
		const water = (await listFoods(db, b)).find((f) => f.name === "Water");
		expect(water).toMatchObject({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
	});
	it("water is counted in ml against the water target, and adds no calories", async () => {
		await setTargets(db, a, { water_ml: 2500 });
		await logFood(db, a, { date: "2026-03-10", meal_type: "water", food_id: aWater, grams: 500 });
		await logFood(db, a, { date: "2026-03-10", meal_type: "water", food_id: aWater, grams: 250.4 });
		await logFood(db, a, { date: "2026-03-10", meal_type: "water", food_id: aWater, grams: 300, eaten: false });
		const day = await getDay(db, a, "2026-03-10");
		expect(day.totals.water_ml).toBe(750.4);
		expect(day.totals.remaining.water_ml).toBe(1749.6);
		expect(day.totals.eaten.kcal).toBe(0);
	});
	it("a day with no water shows 0 and a dessert is a valid meal type", async () => {
		expect((await getDay(db, b, "2026-03-11")).totals.water_ml).toBe(0);
		const bWater = (await listFoods(db, b))[0].id;
		await expect(logFood(db, b, { date: "2026-03-11", meal_type: "dessert", food_id: bWater, grams: 10 })).resolves.toMatchObject({ meal_type: "dessert" });
	});
});
