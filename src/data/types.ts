export type UserId = string;

export class DataError extends Error {
	constructor(
		public code: "unknown_food_id" | "unknown_food_log_id" | "unknown_workout_id" | "duplicate" | "validation_failed" | "external_api_unavailable",
		message: string,
		public field?: string,
	) {
		super(message);
	}
}

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "dessert", "water"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const WORKOUT_TYPES = ["run", "walk", "cycle", "swim", "strength", "yoga", "hiit", "other"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const WORKOUT_INTENSITIES = ["easy", "moderate", "hard"] as const;
export type WorkoutIntensity = (typeof WORKOUT_INTENSITIES)[number];

export const WORKOUT_SOURCES = ["reported", "estimate"] as const;
export type WorkoutSource = (typeof WORKOUT_SOURCES)[number];
