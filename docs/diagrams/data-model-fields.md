# Data model: all fields

`PK` primary key, `FK` foreign key, `UK` unique. Dates are the user's local day (`YYYY-MM-DD`); timestamps are UTC ISO 8601 text. `archived_at` is empty while the row is active.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryColor': '#fef3c7', 'primaryBorderColor': '#d97706', 'primaryTextColor': '#78350f', 'secondaryColor': '#fffbeb', 'tertiaryColor': '#fffbeb', 'attributeBackgroundColorOdd': '#fffbeb', 'attributeBackgroundColorEven': '#fef3c7'}}}%%
erDiagram
    users ||--o| targets : "has one"
    users ||--o{ foods : owns
    users ||--o{ food_logs : owns
    users ||--o{ workouts : owns
    users ||--o{ request_log : owns
    foods ||--o{ food_logs : "is logged as"
    foods ||--|| foods_fts : "indexed in"

    users {
        text id PK
        text auth_provider UK
        text auth_subject UK
        text time_zone "IANA name"
        text created_at
    }
    targets {
        text user_id PK, FK
        int kcal
        int protein_g
        int fat_min_g
        int fat_max_g
        int carbs_g
        int fiber_g
        int sodium_max_mg
        int water_ml
        text updated_at
    }
    foods {
        text id PK
        text user_id FK
        text name
        text brand
        text kind "food or meal"
        real serving_g "grams in one serving"
        real kcal "per 100 g"
        real protein_g "per 100 g"
        real fat_g "per 100 g"
        real carbs_g "per 100 g"
        real fiber_g "per 100 g"
        real sugar_g "per 100 g"
        real added_sugar_g "per 100 g"
        real saturated_fat_g "per 100 g"
        real trans_fat_g "per 100 g"
        real cholesterol_mg "per 100 g"
        real sodium_mg "per 100 g"
        text source "label, usda, off, estimate, recipe"
        text external_id
        int verified
        text notes
        text archived_at "empty while active"
        text created_at
        text updated_at
    }
    foods_fts {
        text food_id
        text user_id
        text name
        text brand
    }
    food_logs {
        text id PK
        text user_id FK
        text date "local day"
        text meal_type "breakfast to water"
        text food_id FK
        real grams "water: ml"
        text note
        int eaten "0 = planned"
        real mindfulness_score "0 to 1"
        text eaten_at
        text archived_at "empty while active"
        text created_at
        text updated_at
    }
    workouts {
        text id PK
        text user_id FK
        text date "local day"
        text type "run, walk, ..."
        real duration_minutes
        real kcal_burned
        text intensity "easy, moderate or hard"
        text source "reported or estimate"
        text note
        text archived_at "empty while active"
        text created_at
        text updated_at
    }
    request_log {
        text user_id PK, FK
        text request_id PK "client_request_id"
        text date
        text ids "JSON list of ids"
        text created_at
    }
```

Values worth knowing:
- `foods.source`: label, usda, off, estimate or recipe. A food with even one estimated nutrient has source `estimate`. A saved meal is a food with `kind` `meal`, and its `serving_g` is the whole meal's weight. A meal made from saved foods lists its ingredients in `notes`.
- `food_logs.meal_type`: breakfast, lunch, dinner, snack, dessert or water (for water, grams are millilitres).
- `food_logs.mindfulness_score`: stored as 0 to 1, shown as 1 to 10.
- `workouts.type`: run, walk, cycle, swim, strength, yoga, hiit or other.
- `workouts.source`: reported when the user gave the calories burned and intensity, estimate when Claude estimated either one.

See also [data model: overview](data-model-overview.md).

Colors: see the [legend](README.md#colors).
