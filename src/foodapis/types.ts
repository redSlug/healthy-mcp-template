import type { ExtraKey, Nutrients } from "../nutrition";

export type ExternalSource = "usda" | "off";

/** Per 100 g, from an outside database. Calories and macros are always there; the rest is null when the source does not list it. */
export type ExternalNutrients = Pick<Nutrients, "kcal" | "protein_g" | "fat_g" | "carbs_g"> & Record<ExtraKey, number | null>;

/** A food from an outside database, normalized to per-100g values. Not saved until imported. */
export interface ExternalFood {
	external_source: ExternalSource;
	external_id: string;
	name: string;
	brand: string | null;
	serving_g: number | null;
	per_100g: ExternalNutrients;
}

export class ExternalApiError extends Error {
	constructor(
		public source: ExternalSource,
		message: string,
	) {
		super(message);
	}
}

export interface FoodApiClients {
	search(source: ExternalSource, query: string, limit: number): Promise<ExternalFood[]>;
	get(source: ExternalSource, id: string): Promise<ExternalFood | null>;
}

export const USER_AGENT = "Healthy/0.1";
export const TIMEOUT_MS = 6000;
