// log_workout, update_workout, archive_workout. Workouts also appear in get_day.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WORKOUT_INTENSITIES, WORKOUT_SOURCES, WORKOUT_TYPES } from "../data";
import { archiveWorkout, logWorkout, updateWorkout } from "../services/workouts";
import { ADDS_ONCE, CHANGES, date, respond, type ToolContext } from "./shared";

export function registerWorkoutTools(server: McpServer, { userId, db }: ToolContext) {
	const type = z.enum(WORKOUT_TYPES).describe("The kind of workout. Use other, with the details in note, if none fit.");
	const minutes = z.number().positive().max(1440).describe("Duration in minutes, for example 32.5.");
	const kcal = z.number().min(0).max(20000).describe("Calories burned. If the user did not say, estimate it from the type, duration and intensity, and send source estimate.");
	const intensity = z.enum(WORKOUT_INTENSITIES).describe("easy, moderate or hard. If the user did not say, estimate it.");
	const source = z.enum(WORKOUT_SOURCES).describe("reported if the user gave the calories burned (for example from a watch); estimate if you estimated calories or intensity.");
	const note = z.string().min(1).max(2000).describe("A free-text note, for example 'easy pace'.");

	server.registerTool(
		"log_workout",
		{
			title: "Log a workout",
			description: "Log a workout: a type (run, walk, cycle, swim, strength, yoga, hiit or other) its duration in minutes, calories burned and an intensity (easy, moderate or hard). Every one is required: estimate a value the user did not give and set source to estimate (reported only when the user gave the calories burned and intensity). date defaults to today in the user's time zone. Always send a client_request_id: a new unique value for each new workout, and the SAME value if you retry, so a retry is not saved twice.",
			inputSchema: z
				.object({
					client_request_id: z.string().min(8).max(64).describe("A unique id you make up for this request (for example a UUID). Re-send the same id when retrying after an error or timeout; a repeat returns the first workout instead of logging another."),
					type,
					duration_minutes: minutes,
					kcal_burned: kcal,
					intensity,
					source,
					date: date.optional().describe("The day of the workout, YYYY-MM-DD in the user's time zone. Defaults to today."),
					note: note.optional(),
				})
				.strict(),
			annotations: ADDS_ONCE,
		},
		(input) =>
			respond(
				() => logWorkout(db, userId, input),
				(r) => `${r.already_logged ? "Already logged by an earlier request with this client_request_id (nothing new saved). " : ""}Logged ${r.duration_minutes} min of ${r.intensity} ${r.type}, ${r.kcal_burned} kcal burned (${r.source}), on ${r.date}. workout_id=${r.workout_id}`,
			),
	);
	server.registerTool(
		"update_workout",
		{
			title: "Change a workout",
			description: "Change a workout (get its workout_id from get_day): type, duration_minutes, kcal_burned, intensity, source, date or note. If you change duration, type or intensity without a new kcal_burned, re-estimate it and set source estimate. Only the fields you send change.",
			inputSchema: z
				.object({
					workout_id: z.string().uuid().describe("workout_id from get_day or log_workout."),
					type: type.optional(),
					duration_minutes: minutes.optional(),
					kcal_burned: kcal.optional(),
					intensity: intensity.optional(),
					source: source.optional(),
					date: date.optional().describe("Move to this day, YYYY-MM-DD in the user's time zone."),
					note: note.nullable().optional().describe("New note. null removes it."),
				})
				.strict(),
			annotations: CHANGES,
		},
		(input) => respond(() => updateWorkout(db, userId, input), (r) => `Updated: ${r.duration_minutes} min of ${r.intensity} ${r.type}, ${r.kcal_burned} kcal burned (${r.source}), on ${r.date}.`),
	);
	server.registerTool(
		"archive_workout",
		{
			title: "Archive a workout",
			description: "Remove one workout from the day by archiving it (workout_id from get_day). Nothing is deleted: the workout is kept but left out of the day. Says what was archived. If it is already archived it says so; that is not an error.",
			inputSchema: z.object({ workout_id: z.string().uuid().describe("workout_id from get_day or log_workout.") }).strict(),
			annotations: CHANGES,
		},
		(input) =>
			respond(
				() => archiveWorkout(db, userId, input.workout_id),
				(r) => (r.archived ? `Archived the ${r.duration_minutes} min ${r.type} workout on ${r.date}.` : "That workout is already archived (or never existed). Nothing changed."),
			),
	);
}
