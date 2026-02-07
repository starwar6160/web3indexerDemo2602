/**
 * Migration 001: 修复关键数据库问题
 *
 * 修复内容：
 * 1. timestamp 字段从 integer 改为 bigint（修复 2038 年问题）
 * 2. 添加 parent_hash 索引（优化重组查询）
 * 3. 添加 version 字段（支持未来迁移）
 * 4. 添加复合唯一索引（block_number, hash）
 */

import { createDbConnection } from '../database-config';
import { sql } from 'kysely';

export async function up(): Promise<void> {
  console.log('[MIGRATION 001] Starting critical fixes migration...');

  const db = await createDbConnection();

  try {
    // 1. 修改 timestamp 字段类型：integer -> bigint
    console.log('[MIGRATION 001] Altering timestamp column to bigint...');

    // PostgreSQL: 先添加新列，然后迁移数据，最后删除旧列
    await sql`
      ALTER TABLE blocks
      ADD COLUMN IF NOT EXISTS timestamp_new BIGINT;
    `.execute(db);

    // 迁移数据
    await sql`
      UPDATE blocks
      SET timestamp_new = timestamp::BIGINT;
    `.execute(db);

    // 设置为 NOT NULL
    await sql`
      ALTER TABLE blocks
      ALTER COLUMN timestamp_new SET NOT NULL;
    `.execute(db);

    // 删除旧列并重命名新列
    await sql`
      ALTER TABLE blocks
      DROP COLUMN timestamp;
    `.execute(db);

    await sql`
      ALTER TABLE blocks
      RENAME COLUMN timestamp_new TO timestamp;
    `.execute(db);

    console.log('[MIGRATION 001] ✅ Timestamp column converted to bigint');

    // 2. 添加 parent_hash 索引
    console.log('[MIGRATION 001] Adding parent_hash index...');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_blocks_parent_hash
      ON blocks(parent_hash);
    `.execute(db);

    console.log('[MIGRATION 001] ✅ Parent hash index created');

    // 3. 添加 version 字段
    console.log('[MIGRATION 001] Adding version column...');

    await sql`
      ALTER TABLE blocks
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
    `.execute(db);

    console.log('[MIGRATION 001] ✅ Version column added');

    // 4. 添加复合唯一索引（可选，用于额外保证）
    console.log('[MIGRATION 001] Adding composite unique index...');

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_unique
      ON blocks(number, hash);
    `.execute(db);

    console.log('[MIGRATION 001] ✅ Composite unique index created');

    console.log('[MIGRATION 001] ✅ Migration completed successfully');

  } catch (error) {
    console.error('[MIGRATION 001] ❌ Migration failed:', error);
    throw error;
  }
}

/**
 * 回滚迁移
 */
export async function down(): Promise<void> {
  console.log('[MIGRATION 001] Rolling back migration...');

  const db = await createDbConnection();

  try {
    // 删除复合索引
    await sql`
      DROP INDEX IF EXISTS idx_blocks_unique;
    `.execute(db);

    // 删除 version 列
    await sql`
      ALTER TABLE blocks
      DROP COLUMN IF EXISTS version;
    `.execute(db);

    // 删除 parent_hash 索引
    await sql`
      DROP INDEX IF EXISTS idx_blocks_parent_hash;
    `.execute(db);

    // 回滚 timestamp 类型
    await sql`
      ALTER TABLE blocks
      ADD COLUMN IF NOT EXISTS timestamp_new INTEGER;
    `.execute(db);

    await sql`
      UPDATE blocks
      SET timestamp_new = timestamp::INTEGER;
    `.execute(db);

    await sql`
      ALTER TABLE blocks
      ALTER COLUMN timestamp_new SET NOT NULL;
    `.execute(db);

    await sql`
      ALTER TABLE blocks
      DROP COLUMN timestamp;
    `.execute(db);

    await sql`
      ALTER TABLE blocks
      RENAME COLUMN timestamp_new TO timestamp;
    `.execute(db);

    console.log('[MIGRATION 001] ✅ Rollback completed');

  } catch (error) {
    console.error('[MIGRATION 001] ❌ Rollback failed:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'down') {
    down()
      .then(() => {
        console.log('[MIGRATION 001] Rollback completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('[MIGRATION 001] Rollback failed:', error);
        process.exit(1);
      });
  } else {
    up()
      .then(() => {
        console.log('[MIGRATION 001] Migration completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('[MIGRATION 001] Migration failed:', error);
        process.exit(1);
      });
  }
}
