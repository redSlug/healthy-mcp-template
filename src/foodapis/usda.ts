// USDA FoodData Central. https://fdc.nal.usda.gov/api-guide.html
// Search results list nutrients as {nutrientId, value}; the detail endpoint lists {nutrient: {id}, amount}. Both are per 100 g.
import { ExternalApiError, TIMEOUT_MS, USER_AGENT, type ExternalFood } from "./types";

const BASE = "https://api.nal.usda.gov/fdc/v1";
// Energy is 1008 (kcal); some Foundation foods only carry the Atwater energy values 2047 or 2048.
const ID = { kcal: [1008, 2047, 2048], protein: [1003], fat: [1004], carbs: [1005], fiber: [1079], sugar: [2000, 1063], added_sugar: [1235], saturated: [1258], trans: [1257], cholesterol: [1253], sodium: [1093] };

type Fetch = typeof fetch;

function amount(nutrients: any[], ids: number[]): number | null {
	for (const id of ids) {
		const n = nutrients.find((x) => (x.nutrientId ?? x.nutrient?.id) === id);
		const v = n?.value ?? n?.amount;
		if (typeof v === "number") return v;
	}
	return null;
}

function normalizeUsda(f: any): ExternalFood | null {
	const nutrients: any[] = f?.foodNutrients ?? [];
	const kcal = amount(nutrients, ID.kcal);
	const protein = amount(nutrients, ID.protein);
	const fat = amount(nutrients, ID.fat);
	const carbs = amount(nutrients, ID.carbs);
	if (f?.fdcId == null || !f.description || kcal == null || protein == null || fat == null || carbs == null) return null;
	const servingG = f.servingSizeUnit?.toLowerCase() === "g" && f.servingSize > 0 ? f.servingSize : null;
	return {
		external_source: "usda",
		external_id: String(f.fdcId),
		name: String(f.description),
		brand: f.brandName ?? f.brandOwner ?? null,
		serving_g: servingG,
		per_100g: { kcal, protein_g: protein, fat_g: fat, carbs_g: carbs, 
			fiber_g: amount(nutrients, ID.fiber), sugar_g: amount(nutrients, ID.sugar), added_sugar_g: amount(nutrients, ID.added_sugar),
			saturated_fat_g: amount(nutrients, ID.saturated), trans_fat_g: amount(nutrients, ID.trans), cholesterol_mg: amount(nutrients, ID.cholesterol), sodium_mg: amount(nutrients, ID.sodium),
		},
	};
}

async function call(fetchFn: Fetch, url: string, apiKey: string): Promise<any> {
	let res: Response;
	try {
		res = await fetchFn(url, { headers: { "X-Api-Key": apiKey, "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch (e) {
		throw new ExternalApiError("usda", `USDA request failed: ${(e as Error).message}`);
	}
	if (res.status === 404) return null;
	if (!res.ok) throw new ExternalApiError("usda", `USDA returned HTTP ${res.status}`);
	return res.json();
}

export async function searchUsda(fetchFn: Fetch, apiKey: string, query: string, limit: number): Promise<ExternalFood[]> {
	const url = `${BASE}/foods/search?${new URLSearchParams({ query, pageSize: String(Math.min(limit * 3, 50)) })}`;
	const body = await call(fetchFn, url, apiKey);
	return ((body?.foods ?? []) as any[]).map(normalizeUsda).filter((f): f is ExternalFood => f !== null).slice(0, limit);
}

export async function getUsda(fetchFn: Fetch, apiKey: string, id: string): Promise<ExternalFood | null> {
	const body = await call(fetchFn, `${BASE}/food/${encodeURIComponent(id)}`, apiKey);
	return body ? normalizeUsda(body) : null;
}
