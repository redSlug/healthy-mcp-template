# Test fixtures: real API responses

Captured from the live APIs and trimmed to the fields our clients read (nothing else was changed).

| File | Source |
| --- | --- |
| `usda-search.json` | `GET api.nal.usda.gov/fdc/v1/foods/search?query=greek yogurt` (first 4 foods) |
| `usda-detail.json` | `GET api.nal.usda.gov/fdc/v1/food/{fdcId}` |
| `off-search.json` | `GET search.openfoodfacts.org/search?q=skyr` (first 4 hits) |
| `off-product.json` | `GET world.openfoodfacts.org/api/v2/product/3017620422003.json` |

To refresh one, fetch the URL in the table and trim it to the fields the clients read. Provider formats change, so if the tests fail after a refresh, the client needs updating.

Things the real data taught us:
- USDA search results list `foodNutrients` as `{nutrientId, value}`, but the detail endpoint uses `{nutrient: {id}, amount}`.
- Open Food Facts' older `cgi/search.pl` text search returned HTTP 503 pages; the `search.openfoodfacts.org` service works. Its `brands` is an array, `serving_quantity` is often null, and sodium is in grams.
- A search for "greek yogurt" at USDA returns branded products first.
