// log_entries, update_log, archive_log and get_day.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MEAL_TYPES } from "../data";
import { archiveLog, getDay, logEntries, updateLog } from "../services/logs";
import { ADDS_ONCE, CHANGES, date, leftSummary, nut, READS, respond, type ToolContext } from "./shared";

function daySummary(r: Awaited<ReturnType<typeof getDay>>) {
	const foods = r.food_logs.map((l) => `- ${l.meal_type}: ${l.grams} g ${l.food_name} (${l.eaten ? "eaten" : "planned"}) ${nut(l.nutrients)}${l.mindfulness_score == null ? "" : `, mindfulness ${l.mindfulness_score}/10`} [log_id=${l.log_id}]`);
	const workouts = r.workouts.map((w) => `- workout: ${w.duration_minutes} min ${w.intensity} ${w.type}, ${w.kcal_burned} kcal burned${w.source === "estimate" ? " (estimated)" : ""}${w.note ? ` (${w.note})` : ""} [workout_id=${w.workout_id}]`);
	const e = r.totals.eaten;
	const n = r.food_logs.length;
	const head = `${n} food entr${n === 1 ? "y" : "ies"} and ${r.workouts.length} workout${r.workouts.length === 1 ? "" : "s"} on ${r.date}.`;
	const eaten = `Eaten: ${nut(e)}, ${e.sugar_g} g sugar (${e.added_sugar_g} added), ${e.saturated_fat_g} g saturated fat, ${e.trans_fat_g} g trans fat, ${e.cholesterol_mg} mg cholesterol, ${e.sodium_mg} mg sodium, ${r.totals.water_ml} ml water${"water_ml" in r.totals.remaining ? ` (${r.totals.remaining.water_ml} ml left of the ${r.totals.targets.water_ml} ml goal)` : ""}.${r.mindfulness_avg == null ? "" : ` Mindfulness: ${r.mindfulness_avg}/10 on average.`}`;
	return [head, ...foods, ...workouts, eaten, leftSummary(r.totals)].join("\n");
}

