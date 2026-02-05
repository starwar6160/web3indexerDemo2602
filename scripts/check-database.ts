import { createDbConnection } from '../database/database-config';
import { BlockRepository } from '../database/block-repository';

export async function checkDatabaseStatus(): Promise<void> {
  console.log('[CHECK] Checking database status...');

  try {
    const db = createDbConnection();
    const blockRepository = new BlockRepository();

    // 检查数据库连接
    const count = await blockRepository.getBlockCount();
    const maxBlock = await blockRepository.getMaxBlockNumber();

    console.log('[CHECK] ✅ Database connection successful');
    console.log('[CHECK] Total blocks in database:', count);
    console.log('[CHECK] Latest block number:', maxBlock);

    if (count === 0) {
      console.log('[CHECK] ℹ️  Database is empty, no blocks synced yet');
    } else {
      console.log('[CHECK] ℹ️  Database contains blocks from 0 to', maxBlock);
    }

    await db.destroy();
    console.log('[CHECK] ✅ Database check completed');
  } catch (error) {
    console.error('[CHECK] ❌ Database check failed:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  checkDatabaseStatus()
    .then(() => {
      console.log('[CHECK] Database status check completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[CHECK] Database status check failed:', error);
      process.exit(1);
    });
}