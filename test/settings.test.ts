import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser } from "../src/data";
import { getDay } from "../src/services/logs";
import { logFood, REST } from "./helpers";
import { updateSettings } from "../src/services/settings";

const db = env.DB;
let a: string, b: string;

beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "5001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "5002" })).id;
});

describe("update_settings", () => {
	it("sets the time zone, rejects a bad one, and only changes that user", async () => {
		await expect(updateSettings(db, a, { time_zone: "Mars/Olympus" })).rejects.toMatchObject({ code: "validation_failed" });
		expect((await updateSettings(db, a, { time_zone: "Asia/Tokyo" })).time_zone).toBe("Asia/Tokyo");
		expect((await updateSettings(db, b, { targets: { kcal: 1800 } })).time_zone).toBe("America/New_York");
	});

	it("targets show up in get_day as remaining, unsent fields carry over, and null clears", async () => {
		await updateSettings(db, a, { targets: { kcal: 2000, protein_g: 150 } });
		const r = await updateSettings(db, a, { targets: { protein_g: 160 } });
		expect(r.targets).toMatchObject({ kcal: 2000, protein_g: 160 });

		const food = await createFood(db, a, { name: "Test food", kcal: 100, protein_g: 10, fat_g: 0, carbs_g: 0, ...REST, source: "label" });
		await logFood(db, a, { meal_type: "lunch", food_id: food.id, grams: 200 });
		const day = await getDay(db, a);
		expect(day.totals.remaining.kcal).toBe(1800);
		expect(day.totals.remaining.protein_g).toBe(140);

		expect((await updateSettings(db, a, { targets: { kcal: null } })).targets).not.toHaveProperty("kcal");
	});

	it("needs at least one field", async () => {
		await expect(updateSettings(db, a, {})).rejects.toMatchObject({ code: "validation_failed" });
	});
});
