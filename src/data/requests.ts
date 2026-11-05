import type { UserId } from "./types";

export interface LoggedRequest { date: string; ids: string[] }

export async function findRequest(db: D1Database, userId: UserId, requestId: string): Promise<LoggedRequest | null> {
	const row = await db.prepare("SELECT date, ids FROM request_log WHERE user_id = ? AND request_id = ?").bind(userId, requestId).first<{ date: string; ids: string }>();
	return row ? { date: row.date, ids: JSON.parse(row.ids) as string[] } : null;
}

/** The INSERT that records a request. Run it in the same db.batch as the rows it created: both are saved or neither. */
export function requestInsert(db: D1Database, userId: UserId, requestId: string, date: string, ids: string[]) {
	return db.prepare("INSERT INTO request_log (user_id, request_id, date, ids) VALUES (?, ?, ?, ?)").bind(userId, requestId, date, JSON.stringify(ids));
}
