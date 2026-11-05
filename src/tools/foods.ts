// search_foods, add_food, import_food, update_food.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { EXTRA_KEYS, type ExtraKey, type Nutrients } from "../nutrition";
import { addFood, importFood, searchFoods, updateFood } from "../services/foods";
import { ADDS, CHANGES, READS_OUTSIDE, respond, type ToolContext } from "./shared";

const nutrientShape = {
	kcal: z.number().min(0).describe("Calories (kcal)."),
	protein_g: z.number().min(0).describe("Protein in grams."),
	fat_g: z.number().min(0).describe("Total fat in grams."),
	carbs_g: z.number().min(0).describe("Total carbohydrates in grams."),
	fiber_g: z.number().min(0).describe("Dietary fiber in grams."),
	sugar_g: z.number().min(0).describe("Total sugars in grams."),
	added_sugar_g: z.number().min(0).describe("Added sugars in grams (0 if none)."),
	saturated_fat_g: z.number().min(0).describe("Saturated fat in grams."),
	trans_fat_g: z.number().min(0).describe("Trans fat in grams (0 if none)."),
	cholesterol_mg: z.number().min(0).describe("Cholesterol in milligrams."),
	sodium_mg: z.number().min(0).describe("Sodium in milligrams."),
};
/** Every nutrient on the standard label is required. If a value is not listed, estimate it and save the food with source "estimate". */
const nutrients = z.object(nutrientShape).strict();

const fill = z
	.object(Object.fromEntries(EXTRA_KEYS.map((k) => [k, nutrientShape[k].optional()])) as { [K in ExtraKey]: z.ZodOptional<(typeof nutrientShape)[K]> })
	.strict();

const per100 = (n: Nutrients) =>
	`${n.kcal} kcal, ${n.protein_g} g protein, ${n.fat_g} g fat (${n.saturated_fat_g} saturated, ${n.trans_fat_g} trans), ${n.carbs_g} g carbs (${n.fiber_g} fiber, ${n.sugar_g} sugar, ${n.added_sugar_g} added sugar), ${n.cholesterol_mg} mg cholesterol, ${n.sodium_mg} mg sodium per 100 g`;

const warn = (r: { warnings?: string[] }) => (r.warnings?.length ? ` ${r.warnings.join(" ")}` : "");

/** Claude only reads the text block, so every id and number it needs must be in the text. */
function searchSummary(r: Awaited<ReturnType<typeof searchFoods>>) {
	const lines = r.results.map((f, i) => {
		const name = f.brand ? `${f.name} (${f.brand})` : f.name;
		const id = f.saved ? `food_id=${f.food_id} [saved ${f.type}${f.serving_g ? `, serving ${f.serving_g} g` : ""}]` : `external_source=${f.external_source} external_id=${f.external_id} [not saved: call import_food first]`;
		const p = f.per_100g;
		const values = f.saved ? per100(p as Nutrients) : `${p.kcal} kcal, ${p.protein_g} g protein, ${p.fat_g} g fat, ${p.carbs_g} g carbs per 100 g${f.missing.length ? `; NOT LISTED (estimate and send in fill when importing): ${f.missing.join(", ")}` : ""}`;
		const parts = "notes" in f && f.notes ? ` | notes: ${f.notes}` : "";
		return `${i + 1}. ${name} | ${id} | ${values}${parts}`;
	});
	const head = r.results.length ? `${r.results.length} match${r.results.length === 1 ? "" : "es"}:` : "No matches.";
	return [head, ...lines, ...("warnings" in r ? (r.warnings ?? []) : [])].join("\n");
}

