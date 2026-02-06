import { sql } from 'kysely';
import { getDb } from '../database-config';

export async function up(): Promise<void> {
  const db = getDb();

  console.log('[Migration 004] Fixing transaction_logs unique constraint...');

  const tableExists = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'transaction_logs'
    );
  `.execute(db);

  // @ts-ignore - Kysely sql template type limitation
  if (!tableExists.rows[0]?.exists) {
    console.log('[Migration 004] transaction_logs table does not exist, skipping');
    return;
  }

  await sql`
    ALTER TABLE transaction_logs
    DROP CONSTRAINT IF EXISTS transaction_logs_tx_log_unique;
  `.execute(db);

  await sql`
    ALTER TABLE transaction_logs
    ADD CONSTRAINT transaction_logs_tx_log_unique
    UNIQUE (block_number, log_index);
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_transaction_logs_block_number
    ON transaction_logs(block_number);
  `.execute(db);

  console.log('[Migration 004] ✅ transaction_logs unique constraint fixed');
}

export async function down(): Promise<void> {
  const db = getDb();

  console.log('[Migration 004] Rolling back transaction_logs unique constraint...');

  const tableExists = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'transaction_logs'
    );
  `.execute(db);

  // @ts-ignore - Kysely sql template type limitation
  if (!tableExists.rows[0]?.exists) {
    console.log('[Migration 004] transaction_logs table does not exist, skipping');
    return;
  }

  await sql`
    ALTER TABLE transaction_logs
    DROP CONSTRAINT IF EXISTS transaction_logs_tx_log_unique;
  `.execute(db);

  await sql`
    ALTER TABLE transaction_logs
    ADD CONSTRAINT transaction_logs_tx_log_unique
    UNIQUE (transaction_hash, log_index);
  `.execute(db);

  console.log('[Migration 004] ✅ rollback complete');
}

if (require.main === module) {
  const command = process.argv[2];

  if (command === 'down') {
    down()
      .then(() => {
        console.log('[Migration 004] Rollback completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('[Migration 004] Rollback failed:', error);
        process.exit(1);
      });
  } else {
    up()
      .then(() => {
        console.log('[Migration 004] completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('[Migration 004] failed:', error);
        process.exit(1);
      });
  }
}
