import { createDbConnection } from '../database/database-config';
import { initDatabase } from '../database/init-database';

export async function migrateDatabase(): Promise<void> {
  console.log('[MIGRATE] Starting database migration...');

  const db = createDbConnection();

  try {
    await initDatabase();
    console.log('[MIGRATE] ✅ Database migration completed successfully');
  } catch (error) {
    console.error('[MIGRATE] ❌ Database migration failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  migrateDatabase()
    .then(() => {
      console.log('[MIGRATE] Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[MIGRATE] Migration failed:', error);
      process.exit(1);
    });
}