export function registerFoodTools(server: McpServer, { userId, db, clients }: ToolContext) {
	server.registerTool(
		"search_foods",
		{
			title: "Search foods",
			description: "Find a food or saved meal by name. Each saved result has a type (food or meal; a meal made from foods has its ingredients in notes). Searches the user's saved foods first, then USDA and Open Food Facts. Saved results have a food_id; outside results have external_source and external_id and must be saved with import_food before logging.",
			inputSchema: z
				.object({
					query: z.string().min(1).max(200).describe("What to look for, for example 'cottage cheese' or 'Fage 2%'."),
					limit: z.number().int().min(1).max(20).optional().describe("Most results to return, 1 to 20."),
					include_external: z.boolean().optional().describe("false searches only the user's saved foods; default is to also search USDA and Open Food Facts."),
				})
				.strict(),
			annotations: READS_OUTSIDE,
		},
		(input) => respond(() => searchFoods(db, userId, clients, input), searchSummary),
	);

	server.registerTool(
		"add_food",
		{
			title: "Save a food or meal",
			description:
				"Save a food or a meal. Give exactly one of: per_100g, or per_serving together with serving_g (from a label); items (a meal made of foods the user already saved: food_id and grams, 1 to 30; the server adds up the nutrients, the meal's weight becomes one serving, and a Made-of line is added to the notes); or totals (figures the user states for a whole meal, with total_grams, its weight). Every nutrient on the standard label is required in all of them: calories, protein, fat, saturated fat, trans fat, carbs, fiber, sugar, added sugar, cholesterol and sodium. If a value is not listed (homemade food, incomplete database entry), estimate it and use source estimate: any food with even one estimated value is source estimate. A meal's numbers are a snapshot: editing an ingredient food later does not change the meal. A name already saved is refused (use update_food instead). Saved meals are found with search_foods (type meal) and logged with log_entries, grams or servings.",
			inputSchema: z
				.object({
					name: z.string().min(1).max(200).describe("The food's name, for example 'Cottage cheese, 2%'. Must not already be saved."),
					source: z.enum(["label", "estimate"]).optional().describe("Where the numbers came from: label (every value is on a package label) or estimate (any value is a guess, or a figure the user stated). Required with per_100g and per_serving; items and totals set it themselves. Foods from USDA or Open Food Facts are saved with import_food."),
					brand: z.string().max(200).nullable().optional().describe("The brand, if any."),
					serving_g: z.number().positive().optional().describe("Grams in one serving. Required with per_serving."),
					per_100g: nutrients.optional().describe("Nutrients in 100 g of the food."),
					per_serving: nutrients.optional().describe("Nutrients in one serving (needs serving_g). The server converts it to per 100 g."),
					items: z
						.array(z.object({ food_id: z.string().uuid().describe("food_id of a saved food."), grams: z.number().positive().max(5000).describe("Grams of it in the meal.") }).strict())
						.min(1)
						.max(30)
						.optional()
						.describe("A meal made of saved foods, 1 to 30. The server adds up the nutrients."),
					totals: z
						.object({ total_grams: z.number().positive().describe("Weight of the whole meal in grams."), ...nutrientShape })
						.strict()
						.optional()
						.describe("Figures for the WHOLE meal (not per 100 g) and its weight in grams, for example 'about 600 calories' in a 350 g meal. All nutrients are required."),
					notes: z.string().max(2000).optional().describe("Free-text notes."),
				})
				.strict(),
			annotations: ADDS,
		},
		(input) => respond(() => addFood(db, userId, input), (r) => `Saved ${r.type} ${r.name} (source ${r.source}): ${per100(r.per_100g)}${r.serving_g ? `, serving ${r.serving_g} g` : ""}. food_id=${r.food_id}.${warn(r)}`),
	);

	server.registerTool(
		"import_food",
		{
			title: "Save a found food",
			description: "Save a food found by search_foods from USDA or Open Food Facts into the user's foods, using its external_source and external_id. Importing twice returns the existing food. If search_foods says nutrients are NOT LISTED, estimate each per 100 g and send them in fill; a food with any filled value is saved as source estimate.",
			inputSchema: z
				.object({
					external_source: z.enum(["usda", "off"]).describe("usda or off (Open Food Facts), as shown by search_foods."),
					external_id: z.string().min(1).max(100).describe("The external_id shown by search_foods."),
					fill: fill.optional().describe("Estimated values per 100 g for the nutrients search_foods listed as NOT LISTED."),
				})
				.strict(),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		},
		(input) => respond(() => importFood(db, userId, clients, input), (r) => `${r.already_saved ? "Already saved" : "Saved"}: ${r.name} (source ${r.source}): ${per100(r.per_100g)}. food_id=${r.food_id}`),
	);

	server.registerTool(
		"update_food",
		{
			title: "Fix or archive a food",
			description: "Fix or archive a saved food or meal (food_id from search_foods): name, brand, serving_g, notes, per_100g values, or archived: true to hide it from search. Only the fields you send change. A fix applies to EVERY log of this food, past days included, so past totals change; there is no way to apply a fix only from now on. To keep history as it was, archive the food and save a corrected one under a new name.",
			inputSchema: z
				.object({
					food_id: z.string().uuid().describe("food_id from search_foods."),
					name: z.string().min(1).max(200).optional().describe("New name."),
					brand: z.string().max(200).nullable().optional().describe("New brand. null removes it."),
					serving_g: z.number().positive().nullable().optional().describe("Grams in one serving. null removes it."),
					notes: z.string().max(2000).nullable().optional().describe("New notes. null removes them."),
					archived: z.boolean().optional().describe("true hides the food from search; false brings it back."),
					per_100g: nutrients.optional().describe("Corrected nutrients per 100 g (replaces all of them, so send every nutrient)."),
				})
				.strict(),
			annotations: CHANGES,
		},
		(input) => respond(() => updateFood(db, userId, input), (r) => `Updated ${r.name}: ${per100(r.per_100g)}${r.archived ? " [archived]" : ""}. food_id=${r.food_id}.${warn(r)}`),
	);
}
