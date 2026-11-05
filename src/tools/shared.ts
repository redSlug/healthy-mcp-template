// Pieces shared by the tool groups: the context, the result wrapper, common input fields and summary text.
import { z } from "zod";
import { DataError } from "../data";
import type { FoodApiClients } from "../foodapis";

export interface ToolContext {
	userId: string;
	db: D1Database;
	clients: FoodApiClients;
}

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe("A calendar day, YYYY-MM-DD, in the user's time zone. Example: 2026-03-14.");

// Tool hints. Clients use them to decide what needs a confirmation: nothing is ever deleted, so none of the tools is destructive.
export const READS = { readOnlyHint: true, openWorldHint: false } as const;
export const READS_OUTSIDE = { readOnlyHint: true, openWorldHint: true } as const; // also asks USDA / Open Food Facts
export const ADDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
export const ADDS_ONCE = { ...ADDS, idempotentHint: true } as const; // safe to retry: the same client_request_id is saved once
export const CHANGES = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/**
 * Success: a short text summary (kept brief for voice) with every id and number the assistant needs. The assistant reads
 * only text, so there is no separate JSON copy. Errors it can fix come back as results, not crashes. R is the service's return type, so each summary function is checked against it.
 */
export async function respond<R extends Record<string, unknown>>(fn: () => Promise<R>, summary: (r: R) => string) {
	try {
		const r = await fn();
		return { content: [{ type: "text" as const, text: summary(r) }] };
	} catch (e) {
		if (e instanceof DataError) {
			return { isError: true, content: [{ type: "text" as const, text: e.message }] };
		}
		console.error("tool failed:", (e as Error).name); // never log health data
		throw e;
	}
}

export const nut = (n: { kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number }) =>
	`${n.kcal} kcal, ${n.protein_g} g protein, ${n.fat_g} g fat, ${n.carbs_g} g carbs, ${n.fiber_g} g fiber`;

export function leftSummary(day: { eaten: { kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number }; remaining: Record<string, number> }) {
	const parts = [`Day total so far: ${nut(day.eaten)}.`];
	if ("kcal" in day.remaining) parts.push(`${day.remaining.kcal} kcal left.`);
	if ("protein_g" in day.remaining) parts.push(`${day.remaining.protein_g} g protein left.`);
	return parts.join(" ");
}
