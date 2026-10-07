-- Migration 007 — index for the public catalogue delta sync.
--
-- GET /catalog/recipes pages rows by the (updated_at, id) cursor so the native
-- Android app can pull only recipes added/changed since its last sync (its
-- bundled snapshot covers the rest). Without this index every sync page is a
-- full table scan + filesort over ~9k rows.
--
-- Run: mysql -u <user> -p <db> < database/migrations/007_catalog_sync.sql

ALTER TABLE recipes
  ADD INDEX idx_recipes_updated (updated_at, id);
