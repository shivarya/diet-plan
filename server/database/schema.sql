-- Diet Plan App — database schema (MySQL 8.0+)
-- Run: mysql -u root -p diet_plan < database/schema.sql

SET NAMES utf8mb4;
SET time_zone = '+05:30';

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email           VARCHAR(255)    NOT NULL,
  name            VARCHAR(255)    NULL,
  google_id       VARCHAR(64)     NULL,
  profile_picture VARCHAR(512)    NULL,
  is_premium      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_google_id (google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- recipes — the curated backbone
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(120)    NOT NULL,
  name            VARCHAR(200)    NOT NULL,
  cuisine         VARCHAR(60)     NOT NULL DEFAULT 'Indian',
  meal_type       ENUM('breakfast','lunch','dinner','snack') NOT NULL,
  servings        TINYINT UNSIGNED NOT NULL DEFAULT 2,

  -- Nutrition (per serving)
  calories        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  protein_g       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  carbs_g         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  fat_g           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  fiber_g         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  calcium_mg      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  vitamin_score   TINYINT UNSIGNED  NOT NULL DEFAULT 0, -- 0..5 coarse micronutrient richness

  -- Dietary flags
  contains_egg    TINYINT(1) NOT NULL DEFAULT 0,
  contains_onion  TINYINT(1) NOT NULL DEFAULT 0,
  contains_garlic TINYINT(1) NOT NULL DEFAULT 0,
  is_kid_friendly TINYINT(1) NOT NULL DEFAULT 0,
  is_high_protein TINYINT(1) NOT NULL DEFAULT 0,
  is_low_carb     TINYINT(1) NOT NULL DEFAULT 0,
  is_weight_loss  TINYINT(1) NOT NULL DEFAULT 0,

  ingredients     JSON         NOT NULL,
  instructions    TEXT         NULL,
  prep_time_min   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  difficulty      ENUM('easy','medium','hard') NOT NULL DEFAULT 'easy',
  image_url       VARCHAR(512) NULL,

  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_recipes_slug (slug),
  KEY idx_recipes_meal_type (meal_type),
  KEY idx_recipes_egg (contains_egg),
  KEY idx_recipes_onion (contains_onion),
  KEY idx_recipes_garlic (contains_garlic),
  KEY idx_recipes_kid (is_kid_friendly),
  KEY idx_recipes_lowcarb (is_low_carb)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- dietary_preferences — one row per user; per-day rules live in day_rules JSON
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dietary_preferences (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id              BIGINT UNSIGNED NOT NULL,
  daily_calorie_target SMALLINT UNSIGNED NOT NULL DEFAULT 1500,
  protein_floor_g      SMALLINT UNSIGNED NOT NULL DEFAULT 80,
  carb_ceiling_g       SMALLINT UNSIGNED NOT NULL DEFAULT 120,
  calcium_target_mg    SMALLINT UNSIGNED NOT NULL DEFAULT 1000,
  has_kid              TINYINT(1) NOT NULL DEFAULT 0,
  kid_age              TINYINT UNSIGNED NULL,
  -- Per-weekday rules: { "monday": {"egg":1,"onion":1,"garlic":1}, ... }
  day_rules            JSON NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pref_user (user_id),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- meal_plans — one per user per week
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meal_plans (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  week_start_date DATE NOT NULL,
  generated_by    ENUM('rule','ai') NOT NULL DEFAULT 'rule',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_user_week (user_id, week_start_date),
  CONSTRAINT fk_plan_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- meal_plan_items — one row per (day, meal slot); kid add-ons flagged
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meal_plan_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meal_plan_id  BIGINT UNSIGNED NOT NULL,
  day_of_week   TINYINT UNSIGNED NOT NULL,  -- 0=Mon .. 6=Sun
  meal_type     ENUM('breakfast','lunch','dinner','snack') NOT NULL,
  recipe_id     BIGINT UNSIGNED NOT NULL,
  is_kid_addon  TINYINT(1) NOT NULL DEFAULT 0,
  servings      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_item_plan (meal_plan_id),
  KEY idx_item_recipe (recipe_id),
  CONSTRAINT fk_item_plan FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
