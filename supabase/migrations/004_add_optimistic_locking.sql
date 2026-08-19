-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 004: Add Optimistic Locking (Version Columns)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE: Prevent race conditions in concurrent updates to critical balance tables.
-- STRATEGY: Optimistic locking with version columns.
-- ═══════════════════════════════════════════════════════════════════════════

-- Add version column to cash_balance
-- Used when multiple concurrent cash movements happen
ALTER TABLE cash_balance ADD COLUMN version INTEGER DEFAULT 1 NOT NULL;

-- Add version column to on_positions
-- Used when multiple concurrent ON transactions update same ticker
ALTER TABLE on_positions ADD COLUMN version INTEGER DEFAULT 1 NOT NULL;

-- Add version column to positions (stocks)
-- Used when multiple concurrent stock transactions update same ticker
ALTER TABLE positions ADD COLUMN version INTEGER DEFAULT 1 NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTES:
-- - Version starts at 1 for all existing rows (via DEFAULT)
-- - Application code will increment version on every UPDATE
-- - UPDATE WHERE version = current_version ensures only one writer succeeds
-- - Failed updates (0 rows affected) trigger retry logic in app layer
-- ═══════════════════════════════════════════════════════════════════════════
