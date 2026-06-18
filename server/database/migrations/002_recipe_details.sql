-- Migration 002 — cache table for AI-generated detailed / translated recipes.
-- Each (recipe, language) is generated once and reused for all users.
-- Run: mysql -u <user> -p <db> < database/migrations/002_recipe_details.sql

CREATE TABLE IF NOT EXISTS recipe_details (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipe_id  BIGINT UNSIGNED NOT NULL,
  language   VARCHAR(20)     NOT NULL,
  content    JSON            NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipe_lang (recipe_id, language),
  CONSTRAINT fk_rdetail_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
