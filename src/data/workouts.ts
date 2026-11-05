import { requestInsert } from "./requests";
import { updateRow } from "./update";
import { DataError, newId, now, type UserId, type WorkoutIntensity, type WorkoutSource, type WorkoutType } from "./types";

export interface NewWorkout {
	date: string;
	type: WorkoutType;
	duration_minutes: number;
	kcal_burned: number;
	intensity: WorkoutIntensity;
	source: WorkoutSource;
	note?: string | null;
}

export interface Workout {
	id: string;
	user_id: string;
	date: string;
	type: WorkoutType;
	duration_minutes: number;
	kcal_burned: number;
	intensity: WorkoutIntensity;
	source: WorkoutSource;
	note: string | null;
	archived_at: string | null;
}

export async function createWorkout(db: D1Database, userId: UserId, w: NewWorkout, requestId: string): Promise<Workout> {
	const id = newId();
	const ts = now();
	await db.batch([
		db
			.prepare("INSERT INTO workouts (id, user_id, date, type, duration_minutes, kcal_burned, intensity, source, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(id, userId, w.date, w.type, w.duration_minutes, w.kcal_burned, w.intensity, w.source, w.note ?? null, ts, ts),
		requestInsert(db, userId, requestId, w.date, [id]),
	]);
	return (await getWorkout(db, userId, id))!;
}

export async function getWorkout(db: D1Database, userId: UserId, id: string): Promise<Workout | null> {
	return db.prepare("SELECT * FROM workouts WHERE id = ? AND user_id = ? AND archived_at IS NULL").bind(id, userId).first<Workout>();
}

export interface WorkoutChanges {
	date?: string;
	type?: WorkoutType;
	duration_minutes?: number;
	kcal_burned?: number;
	intensity?: WorkoutIntensity;
	source?: WorkoutSource;
	note?: string | null;
}

export async function updateWorkout(db: D1Database, userId: UserId, id: string, c: WorkoutChanges): Promise<Workout> {
	return updateRow<Workout>(db, "workouts", userId, id, { ...c }, () => new DataError("unknown_workout_id", "No workout with that id. Use get_day to see workout_ids.", "workout_id"));
}

/** Archives a workout (it is kept, but left out of every day). False if it was not there or already archived. */
export async function archiveWorkout(db: D1Database, userId: UserId, id: string): Promise<boolean> {
	const ts = now();
	const r = await db.prepare("UPDATE workouts SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL").bind(ts, ts, id, userId).run();
	return (r.meta.changes ?? 0) > 0;
}

export async function listWorkoutsForDate(db: D1Database, userId: UserId, date: string): Promise<Workout[]> {
	return (await db.prepare("SELECT * FROM workouts WHERE user_id = ? AND date = ? AND archived_at IS NULL ORDER BY created_at").bind(userId, date).all<Workout>()).results;
}
