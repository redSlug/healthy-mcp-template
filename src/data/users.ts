import { newId, type UserId } from "./types";

/** Every user gets this food, so water is logged like any other food (grams = ml). */
export const WATER_FOOD_NAME = "Water";

export interface User {
	id: string;
	auth_provider: string;
	auth_subject: string;
	time_zone: string;
}

/**
 * The one function that has no userId parameter: it is how a userId is obtained,
 * from the verified upstream identity (provider + subject). Creates the users row
 * and a "Water" food on first sign-in.
 */
export async function findOrCreateUser(db: D1Database, identity: { provider: string; subject: string }): Promise<User> {
	const existing = await db
		.prepare("SELECT id, auth_provider, auth_subject, time_zone FROM users WHERE auth_provider = ? AND auth_subject = ?")
		.bind(identity.provider, identity.subject)
		.first<User>();
	if (existing) return existing;

	const id = newId();
	const waterId = newId();
	await db.batch([
		db.prepare("INSERT INTO users (id, auth_provider, auth_subject) VALUES (?, ?, ?)").bind(id, identity.provider, identity.subject),
		db
			.prepare(
				`INSERT INTO foods (id, user_id, name, kcal, protein_g, fat_g, carbs_g, fiber_g, sugar_g, added_sugar_g, saturated_fat_g, trans_fat_g, cholesterol_mg, sodium_mg, source, verified)
				 VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'label', 1)`,
			)
			.bind(waterId, id, WATER_FOOD_NAME),
		db.prepare("INSERT INTO foods_fts (food_id, user_id, name, brand) VALUES (?, ?, ?, '')").bind(waterId, id, WATER_FOOD_NAME),
	]);
	const created = await db.prepare("SELECT id, auth_provider, auth_subject, time_zone FROM users WHERE id = ?").bind(id).first<User>();
	return created!;
}

export async function getTimeZone(db: D1Database, userId: UserId): Promise<string | null> {
	return (await db.prepare("SELECT time_zone FROM users WHERE id = ?").bind(userId).first<{ time_zone: string }>())?.time_zone ?? null;
}

export async function setTimeZone(db: D1Database, userId: UserId, timeZone: string): Promise<void> {
	await db.prepare("UPDATE users SET time_zone = ? WHERE id = ?").bind(timeZone, userId).run();
}
