-- Full schema. Conventions: ids are UUIDs generated in code; timestamps are ISO 8601 UTC text; booleans are 0/1;
-- `date` columns are the user's local calendar day, YYYY-MM-DD.
-- Nutrients are never stored on logs: only `foods` (per 100 g) hold numbers. A saved meal is a food with kind 'meal'.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  auth_provider TEXT NOT NULL,
  auth_subject  TEXT NOT NULL,
  time_zone     TEXT NOT NULL DEFAULT 'America/New_York',   -- IANA name; decides what "today" is
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (auth_provider, auth_subject)
);

-- One row of daily targets per user. A null target is not set.
CREATE TABLE targets (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kcal           INTEGER CHECK (kcal IS NULL OR kcal >= 0),
  protein_g      INTEGER CHECK (protein_g IS NULL OR protein_g >= 0),
  fat_min_g      INTEGER CHECK (fat_min_g IS NULL OR fat_min_g >= 0),
  fat_max_g      INTEGER CHECK (fat_max_g IS NULL OR fat_max_g >= 0),
  carbs_g        INTEGER CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fiber_g        INTEGER CHECK (fiber_g IS NULL OR fiber_g >= 0),
  sodium_max_mg  INTEGER CHECK (sodium_max_mg IS NULL OR sodium_max_mg >= 0),
  water_ml       INTEGER CHECK (water_ml IS NULL OR water_ml >= 0),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (fat_max_g IS NULL OR fat_min_g IS NULL OR fat_max_g >= fat_min_g)
);

-- foods: nutrients per 100 g. Water is a food too (see src/data/users.ts: every new user gets a "Water" food).
-- Every nutrient on the standard label is required (a value that is not listed is estimated, and then source is 'estimate').
-- A saved meal is a food with kind 'meal': serving_g is the meal's total weight, so one serving is serving_g grams.
-- A meal's nutrients are a snapshot; the ingredients it was made from are written into `notes`.
CREATE TABLE foods (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  brand       TEXT CHECK (brand IS NULL OR length(brand) <= 200),
  kind        TEXT NOT NULL DEFAULT 'food' CHECK (kind IN ('food','meal')),
  serving_g   REAL CHECK (serving_g IS NULL OR serving_g > 0),
  kcal              REAL NOT NULL CHECK (kcal >= 0),
  protein_g         REAL NOT NULL CHECK (protein_g >= 0),
  fat_g             REAL NOT NULL CHECK (fat_g >= 0),
  carbs_g           REAL NOT NULL CHECK (carbs_g >= 0),
  fiber_g           REAL NOT NULL CHECK (fiber_g >= 0),
  sugar_g           REAL NOT NULL CHECK (sugar_g >= 0),
  added_sugar_g     REAL NOT NULL CHECK (added_sugar_g >= 0),
  saturated_fat_g   REAL NOT NULL CHECK (saturated_fat_g >= 0),
  trans_fat_g       REAL NOT NULL CHECK (trans_fat_g >= 0),
  cholesterol_mg    REAL NOT NULL CHECK (cholesterol_mg >= 0),
  sodium_mg         REAL NOT NULL CHECK (sodium_mg >= 0),
  source      TEXT NOT NULL CHECK (source IN ('label','usda','off','estimate','recipe')),
  external_id TEXT,
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  notes       TEXT,
  archived_at TEXT,   -- set when hidden from search; rows are never deleted
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, user_id)         -- lets child tables enforce same-user foreign keys
);
CREATE INDEX idx_foods_user_name ON foods (user_id, name);
CREATE UNIQUE INDEX idx_foods_user_external ON foods (user_id, source, external_id) WHERE external_id IS NOT NULL;

-- Full-text search over name and brand; kept in sync by the data-access module (src/data/foods.ts).
CREATE VIRTUAL TABLE foods_fts USING fts5(food_id UNINDEXED, user_id UNINDEXED, name, brand);

-- food_logs: a pointer and an amount in grams. Never stores nutrients.
-- meal_type 'water' is for drinking water (grams = ml); 'dessert' is its own group.
CREATE TABLE food_logs (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date              TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),   -- user's local day
  meal_type         TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack','dessert','water')),
  food_id           TEXT NOT NULL,
  grams             REAL NOT NULL CHECK (grams > 0 AND grams <= 5000),
  note              TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  eaten             INTEGER NOT NULL DEFAULT 1 CHECK (eaten IN (0,1)),
  mindfulness_score REAL CHECK (mindfulness_score IS NULL OR (mindfulness_score >= 0 AND mindfulness_score <= 1)),
  eaten_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at       TEXT,   -- set instead of deleting; archived logs are left out of every total
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (food_id, user_id) REFERENCES foods (id, user_id)  -- a log can only point at the same user's food
);
CREATE INDEX idx_food_logs_user_date ON food_logs (user_id, date);

-- workouts: deliberately small, but every field is required so reporting is complete. A value the user does not state is
-- estimated by Claude, and then source is 'estimate' (one flag for the whole workout, as with foods).
CREATE TABLE workouts (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),   -- user's local day
  type             TEXT NOT NULL CHECK (type IN ('run','walk','cycle','swim','strength','yoga','hiit','other')),
  duration_minutes REAL NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  kcal_burned      REAL NOT NULL CHECK (kcal_burned >= 0 AND kcal_burned <= 20000),
  intensity        TEXT NOT NULL CHECK (intensity IN ('easy','moderate','hard')),
  source           TEXT NOT NULL CHECK (source IN ('reported','estimate')),
  note             TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  archived_at      TEXT,   -- set instead of deleting
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_workouts_user_date ON workouts (user_id, date);

-- request_log: remembers each logging request by the id the assistant sent, so a retried request is not saved twice.
CREATE TABLE request_log (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  date       TEXT NOT NULL,   -- the local day the request logged to
  ids        TEXT NOT NULL,   -- JSON array of the log ids (or the one workout id) it created
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, request_id)
);
