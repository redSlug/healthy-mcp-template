// Nutrient math. The server does ALL of this, never the model. Pure functions, no I/O.
// Food values are per 100 g. A log row stores grams only; nutrients are computed here.
/**
 * Every nutrient on the standard label. All are required, so a food can never be saved with a value silently missing.
 * They are per 100 g of a food, or the totals of a whole meal. Lives here, with the math, so this module imports
 * nothing from the data layer.
 */
export interface Nutrients {
	kcal: number;
	protein_g: number;
	fat_g: number;
	carbs_g: number;
	fiber_g: number;
	sugar_g: number;
	added_sugar_g: number;
	saturated_fat_g: number;
	trans_fat_g: number;
	cholesterol_mg: number;
	sodium_mg: number;
}
export type NutrientValues = Nutrients;

export const NUTRIENT_KEYS = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "saturated_fat_g", "trans_fat_g", "cholesterol_mg", "sodium_mg"] as const satisfies readonly (keyof Nutrients)[];
/** The nutrients an outside database may leave out (everything except calories and macros). */
export type ExtraKey = Exclude<keyof Nutrients, "kcal" | "protein_g" | "fat_g" | "carbs_g">;
export const EXTRA_KEYS: readonly ExtraKey[] = NUTRIENT_KEYS.slice(4) as ExtraKey[];

export interface Targets {
	kcal?: number | null;
	protein_g?: number | null;
	fat_min_g?: number | null;
	fat_max_g?: number | null;
	carbs_g?: number | null;
	fiber_g?: number | null;
	sodium_max_mg?: number | null;
	water_ml?: number | null;
}

/** One log's unrounded nutrients (from scale() or scaleMeal()) and whether it was eaten. */
export interface DayEntry {
	eaten: boolean;
	nutrients: Nutrients;
}

export interface DayTotals {
	date: string;
	eaten: Nutrients;
	planned: Nutrients;
	targets: Record<string, number>;
	remaining: Record<string, number>;
	/** Millilitres of water eaten (food logs with meal_type water, 1 g = 1 ml). */
	water_ml: number;
}

const zero = () => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as unknown as Nutrients;

// Floats like 10.1 * 1.5 = 15.149999999999999 must still round to 15.2, so snap to 12 significant digits first.
const snap = (x: number) => Number(x.toPrecision(12));
const clean = (x: number) => (x === 0 ? 0 : x); // turn -0 into 0

export const round1 = (x: number) => clean(Math.round(snap(x * 10)) / 10);
export const roundKcal = (x: number) => clean(Math.round(snap(x)));

/** Nutrients in `grams` of a food, unrounded. */
export function scale(food: NutrientValues, grams: number): Nutrients {
	const out = zero();
	for (const k of NUTRIENT_KEYS) out[k] = (food[k] * grams) / 100;
	return out;
}

export function sum(list: Nutrients[]): Nutrients {
	const total = zero();
	for (const n of list) for (const k of NUTRIENT_KEYS) total[k] += n[k];
	return total;
}

/** Display rounding: calories to whole numbers, everything else to 1 decimal. Round once, at the end. */
export function roundNutrients(n: Nutrients): Nutrients {
	const out = zero();
	for (const k of NUTRIENT_KEYS) out[k] = k === "kcal" ? roundKcal(n[k]) : round1(n[k]);
	return out;
}

// remaining key -> [target field, nutrient field]. Fat and sodium are ceilings (the max target), the rest are goals.
const REMAINING: [string, keyof Targets, keyof Nutrients][] = [
	["kcal", "kcal", "kcal"],
	["protein_g", "protein_g", "protein_g"],
	["carbs_g", "carbs_g", "carbs_g"],
	["fiber_g", "fiber_g", "fiber_g"],
	["fat_g", "fat_max_g", "fat_g"],
	["sodium_mg", "sodium_max_mg", "sodium_mg"],
];

/**
 * Totals for one day, over the day's food logs. `eaten` counts only eaten rows; `planned` counts eaten and not-yet-eaten rows.
 * `targets` lists only targets that are set. `remaining` = target minus the ROUNDED eaten value (so the
 * numbers the assistant reads out always add up), only for targets that are set. Negative means over the target.
 */
export function dayTotals(date: string, entries: DayEntry[], targets: Targets | null, waterMl = 0): DayTotals {
	const all = entries.map((e) => e.nutrients);
	const eatenOnly = entries.filter((e) => e.eaten).map((e) => e.nutrients);
	const eaten = roundNutrients(sum(eatenOnly));
	const planned = roundNutrients(sum(all));

	const setTargets: Record<string, number> = {};
	for (const [k, v] of Object.entries(targets ?? {})) {
		if (v != null && typeof v === "number" && k !== "id") setTargets[k] = v;
	}

	const remaining: Record<string, number> = {};
	for (const [outKey, targetKey, nutrientKey] of REMAINING) {
		const t = targets?.[targetKey];
		if (t == null) continue;
		remaining[outKey] = nutrientKey === "kcal" ? roundKcal(t - eaten.kcal) : round1(t - eaten[nutrientKey]);
	}
	const water = round1(waterMl);
	if (targets?.water_ml != null) remaining.water_ml = round1(targets.water_ml - water);
	return { date, eaten, planned, targets: setTargets, remaining, water_ml: water };
}

/** Mindfulness is shown to users as 1 to 10 and stored as 0 to 1. */
export const mindfulnessToStored = (score: number) => (score - 1) / 9;
export const mindfulnessFromStored = (stored: number) => round1(stored * 9 + 1);
