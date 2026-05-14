-- Phase 58 / MEMORY-SIMPLIFY (v2.2 — 2026-05-14)
-- Deprecates the vector layer in `vector_entries`. Retrieval is now BM25 + KG.
--
-- This migration is intentionally non-destructive: the `embedding BLOB`
-- column survives so existing user installs keep their historical data
-- intact. New writes from `VectorStore::add` insert an empty blob.
--
-- Idempotent / safe to run on every startup — uses IF EXISTS / IF NOT EXISTS.
--
-- Hard deletion of the column is deferred to v2.3 once dogfood signal
-- confirms BM25 + KG fidelity. SQLite 3.35+ supports `ALTER TABLE … DROP
-- COLUMN` directly; pre-3.35 needs the rebuild dance. The v2.3 migration
-- will handle both.

-- 1. Ensure the BM25 lookup index on (source_type, source_id) exists.
--    This index pre-dates Phase 58 (created by db.rs) but we re-assert
--    here so a clean install + this migration script alone reaches the
--    intended state.
CREATE INDEX IF NOT EXISTS idx_vector_entries_source
    ON vector_entries(source_type, source_id);

-- 2. Add a content-prefix index to accelerate BM25 candidate selection.
--    Sub-second on ~100k rows; harmless on smaller stores. Idempotent.
CREATE INDEX IF NOT EXISTS idx_vector_entries_content_prefix
    ON vector_entries(substr(content, 1, 64));

-- 3. Add a created_at index for the time-ordered summary recall path in
--    `smart_context_recall` ("ORDER BY created_at DESC LIMIT 100").
CREATE INDEX IF NOT EXISTS idx_vector_entries_created_at
    ON vector_entries(created_at DESC);

-- v2.3 will add:
--   ALTER TABLE vector_entries DROP COLUMN embedding;
-- after dogfood signal confirms no out-of-tree reader depends on it.
