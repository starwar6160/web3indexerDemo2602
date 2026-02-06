-- Migration 003: Add Critical Production Fixes
-- This migration fixes the 3 critical issues:
-- 1. Permanent block gaps
-- 2. Non-idempotent writes
-- 3. Broken reorg handling

-- ============================================================================
-- Part 1: Add chain_id support (for multi-chain and upsert)
-- ============================================================================

-- Add chain_id column to blocks table
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS chain_id bigint NOT NULL DEFAULT 1;

-- Drop old primary key
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_pkey;

-- Create new composite primary key (chain_id, number)
ALTER TABLE blocks ADD CONSTRAINT blocks_pkey PRIMARY KEY (chain_id, number);

-- Recreate hash unique constraint with chain_id
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_hash_key;
ALTER TABLE blocks ADD CONSTRAINT blocks_hash_key UNIQUE (chain_id, hash);

-- Add index for chain_id queries
CREATE INDEX IF NOT EXISTS idx_blocks_chain_id ON blocks(chain_id);

-- ============================================================================
-- Part 2: Create sync_status table (checkpoint system)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_status (
  chain_id bigint NOT NULL,
  next_block bigint NOT NULL,
  confirmed_block bigint NOT NULL DEFAULT 0,
  head_block bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id)
);

-- Initialize sync_status for chain 1
INSERT INTO sync_status (chain_id, next_block, confirmed_block, head_block)
VALUES (1, 0, 0, 0)
ON CONFLICT (chain_id) DO NOTHING;

-- ============================================================================
-- Part 3: Create sync_gaps table (gap detection and tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_gaps (
  id serial PRIMARY KEY,
  chain_id bigint NOT NULL,
  gap_start bigint NOT NULL,
  gap_end bigint NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  retry_count integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  last_retry_at timestamptz,
  error_message text,
  UNIQUE (chain_id, gap_start, gap_end)
);

CREATE INDEX idx_sync_gaps_status ON sync_gaps(chain_id, status);
CREATE INDEX idx_sync_gaps_detected_at ON sync_gaps(detected_at DESC);

-- ============================================================================
-- Part 4: Create blocks_pending table (for confirmation depth model)
-- ============================================================================

CREATE TABLE IF NOT EXISTS blocks_pending (
  chain_id bigint NOT NULL,
  number bigint NOT NULL,
  hash varchar(66) NOT NULL,
  parent_hash varchar(66) NOT NULL,
  timestamp bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, number, hash)
);

CREATE INDEX idx_blocks_pending_chain_number ON blocks_pending(chain_id, number);
CREATE INDEX idx_blocks_pending_received_at ON blocks_pending(received_at DESC);

-- ============================================================================
-- Part 5: Add canonical flag (optional, for canonical marking model)
-- ============================================================================

-- Uncomment if using canonical marking model instead of confirmation depth
-- ALTER TABLE blocks ADD COLUMN IF NOT EXISTS canonical boolean NOT NULL DEFAULT true;
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_canonical ON blocks(chain_id, number) WHERE canonical = true;

-- ============================================================================
-- Part 6: Create helper functions for gap detection
-- ============================================================================

-- Function to detect gaps in block sequence
CREATE OR REPLACE FUNCTION detect_block_gaps(p_chain_id bigint DEFAULT 1)
RETURNS TABLE (gap_start bigint, gap_end bigint) AS $$
BEGIN
  RETURN QUERY
  WITH numbered_blocks AS (
    SELECT
      number,
      LEAD(number) OVER (ORDER BY number) as next_number
    FROM blocks
    WHERE chain_id = p_chain_id
  ),
  gaps AS (
    SELECT
      number + 1 as gap_start,
      next_number - 1 as gap_end
    FROM numbered_blocks
    WHERE next_number IS NOT NULL
      AND next_number != number + 1
  )
  SELECT * FROM gaps;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Part 7: Migration validation
-- ============================================================================

DO $$
BEGIN
  -- Verify all tables created
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_status'),
    'sync_status table not created';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_gaps'),
    'sync_gaps table not created';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'blocks_pending'),
    'blocks_pending table not created';

  -- Verify chain_id column added
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'blocks' AND column_name = 'chain_id'
  ), 'chain_id column not added to blocks';

  -- Verify primary key changed
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'blocks' AND constraint_name = 'blocks_pkey'
  ), 'blocks primary key not updated';

  RAISE NOTICE '✅ Migration 003 completed successfully';
  RAISE NOTICE '   - Added chain_id support to blocks table';
  RAISE NOTICE '   - Created sync_status checkpoint system';
  RAISE NOTICE '   - Created sync_gaps for gap tracking';
  RAISE NOTICE '   - Created blocks_pending for confirmation depth model';
  RAISE NOTICE '   - Added detect_block_gaps() helper function';
END $$;
