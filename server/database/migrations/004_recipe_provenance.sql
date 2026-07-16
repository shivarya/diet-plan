-- Migration 004 — recipe provenance for bulk-import pipelines beyond INDB.
-- `nutrition_source` marks whether a recipe's macros are a verified source
-- (curated by hand or matched against the INDB workbook) or an AI estimate
-- (used when a bulk-imported recipe — e.g. from server/scripts/youtube/ —
-- has no confident nutrition-database match). `source_channel` records the
-- originating YouTube channel for recipes imported that way.
--
-- DEFAULT 'verified' keeps every existing row (curated + INDB) correct with
-- no backfill needed.
--
-- Idempotent-ish: re-running errors on the duplicate column — that's fine, it
-- means the migration already applied.
-- Run: mysql -u <user> -p <db> < database/migrations/004_recipe_provenance.sql

ALTER TABLE recipes
  ADD COLUMN nutrition_source ENUM('verified','estimated') NOT NULL DEFAULT 'verified' AFTER vitamin_score,
  ADD COLUMN source_channel   VARCHAR(120) NULL AFTER video_url;
