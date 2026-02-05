import { getDb } from './database-config';
import { sql } from 'kysely';

/**
 * Initialize application lock table
 *
 * P2 Fix: Creates table for distributed coordination
 */
export async function initLockTable(): Promise<void> {
  const db = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS app_locks (
      name VARCHAR(255) PRIMARY KEY,
      instance_id VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_locks_expires_at ON app_locks(expires_at);

    COMMENT ON TABLE app_locks IS 'Distributed locks for multi-instance coordination';
    COMMENT ON COLUMN app_locks.name IS 'Unique lock name (e.g., "block-sync", "gap-repair")';
    COMMENT ON COLUMN app_locks.instance_id IS 'Identifier for the instance holding the lock';
    COMMENT ON COLUMN app_locks.expires_at IS 'Lock expiration time (prevents stale locks on crashes)';
  `.execute(db);

  console.log('[InitLock] ✅ Lock table initialized');
}
