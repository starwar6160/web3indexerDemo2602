import { createDbConnection, getDb } from './database-config';
import { sql } from 'kysely';

export async function initDatabase(): Promise<void> {
  console.log('[INIT] Initializing database...');

  const db = createDbConnection();

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