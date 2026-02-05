import { createDbConnection, getDb } from './database-config';
import { sql } from 'kysely';

/**
 * 初始化扩展数据库（Phase 3: 事件解析）
 * 添加 transactions 表和 sync_status 表
 */
export async function initDatabaseV2(): Promise<void> {
  console.log('[INIT V2] Initializing Phase 3 database schema...');

  const db = createDbConnection();

  try {
    // 1. 创建 transactions 表
    try {
      await db.schema
        .createTable('transactions')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tx_hash', 'varchar(66)', (col) => col.notNull().unique())
        .addColumn('from_address', 'varchar(42)', (col) => col.notNull())
        .addColumn('to_address', 'varchar(42)') // 默认可为空
        .addColumn('amount', sql`numeric(78,18)`) // 支持 uint256 和 18 位小数，默认可为空
        .addColumn('block_number', 'bigint', (col) => col.notNull())
        .addColumn('log_index', 'integer', (col) => col.notNull())
        .addColumn('transaction_index', 'integer', (col) => col.notNull())
        .addColumn('gas_used', 'bigint') // 默认可为空
        .addColumn('gas_price', sql`numeric(78,18)`) // 默认可为空
        .addColumn('created_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .addColumn('updated_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .addUniqueConstraint('uniq_tx_log', ['block_number', 'log_index']) // 复合唯一约束确保幂等性
        .execute();

      console.log('[INIT V2] ✅ Transactions table created');
    } catch (error: any) {
      if (error.code === '42P07') {
        console.log('[INIT V2] ✅ Transactions table already exists');
      } else {
        throw error;
      }
    }

    // 2. 创建 transactions 表的索引
    try {
      await db.schema
        .createIndex('idx_tx_block')
        .on('transactions')
        .column('block_number')
        .execute();
      console.log('[INIT V2] ✅ Index idx_tx_block created');
    } catch (error) {
      // 索引可能已存在
    }

    try {
      await db.schema
        .createIndex('idx_tx_from')
        .on('transactions')
        .column('from_address')
        .execute();
      console.log('[INIT V2] ✅ Index idx_tx_from created');
    } catch (error) {
      // 索引可能已存在
    }

    try {
      await db.schema
        .createIndex('idx_tx_hash')
        .on('transactions')
        .column('tx_hash')
        .execute();
      console.log('[INIT V2] ✅ Index idx_tx_hash created');
    } catch (error) {
      // 索引可能已存在
    }

    // 3. 创建 sync_status 表
    try {
      await db.schema
        .createTable('sync_status')
        .addColumn('chain_id', 'integer', (col) => col.primaryKey())
        .addColumn('last_block', 'bigint', (col) => col.notNull())
        .addColumn('last_synced_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .addColumn('sync_status', 'varchar(20)', (col) =>
          col.notNull().defaultTo('syncing')
        ) // 'syncing', 'caught_up', 'error'
        .addColumn('error_message', 'text') // 默认可为空
        .addColumn('updated_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .execute();

      console.log('[INIT V2] ✅ Sync status table created');
    } catch (error: any) {
      if (error.code === '42P07') {
        console.log('[INIT V2] ✅ Sync status table already exists');
      } else {
        throw error;
      }
    }

    // 4. 创建 sync_status 索引
    try {
      await db.schema
        .createIndex('idx_sync_status')
        .on('sync_status')
        .column('chain_id')
        .execute();
      console.log('[INIT V2] ✅ Index idx_sync_status created');
    } catch (error) {
      // 索引可能已存在
    }

    console.log('[INIT V2] ✅ Phase 3 database initialization completed');

  } catch (error) {
    console.error('[INIT V2] ❌ Database initialization failed:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  initDatabaseV2()
    .then(() => {
      console.log('[INIT V2] Phase 3 database setup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[INIT V2] Database setup failed:', error);
      process.exit(1);
    });
}
