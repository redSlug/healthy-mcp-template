// Open Food Facts. https://openfoodfacts.github.io/openfoodfacts-server/api/
// No key needed, but a descriptive User-Agent is required. Values are per 100 g; sodium and cholesterol are in GRAMS and energy may be kJ only.
// Text search uses their search-a-licious service (search.openfoodfacts.org). The older cgi/search.pl endpoint returned
// HTTP 503 pages when tried, so it is not used. Searches are rate limited, so imported foods are cached in our database.
import { ExternalApiError, TIMEOUT_MS, USER_AGENT, type ExternalFood } from "./types";

const FIELDS = "code,product_name,brands,serving_quantity,nutriments";
type Fetch = typeof fetch;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : null);

const firstBrand = (b: unknown): string | null => {
	const first = Array.isArray(b) ? b[0] : typeof b === "string" ? b.split(",")[0] : null;
	return typeof first === "string" && first.trim() ? first.trim() : null;
};

function normalizeOff(p: any): ExternalFood | null {
	const n = p?.nutriments ?? {};
	const kcal = num(n["energy-kcal_100g"]) ?? (num(n["energy_100g"]) != null ? num(n["energy_100g"])! / 4.184 : null);
	const protein = num(n["proteins_100g"]);
	const fat = num(n["fat_100g"]);
	const carbs = num(n["carbohydrates_100g"]);
	const name = p?.product_name?.trim();
	if (!p?.code || !name || kcal == null || protein == null || fat == null || carbs == null) return null;
	// Sodium is in grams. If only salt is given, sodium is salt / 2.5.
	const sodiumG = num(n["sodium_100g"]) ?? (num(n["salt_100g"]) != null ? num(n["salt_100g"])! / 2.5 : null);
	const cholesterolG = num(n["cholesterol_100g"]);
	const serving = num(p.serving_quantity);
	return {
		external_source: "off",
		external_id: String(p.code),
		name,
		brand: firstBrand(p.brands),
		serving_g: serving != null && serving > 0 ? serving : null,
		per_100g: { kcal, protein_g: protein, fat_g: fat, carbs_g: carbs, 
			fiber_g: num(n["fiber_100g"]), sugar_g: num(n["sugars_100g"]), added_sugar_g: num(n["added-sugars_100g"]),
			saturated_fat_g: num(n["saturated-fat_100g"]), trans_fat_g: num(n["trans-fat_100g"]), cholesterol_mg: cholesterolG == null ? null : cholesterolG * 1000,
			sodium_mg: sodiumG == null ? null : sodiumG * 1000,
		},
	};
}

async function call(fetchFn: Fetch, url: string): Promise<any> {
	let res: Response;
	try {
		res = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch (e) {
		throw new ExternalApiError("off", `Open Food Facts request failed: ${(e as Error).message}`);
	}
	if (res.status === 404) return null;
	if (!res.ok) throw new ExternalApiError("off", `Open Food Facts returned HTTP ${res.status}`);
	return res.json();
}

export async function searchOff(fetchFn: Fetch, query: string, limit: number): Promise<ExternalFood[]> {
	const params = new URLSearchParams({ q: query, page_size: String(Math.min(limit * 3, 50)), fields: FIELDS });
	const body = await call(fetchFn, `https://search.openfoodfacts.org/search?${params}`);
	return ((body?.hits ?? []) as any[]).map(normalizeOff).filter((f): f is ExternalFood => f !== null).slice(0, limit);
}

export async function getOff(fetchFn: Fetch, code: string): Promise<ExternalFood | null> {
	const body = await call(fetchFn, `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
	return body?.status === 0 || !body?.product ? null : normalizeOff({ ...body.product, code: body.product.code ?? code });
}
