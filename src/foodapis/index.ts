import { getOff, searchOff } from "./off";
import type { FoodApiClients } from "./types";
import { getUsda, searchUsda } from "./usda";

export * from "./types";

/** Real clients. `fetchFn` is injectable so tests never touch the network. */
export function createFoodApiClients(usdaApiKey: string, fetchFn: typeof fetch = fetch): FoodApiClients {
	return {
		search: (source, query, limit) => (source === "usda" ? searchUsda(fetchFn, usdaApiKey, query, limit) : searchOff(fetchFn, query, limit)),
		get: (source, id) => (source === "usda" ? getUsda(fetchFn, usdaApiKey, id) : getOff(fetchFn, id)),
	};
}
