// log_workout, update_workout, archive_workout. Deliberately minimal: a day, a type, a duration, calories burned and an intensity (all required).
import { createWorkout, DataError, findRequest, archiveWorkout as dbArchiveWorkout, getWorkout, updateWorkout as dbUpdateWorkout, type UserId, type Workout, type WorkoutIntensity, type WorkoutSource, type WorkoutType } from "../data";
import { isValidDate, localDate } from "../time";
import { fail, userTimeZone } from "./common";

export interface LogWorkoutInput { client_request_id: string; type: WorkoutType; duration_minutes: number; kcal_burned: number; intensity: WorkoutIntensity; source: WorkoutSource; date?: string; note?: string }
export interface UpdateWorkoutInput { workout_id: string; type?: WorkoutType; duration_minutes?: number; kcal_burned?: number; intensity?: WorkoutIntensity; source?: WorkoutSource; date?: string; note?: string | null }

export function workoutView(w: Workout) {
	return { workout_id: w.id, date: w.date, type: w.type, duration_minutes: w.duration_minutes, kcal_burned: w.kcal_burned, intensity: w.intensity, source: w.source, note: w.note };
}

/** A request id seen before returns the first workout without saving another. */
export async function logWorkout(db: D1Database, userId: UserId, input: LogWorkoutInput) {
	const again = async () => {
		const seen = await findRequest(db, userId, input.client_request_id);
		if (!seen) return null;
		const w = await getWorkout(db, userId, seen.ids[0]);
		if (!w) throw fail("This request was already logged, and that workout has since been archived. Use a new client_request_id to log it again.", "client_request_id");
		return { ...workoutView(w), already_logged: true as const };
	};
	const prior = await again();
	if (prior) return prior;
	const date = input.date ?? localDate(new Date(), await userTimeZone(db, userId));
	try {
		return { ...workoutView(await createWorkout(db, userId, { date, type: input.type, duration_minutes: input.duration_minutes, kcal_burned: input.kcal_burned, intensity: input.intensity, source: input.source, note: input.note ?? null }, input.client_request_id)), already_logged: false as const };
	} catch (e) {
		const raced = String(e).includes("UNIQUE") && (await again()); // the same request arrived twice at once
		if (!raced) throw e;
		return raced;
	}
}

export async function updateWorkout(db: D1Database, userId: UserId, input: UpdateWorkoutInput) {
	const { workout_id, ...rest } = input;
	return workoutView(await dbUpdateWorkout(db, userId, workout_id, rest));
}

/** Archives a workout: it is kept but left out of the day. Archiving one that is already archived is not an error. */
export async function archiveWorkout(db: D1Database, userId: UserId, workoutId: string) {
	const w = await getWorkout(db, userId, workoutId); // active workouts only
	if (!w || !(await dbArchiveWorkout(db, userId, workoutId))) return { archived: false as const, already_archived: true as const, workout_id: workoutId };
	return { archived: true as const, workout_id: workoutId, type: w.type, duration_minutes: w.duration_minutes, date: w.date };
}
