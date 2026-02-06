/**
 * SpaceX哲学: DB作为最终裁判
 *
 * 规则：
 * - 非法数据 = 插入失败 = 当场炸
 * - 不要用应用层逻辑验证 = 容易绕过
 * - 让DB约束帮你防守最后一道防线
 *
 * 新增约束:
 * 1. UNIQUE (chain_id, block_number) - 防止重复区块
 * 2. UNIQUE (transaction_hash, log_index) - 防止重复日志
 * 3. NOT NULL - 强制所有必填字段
 * 4. CHECK - 业务规则约束
 */

import { sql } from 'kysely';
import { getDb } from '../database-config';

export async function up(): Promise<void> {
  const db = getDb();

  console.log('Applying SpaceX constraints...');

  // ============================================================
  // 1. 区块表约束
  // ============================================================

  // 删除可能存在的旧唯一索引（为了幂等性）
  await sql`
    ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_chain_number_unique;
  `.execute(db);

  // 添加唯一约束：防止同一链的重复区块
  await sql`
    ALTER TABLE blocks
    ADD CONSTRAINT blocks_chain_number_unique
    UNIQUE (chain_id, number);
  `.execute(db);

  // 添加Hash长度约束（防止脏数据）
  await sql`
    ALTER TABLE blocks
    ADD CONSTRAINT blocks_hash_format
    CHECK (length(hash) = 66 AND hash LIKE '0x%');
  `.execute(db);

  // 添加ParentHash格式约束
  await sql`
    ALTER TABLE blocks
    ADD CONSTRAINT blocks_parent_hash_format
    CHECK (length(parent_hash) = 66 AND parent_hash LIKE '0x%');
  `.execute(db);

  // 添加时间戳合理性约束（不能是未来时间）
  await sql`
    ALTER TABLE blocks
    ADD CONSTRAINT blocks_timestamp_not_future
    CHECK (timestamp <= EXTRACT(EPOCH FROM NOW()) + 86400);
  `.execute(db);

  console.log('✅ Blocks table constraints added');

  // ============================================================
  // 2. 检查点表约束
  // ============================================================

  // 删除旧索引
  await sql`
    ALTER TABLE sync_checkpoints DROP CONSTRAINT IF EXISTS sync_checkpoints_name_unique;
  `.execute(db);

  // 唯一约束：checkpoint名称
  await sql`
    ALTER TABLE sync_checkpoints
    ADD CONSTRAINT sync_checkpoints_name_unique
    UNIQUE (name);
  `.execute(db);

  // Block hash格式约束
  await sql`
    ALTER TABLE sync_checkpoints
    ADD CONSTRAINT sync_checkpoints_hash_format
    CHECK (length(block_hash) = 66 AND block_hash LIKE '0x%');
  `.execute(db);

  console.log('✅ Checkpoints table constraints added');

  // ============================================================
  // 3. 应用锁表约束
  // ============================================================

  await sql`
    ALTER TABLE app_locks DROP CONSTRAINT IF EXISTS app_locks_name_unique;
  `.execute(db);

  await sql`
    ALTER TABLE app_locks
    ADD CONSTRAINT app_locks_name_unique
    UNIQUE (name);
  `.execute(db);

  // 过期时间不能是过去
  await sql`
    ALTER TABLE app_locks
    ADD CONSTRAINT app_locks_expires_not_past
    CHECK (expires_at > NOW());
  `.execute(db);

  console.log('✅ Locks table constraints added');

  // ============================================================
  // 4. 交易日志表约束（如果存在）
  // ============================================================

  const tableExists = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'transaction_logs'
    );
  `.execute(db);

  // @ts-ignore - Kysely sql template type limitation
  if (tableExists.rows[0]?.exists) {
    await sql`
      ALTER TABLE transaction_logs DROP CONSTRAINT IF EXISTS transaction_logs_tx_log_unique;
    `.execute(db);

    await sql`
      ALTER TABLE transaction_logs
      ADD CONSTRAINT transaction_logs_tx_log_unique
      UNIQUE (transaction_hash, log_index);
    `.execute(db);

    await sql`
      ALTER TABLE transaction_logs
      ADD CONSTRAINT transaction_logs_hash_format
      CHECK (length(transaction_hash) = 66 AND transaction_hash LIKE '0x%');
    `.execute(db);

    await sql`
      ALTER TABLE transaction_logs
      ADD CONSTRAINT transaction_logs_address_format
      CHECK (length(address) = 42 AND address LIKE '0x%');
    `.execute(db);

    console.log('✅ Logs table constraints added');
  }

  console.log('🎉 All SpaceX constraints applied successfully!');
}

/**
 * 回滚约束（测试用）
 */
export async function down(): Promise<void> {
  const db = getDb();

  console.log('Rolling back SpaceX constraints...');

  await sql`ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_chain_number_unique;`.execute(db);
  await sql`ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_hash_format;`.execute(db);
  await sql`ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_parent_hash_format;`.execute(db);
  await sql`ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_timestamp_not_future;`.execute(db);

  await sql`ALTER TABLE sync_checkpoints DROP CONSTRAINT IF EXISTS sync_checkpoints_name_unique;`.execute(db);
  await sql`ALTER TABLE sync_checkpoints DROP CONSTRAINT IF EXISTS sync_checkpoints_hash_format;`.execute(db);

  await sql`ALTER TABLE app_locks DROP CONSTRAINT IF EXISTS app_locks_name_unique;`.execute(db);
  await sql`ALTER TABLE app_locks DROP CONSTRAINT IF EXISTS app_locks_expires_not_past;`.execute(db);

  await sql`ALTER TABLE transaction_logs DROP CONSTRAINT IF EXISTS transaction_logs_tx_log_unique;`.execute(db);
  await sql`ALTER TABLE transaction_logs DROP CONSTRAINT IF EXISTS transaction_logs_hash_format;`.execute(db);
  await sql`ALTER TABLE transaction_logs DROP CONSTRAINT IF EXISTS transaction_logs_address_format;`.execute(db);

  console.log('✅ Constraints rolled back');
}
