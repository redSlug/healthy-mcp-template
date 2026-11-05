import { now, type UserId } from "./types";

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

const FIELDS = ["kcal", "protein_g", "fat_min_g", "fat_max_g", "carbs_g", "fiber_g", "sodium_max_mg", "water_ml"] as const;

/** The user's daily targets, or null if none were ever set. */
export async function getTargets(db: D1Database, userId: UserId): Promise<Targets | null> {
	const row = await db.prepare("SELECT * FROM targets WHERE user_id = ?").bind(userId).first<Targets & { user_id: string }>();
	if (!row) return null;
	return Object.fromEntries(FIELDS.map((k) => [k, row[k] ?? null]));
}

/** Fields not sent keep their value; null clears one. */
export async function setTargets(db: D1Database, userId: UserId, changes: Targets): Promise<Targets> {
	const prev = await getTargets(db, userId);
	const merged: Record<string, number | null> = {};
	for (const k of FIELDS) merged[k] = (k in changes ? changes[k] : prev?.[k]) ?? null;
	await db
		.prepare(
			`INSERT INTO targets (user_id, ${FIELDS.join(", ")}, updated_at) VALUES (?, ${FIELDS.map(() => "?").join(", ")}, ?)
			 ON CONFLICT (user_id) DO UPDATE SET ${FIELDS.map((k) => `${k} = excluded.${k}`).join(", ")}, updated_at = excluded.updated_at`,
		)
		.bind(userId, ...FIELDS.map((k) => merged[k]), now())
		.run();
	return (await getTargets(db, userId))!;
}
