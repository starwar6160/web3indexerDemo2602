import { createDbConnection } from '../database-config';

/**
 * Migration 002: Add parent_hash index for reorg performance
 */
export async function up(): Promise<void> {
  const db = await createDbConnection();

  console.log('[Migration 002] Adding parent_hash index...');

  try {
    await db.schema
      .createIndex('idx_blocks_parent_hash')
      .on('blocks')
      .column('parent_hash')
      .execute();

    console.log('[Migration 002] ✅ Parent hash index created');
  } catch (error: any) {
    if (error.code === '42P07') {
      console.log('[Migration 002] ✅ Parent hash index already exists');
    } else {
      throw error;
    }
  }
}

export async function down(): Promise<void> {
  const db = await createDbConnection();

  console.log('[Migration 002] Dropping parent_hash index...');

  try {
    await db.schema
      .dropIndex('idx_blocks_parent_hash')
      .execute();

    console.log('[Migration 002] ✅ Parent hash index dropped');
  } catch (error) {
    console.error('[Migration 002] ❌ Failed to drop index:', error);
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  up()
    .then(() => {
      console.log('[Migration 002] completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Migration 002] failed:', error);
      process.exit(1);
    });
}
