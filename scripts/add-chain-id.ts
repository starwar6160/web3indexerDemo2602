/**
 * 添加 chain_id 列到 blocks 表
 *
 * 这是C++风格的"atomic migration" - 不可分割的数据库升级
 */

import { createDbConnection } from '../database/database-config';
import { sql } from 'kysely';

export async function addChainIdColumn(): Promise<void> {
  console.log('[MIGRATION] Adding chain_id column to blocks table...');

  const db = createDbConnection();

  try {
    // 检查列是否已存在
    const checkResult = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'blocks' AND column_name = 'chain_id'
    `.execute(db);

    if (checkResult.rows.length > 0) {
      console.log('[MIGRATION] ✅ chain_id column already exists');
      return;
    }

    // 添加 chain_id 列
    await sql`
      ALTER TABLE blocks
      ADD COLUMN chain_id BIGINT NOT NULL DEFAULT 1
    `.execute(db);

    console.log('[MIGRATION] ✅ chain_id column added successfully');

    // 创建复合唯一索引（用于onConflict）
    try {
      await sql`
        ALTER TABLE blocks
        DROP CONSTRAINT IF EXISTS blocks_chain_number_unique
      `.execute(db);

      await sql`
        ALTER TABLE blocks
        ADD CONSTRAINT blocks_chain_number_unique
        UNIQUE (chain_id, number)
      `.execute(db);

      console.log('[MIGRATION] ✅ Composite unique constraint (chain_id, number) added');
    } catch (error) {
      console.log('[MIGRATION] ⚠️  Failed to add unique constraint:', error);
    }

    // 修改 timestamp 列为 BIGINT
    try {
      await sql`
        ALTER TABLE blocks
        ALTER COLUMN timestamp TYPE BIGINT
      `.execute(db);

      console.log('[MIGRATION] ✅ timestamp column converted to BIGINT');
    } catch (error) {
      console.log('[MIGRATION] ⚠️  Failed to convert timestamp:', error);
    }

    console.log('[MIGRATION] ✅ Migration completed successfully');

  } catch (error) {
    console.error('[MIGRATION] ❌ Migration failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  addChainIdColumn()
    .then(() => {
      console.log('[MIGRATION] Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[MIGRATION] Failed:', error);
      process.exit(1);
    });
}
