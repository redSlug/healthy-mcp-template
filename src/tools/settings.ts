// update_settings: time zone and daily targets.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { updateSettings } from "../services/settings";
import { respond, type ToolContext } from "./shared";

export function registerSettingsTools(server: McpServer, { userId, db }: ToolContext) {
	const target = (what: string) => z.number().int().min(0).max(100000).nullable().optional().describe(`${what}. null clears it.`);
	server.registerTool(
		"update_settings",
		{
			title: "Change settings",
			description: "Set the user's time zone and/or daily targets. The time zone decides what 'today' is and which day each log lands on, so set it first. Targets are what get_day measures against ('left today'). Only the fields you send change.",
			inputSchema: z
				.object({
					time_zone: z.string().min(1).max(64).optional().describe("IANA time zone name, for example America/Chicago."),
					targets: z
						.object({
							kcal: target("Daily calories"),
							protein_g: target("Daily protein goal in grams"),
							carbs_g: target("Daily carbs goal in grams"),
							fiber_g: target("Daily fiber goal in grams"),
							fat_min_g: target("Minimum fat in grams"),
							fat_max_g: target("Maximum fat in grams (get_day reports fat left against this)"),
							sodium_max_mg: target("Maximum sodium in milligrams"),
							water_ml: target("Daily water goal in milliliters"),
						})
						.strict()
						.optional(),
				})
				.strict(),
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		(input) => respond(() => updateSettings(db, userId, input), (r) => `Time zone ${r.time_zone}. Targets: ${Object.entries(r.targets).map(([k, v]) => `${k}=${v}`).join(", ") || "none set"}.`),
	);
}
