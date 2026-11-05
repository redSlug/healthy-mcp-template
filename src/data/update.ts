import { DataError, now, type UserId } from "./types";

/**
 * UPDATE one row of the user's, setting only the fields that are not undefined, and return it.
 * `table` and the field names are written in our code, never taken from a tool input.
 * Throws validation_failed when nothing was sent, and `notFound` when no active row matches.
 */
export async function updateRow<T>(db: D1Database, table: "foods" | "food_logs" | "workouts", userId: UserId, id: string, fields: Record<string, unknown>, notFound: () => DataError): Promise<T> {
	const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
	if (entries.length === 0) throw new DataError("validation_failed", "Nothing to change. Send at least one field to update.", "changes");
	const sets = entries.map(([k]) => `${k} = ?`).join(", ");
	const archivedFilter = table === "foods" ? "" : " AND archived_at IS NULL"; // an archived log or workout can no longer be changed
	const row = await db
		.prepare(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ? AND user_id = ?${archivedFilter} RETURNING *`)
		.bind(...entries.map(([, v]) => v), now(), id, userId)
		.first<T>();
	if (!row) throw notFound();
	return row;
}
