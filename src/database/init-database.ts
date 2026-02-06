import { createDbConnection, getDb } from './database-config';
import { sql } from 'kysely';

export async function initDatabase(): Promise<void> {
  console.log('[INIT] Initializing database...');

  const db = await createDbConnection();

  try {
    // 尝试查询 blocks 表，如果表不存在会抛出错误
    try {
      await db.selectFrom('blocks')
        .select('number')
        .limit(1)
        .executeTakeFirst();
      console.log('[INIT] ✅ Blocks table already exists');
    } catch (error) {
      // 表不存在，创建新表
      console.log('[INIT] Creating blocks table...');

      await db.schema
        .createTable('blocks')
        .addColumn('number', 'bigint', (col) =>
          col.notNull().primaryKey()
        )
        .addColumn('hash', 'varchar(66)', (col) =>
          col.notNull().unique()
        )
        .addColumn('timestamp', 'integer', (col) =>
          col.notNull()
        )
        .addColumn('parent_hash', 'varchar(66)', (col) =>
          col.notNull()
        )
        .addColumn('created_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .addColumn('updated_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .execute();

      console.log('[INIT] ✅ Blocks table created successfully');
    }

    // 创建索引以提高查询性能
    try {
      await db.schema
        .createIndex('idx_blocks_number')
        .on('blocks')
        .column('number')
        .execute();
      console.log('[INIT] ✅ Number index created');
    } catch (error) {
      // 索引可能已存在
    }

    try {
      await db.schema
        .createIndex('idx_blocks_hash')
        .on('blocks')
        .column('hash')
        .execute();
      console.log('[INIT] ✅ Hash index created');
    } catch (error) {
      // 索引可能已存在
    }

    // parent_hash 索引 - 用于 reorg 检测时快速查找父区块
    try {
      await db.schema
        .createIndex('idx_blocks_parent_hash')
        .on('blocks')
        .column('parent_hash')
        .execute();
      console.log('[INIT] ✅ Parent hash index created (improves reorg performance)');
    } catch (error) {
      // 索引可能已存在
    }

    // Phase 3 Fix: Create transactions table for decoded event data
    try {
      await db.schema
        .createTable('transactions')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tx_hash', 'varchar(66)', (col) => col.notNull().unique())
        .addColumn('block_number', 'bigint', (col) => col.notNull())
        .addColumn('from_address', 'varchar(42)', (col) => col.notNull())
        .addColumn('to_address', 'varchar(42)')
        .addColumn('value', sql`decimal(78,18)`) // Phase 4: DECIMAL for token amounts
        .addColumn('gas_price', sql`decimal(78,18)`)
        .addColumn('gas_used', 'bigint')
        .addColumn('status', 'integer') // 1 = success, 0 = failed
        .addColumn('created_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .execute();
      console.log('[INIT] ✅ Transactions table created');
    } catch (error) {
      console.log('[INIT] Transactions table already exists');
    }

    // Phase 3 Fix: Create sync_status table for detailed progress tracking
    try {
      await db.schema
        .createTable('sync_status')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('processor_name', 'varchar(255)', (col) => col.notNull().unique())
        .addColumn('last_processed_block', 'bigint', (col) => col.notNull())
        .addColumn('last_processed_hash', 'varchar(66)')
        .addColumn('target_block', 'bigint')
        .addColumn('synced_percent', sql`decimal(5,2)`) // 0.00 - 100.00
        .addColumn('status', 'varchar(20)', (col) =>
          col.notNull().defaultTo('active')
        ) // active, paused, error, complete
        .addColumn('error_message', 'text')
        .addColumn('updated_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .execute();
      console.log('[INIT] ✅ Sync status table created');
    } catch (error) {
      console.log('[INIT] Sync status table already exists');
    }

    // Phase 4 Fix: Add composite unique index for idempotency
    try {
      await db.schema
        .createIndex('idx_tx_block_log_unique')
        .on('transactions')
        .columns(['block_number', 'tx_hash'])
        .unique()
        .execute();
      console.log('[INIT] ✅ Composite unique index created (idempotency)');
    } catch (error) {
      // 索引可能已存在
    }

    // Phase 5: Create transfers table for ERC20/token transfer events
    try {
      await db.schema
        .createTable('transfers')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('block_number', 'bigint', (col) => col.notNull())
        .addColumn('transaction_hash', 'varchar(66)', (col) => col.notNull())
        .addColumn('log_index', 'integer', (col) => col.notNull())
        .addColumn('from_address', 'varchar(42)', (col) => col.notNull())
        .addColumn('to_address', 'varchar(42)', (col) => col.notNull())
        .addColumn('amount', 'varchar(78)', (col) => col.notNull()) // String to preserve BigInt precision
        .addColumn('token_address', 'varchar(42)', (col) => col.notNull())
        .addColumn('timestamp', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .addColumn('created_at', 'timestamptz', (col) =>
          col.notNull().defaultTo(sql`now()`)
        )
        .execute();

      // Create indexes for performance-critical queries
      await db.schema
        .createIndex('idx_transfers_block_number')
        .on('transfers')
        .column('block_number')
        .execute();

      await db.schema
        .createIndex('idx_transfers_from_address')
        .on('transfers')
        .column('from_address')
        .execute();

      await db.schema
        .createIndex('idx_transfers_to_address')
        .on('transfers')
        .column('to_address')
        .execute();

      await db.schema
        .createIndex('idx_transfers_token_address')
        .on('transfers')
        .column('token_address')
        .execute();

      await db.schema
        .createIndex('idx_transfers_tx_hash')
        .on('transfers')
        .column('transaction_hash')
        .execute();

      console.log('[INIT] ✅ Transfers table created with indexes');
    } catch (error) {
      console.log('[INIT] Transfers table already exists');
    }

    console.log('[INIT] ✅ Database initialization completed');

  } catch (error) {
    console.error('[INIT] ❌ Database initialization failed:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('[INIT] Database setup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[INIT] Database setup failed:', error);
      process.exit(1);
    });
}