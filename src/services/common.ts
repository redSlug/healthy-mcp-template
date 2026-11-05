// Small helpers shared by the services.
import { DataError, getTimeZone, type UserId } from "../data";

const DEFAULT_TZ = "America/New_York";

export const fail = (message: string, field: string) => new DataError("validation_failed", message, field);

export async function userTimeZone(db: D1Database, userId: UserId): Promise<string> {
	return (await getTimeZone(db, userId)) ?? DEFAULT_TZ;
}