export function registerLogTools(server: McpServer, { userId, db }: ToolContext) {
	const mealType = z.enum(MEAL_TYPES);
	const common = {
		date: date.optional().describe("The day this was eaten, YYYY-MM-DD in the user's time zone (noon is assumed). Use this when the user names a day but not a time. Defaults to now."),
		eaten_at: z.iso.datetime({ offset: true }).optional().describe("When it was eaten: an ISO 8601 time with offset, for example 2026-03-14T08:30:00-05:00. Wins over date. Defaults to now."),
		note: z.string().min(1).max(2000).optional().describe("A free-text note, for example 'at the diner'. Applies to every entry."),
		eaten: z.boolean().optional().describe("true (default) means it was eaten. false means planned, not yet eaten: it counts in 'planned' totals but not in 'eaten' totals."),
		mindfulness_score: z.number().min(1).max(10).optional().describe("How mindfully it was eaten, 1 (distracted) to 10 (fully attentive). Only if the user says so."),
	};

	server.registerTool(
		"log_entries",
		{
			title: "Log food and water",
			description:
				"Log what the user ate or drank, or plans to eat (eaten=false). Foods: entries, each a food_id (from search_foods) with grams, or with servings (1 = one serving of a saved meal or packaged food; 0.5 = half), under one meal_type. Drinking water: just send water_ml (for example 500); the server finds the Water food and files it under meal type water. Entries and water_ml can be sent together. All entries are saved together or not at all. Always send a client_request_id: a new unique value for each new request, and the SAME value if you retry, so a retry is not saved twice. Returns the day's new totals, calculated by the server.",
			inputSchema: z
				.object({
					client_request_id: z.string().min(8).max(64).describe("A unique id you make up for this request (for example a UUID). Re-send the same id when retrying after an error or timeout; a repeat returns the first result instead of logging again."),
					meal_type: mealType.optional().describe("breakfast, lunch, dinner, snack or dessert. Required with entries. Do not use water here; use water_ml."),
					entries: z
						.array(
							z.union([
								z.object({ food_id: z.string().uuid().describe("food_id from search_foods."), grams: z.number().positive().max(5000).describe("Amount in grams, 0 to 5000.") }).strict(),
								z.object({ food_id: z.string().uuid().describe("food_id from search_foods."), servings: z.number().positive().max(100).describe("Number of servings, for example 1 or 0.5. Needs the food to have a serving size.") }).strict(),
							]),
						)
						.min(1)
						.max(30)
						.optional()
						.describe("The foods, 1 to 30."),
					water_ml: z.number().positive().max(5000).optional().describe("Drinking water in milliliters, for example 500."),
					...common,
				})
				.strict(),
			annotations: ADDS_ONCE,
		},
		(input) =>
			respond(
				() => logEntries(db, userId, input),
				(r) => `${r.already_logged ? "Already logged by an earlier request with this client_request_id (nothing new saved). " : ""}Logged ${r.log_ids.length} entr${r.log_ids.length === 1 ? "y" : "ies"}. log_ids=[${r.log_ids.join(", ")}]. ${leftSummary(r.day)}`,
			),
	);

	server.registerTool(
		"update_log",
		{
			title: "Change a logged entry",
			description: "Change one log (get its log_id from get_day): grams, meal_type, date, eaten_at, note, eaten or mindfulness_score. Only the fields you send change. Use eaten=true to mark a planned entry as eaten. To change which food a log is for, archive it with archive_log and log again.",
			inputSchema: z
				.object({
					log_id: z.string().uuid().describe("log_id from get_day or log_entries."),
					grams: z.number().positive().max(5000).optional().describe("New amount in grams."),
					meal_type: mealType.optional().describe("breakfast, lunch, dinner, snack, dessert or water."),
					date: date.optional().describe("Move to this day, YYYY-MM-DD in the user's time zone (noon is assumed)."),
					eaten_at: z.iso.datetime({ offset: true }).optional().describe("New time: an ISO 8601 time with offset, for example 2026-03-14T08:30:00-05:00. Wins over date."),
					note: z.string().min(1).max(2000).nullable().optional().describe("New note. null removes it."),
					eaten: z.boolean().optional().describe("true = eaten, false = planned."),
					mindfulness_score: z.number().min(1).max(10).nullable().optional().describe("1 (distracted) to 10 (fully attentive). null removes it."),
				})
				.strict(),
			annotations: CHANGES,
		},
		(input) => respond(() => updateLog(db, userId, input), (r) => `Updated: ${r.grams} g ${r.food_name} ${nut(r.nutrients)}. ${leftSummary(r.day)}`),
	);

	server.registerTool(
		"archive_log",
		{
			title: "Archive a logged entry",
			description: "Remove one food log from the day by archiving it (get its log_id from get_day). Nothing is deleted: the entry is kept but left out of the day and every total. Says what was archived and returns the day's new totals. If the log is already archived it says so; that is not an error.",
			inputSchema: z.object({ log_id: z.string().uuid().describe("log_id from get_day or log_entries.") }).strict(),
			annotations: CHANGES,
		},
		(input) =>
			respond(
				() => archiveLog(db, userId, input.log_id),
				(r) => (r.archived ? `Archived ${r.grams} g ${r.food_name} (${r.meal_type}, ${r.date}). ${leftSummary(r.day)}` : "That log is already archived (or never existed). Nothing changed."),
			),
	);

	server.registerTool(
		"get_day",
		{
			title: "Get a day",
			description: "One day's food logs (each with meal_type and log_id), workouts (each with workout_id) and totals: eaten, planned, water (with what is left of the water goal), mindfulness scores (each entry's, and the day's average) and targets and what is left. Defaults to today in the user's time zone.",
			inputSchema: z.object({ date: date.optional().describe("Defaults to today in the user's time zone.") }).strict(),
			annotations: READS,
		},
		(input) => respond(() => getDay(db, userId, input.date), daySummary),
	);
}
