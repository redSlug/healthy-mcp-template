import { describe, expect, it } from "vitest";
import { dayTotals, mindfulnessFromStored, mindfulnessToStored, round1, roundKcal, roundNutrients, scale, sum } from "../src/nutrition";
import { isValidDate, isValidTimeZone, localDate, localNoonUtc, localToUtc } from "../src/time";

const yogurt = { kcal: 57, protein_g: 10.1, fat_g: 0, carbs_g: 4, fiber_g: 0, sugar_g: 4, added_sugar_g: 0, saturated_fat_g: 0, trans_fat_g: 0, cholesterol_mg: 5, sodium_mg: 36 };
const oats = { kcal: 389, protein_g: 16.9, fat_g: 6.9, carbs_g: 66.3, fiber_g: 10.6, sugar_g: 1, added_sugar_g: 0, saturated_fat_g: 1.2, trans_fat_g: 0, cholesterol_mg: 0, sodium_mg: 2 };

describe("scale", () => {
	it("is grams / 100 x the per-100g value", () => {
		const n = scale(yogurt, 150);
		expect(n.kcal).toBeCloseTo(85.5, 10);
		expect(n.protein_g).toBeCloseTo(15.15, 10);
		expect(n.sodium_mg).toBeCloseTo(54, 10);
	});
});

describe("rounding", () => {
	it("matches the design doc example: 150 g of yogurt is 86 kcal and 15.2 g protein", () => {
		const r = roundNutrients(scale(yogurt, 150));
		expect(r.kcal).toBe(86);
		expect(r.protein_g).toBe(15.2); // 10.1 * 1.5 is 15.149999999999999 in floating point
	});
	it("rounds half up and never returns -0", () => {
		expect(round1(0.25)).toBe(0.3);
		expect(roundKcal(0.5)).toBe(1);
		expect(Object.is(round1(-0.04), -0)).toBe(false);
		expect(Object.is(roundKcal(-0.4), -0)).toBe(false);
	});
});

describe("dayTotals", () => {
	const entries = [
		{ eaten: true, nutrients: scale(yogurt, 227) },
		{ eaten: true, nutrients: scale(oats, 54) },
		{ eaten: false, nutrients: scale(yogurt, 100) },
	];
	it("separates eaten from planned", () => {
		const d = dayTotals("2026-11-02", entries, null);
		expect(d.eaten.kcal).toBe(roundKcal(57 * 2.27 + 389 * 0.54));
		expect(d.planned.kcal).toBe(roundKcal(57 * 2.27 + 389 * 0.54 + 57));
		expect(d.planned.kcal).toBeGreaterThan(d.eaten.kcal);
	});
	it("with no targets, reports none and no remaining", () => {
		const d = dayTotals("2026-11-02", entries, null);
		expect(d.targets).toEqual({});
		expect(d.remaining).toEqual({});
	});
	it("remaining is target minus the rounded eaten value, only for targets that are set", () => {
		const d = dayTotals("2026-11-02", entries, { kcal: 2200, protein_g: 180, fat_max_g: 85, sodium_max_mg: 2300, carbs_g: null });
		expect(d.remaining.kcal).toBe(2200 - d.eaten.kcal);
		expect(d.remaining.protein_g).toBe(round1(180 - d.eaten.protein_g));
		expect(d.remaining.fat_g).toBe(round1(85 - d.eaten.fat_g));
		expect(d.remaining.sodium_mg).toBe(round1(2300 - d.eaten.sodium_mg));
		expect("carbs_g" in d.remaining).toBe(false);
		expect(d.targets).toEqual({ kcal: 2200, protein_g: 180, fat_max_g: 85, sodium_max_mg: 2300 });
	});
});

describe("mindfulness scale", () => {
	it("stores 1 to 10 as 0 to 1 and converts back", () => {
		expect(mindfulnessToStored(1)).toBe(0);
		expect(mindfulnessToStored(10)).toBe(1);
		for (const s of [1, 2.5, 7, 10]) expect(mindfulnessFromStored(mindfulnessToStored(s))).toBe(s);
	});
});

describe("time helpers", () => {
	it("validates dates and time zones", () => {
		expect(isValidDate("2026-11-02")).toBe(true);
		expect(isValidDate("2026-02-30")).toBe(false);
		expect(isValidDate("11/02/2026")).toBe(false);
		expect(isValidTimeZone("America/New_York")).toBe(true);
		expect(isValidTimeZone("Mars/Olympus")).toBe(false);
	});
	it("noon local, including daylight saving", () => {
		expect(localNoonUtc("2026-11-02", "America/New_York")).toBe("2026-11-02T17:00:00.000Z"); // EST, UTC-5
		expect(localNoonUtc("2026-07-01", "America/New_York")).toBe("2026-07-01T16:00:00.000Z"); // EDT, UTC-4
		expect(localNoonUtc("2026-11-01", "America/New_York")).toBe("2026-11-01T17:00:00.000Z"); // the day clocks go back
		expect(localNoonUtc("2026-03-08", "America/New_York")).toBe("2026-03-08T16:00:00.000Z"); // the day clocks go forward
		expect(localNoonUtc("2026-11-02", "Asia/Tokyo")).toBe("2026-11-02T03:00:00.000Z");
	});
});
