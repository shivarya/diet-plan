-- Migration 003 — weekly dal cadence.
-- Adds a per-user "dal lunches per week" target (0-7, default 3). The rule
-- planner reserves that many lunch slots, spread across the week, for a
-- dal/legume main (respecting each day's veg/egg + onion/garlic rules).
--
-- Idempotent-ish: re-running errors on the duplicate column — that's fine, it
-- means the migration already applied.
-- Run: mysql -u <user> -p <db> < database/migrations/003_dal_per_week.sql

ALTER TABLE dietary_preferences
  ADD COLUMN dal_per_week TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER include_accompaniment;
