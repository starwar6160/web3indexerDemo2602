"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabaseV2 = initDatabaseV2;
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
/**
 * 初始化扩展数据库（Phase 3: 事件解析）
 * 添加 transactions 表和 sync_status 表
 */
async function initDatabaseV2() {
    console.log('[INIT V2] Initializing Phase 3 database schema...');
    const db = await (0, database_config_1.createDbConnection)();
    try {
        // 1. 创建 transactions 表
        try {
            await db.schema
                .createTable('transactions')
                .addColumn('id', 'serial', (col) => col.primaryKey())
                .addColumn('tx_hash', 'varchar(66)', (col) => col.notNull().unique())
                .addColumn('from_address', 'varchar(42)', (col) => col.notNull())
                .addColumn('to_address', 'varchar(42)') // 默认可为空
                .addColumn('amount', (0, kysely_1.sql) `numeric(78,18)`) // 支持 uint256 和 18 位小数，默认可为空
                .addColumn('block_number', 'bigint', (col) => col.notNull())
                .addColumn('log_index', 'integer', (col) => col.notNull())
                .addColumn('transaction_index', 'integer', (col) => col.notNull())
                .addColumn('gas_used', 'bigint') // 默认可为空
                .addColumn('gas_price', (0, kysely_1.sql) `numeric(78,18)`) // 默认可为空
                .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo((0, kysely_1.sql) `now()`))
                .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo((0, kysely_1.sql) `now()`))
                .addUniqueConstraint('uniq_tx_log', ['block_number', 'log_index']) // 复合唯一约束确保幂等性
                .execute();
            console.log('[INIT V2] ✅ Transactions table created');
        }
        catch (error) {
            if (error.code === '42P07') {
                console.log('[INIT V2] ✅ Transactions table already exists');
            }
            else {
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
        }
        catch (error) {
            // 索引可能已存在
        }
        try {
            await db.schema
                .createIndex('idx_tx_from')
                .on('transactions')
                .column('from_address')
                .execute();
            console.log('[INIT V2] ✅ Index idx_tx_from created');
        }
        catch (error) {
            // 索引可能已存在
        }
        try {
            await db.schema
                .createIndex('idx_tx_hash')
                .on('transactions')
                .column('tx_hash')
                .execute();
            console.log('[INIT V2] ✅ Index idx_tx_hash created');
        }
        catch (error) {
            // 索引可能已存在
        }
        // 3. 创建 sync_status 表
        try {
            await db.schema
                .createTable('sync_status')
                .addColumn('id', 'serial', (col) => col.primaryKey())
                .addColumn('processor_name', 'varchar(255)', (col) => col.notNull().unique())
                .addColumn('last_processed_block', 'bigint', (col) => col.notNull())
                .addColumn('last_processed_hash', 'varchar(66)')
                .addColumn('target_block', 'bigint')
                .addColumn('synced_percent', (0, kysely_1.sql) `decimal(5,2)`) // 0.00 - 100.00
                .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
                .addColumn('error_message', 'text')
                .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo((0, kysely_1.sql) `now()`))
                .execute();
            console.log('[INIT V2] ✅ Sync status table created');
        }
        catch (error) {
            if (error.code === '42P07') {
                console.log('[INIT V2] ✅ Sync status table already exists');
            }
            else {
                throw error;
            }
        }
        // 4. 创建 sync_status 索引
        try {
            await db.schema
                .createIndex('idx_sync_status')
                .on('sync_status')
                .column('processor_name')
                .execute();
            console.log('[INIT V2] ✅ Index idx_sync_status created');
        }
        catch (error) {
            // 索引可能已存在
        }
        try {
            await db.schema
                .createIndex('idx_sync_status_status')
                .on('sync_status')
                .column('status')
                .execute();
            console.log('[INIT V2] ✅ Index idx_sync_status_status created');
        }
        catch (error) {
            // 索引可能已存在
        }
        console.log('[INIT V2] ✅ Phase 3 database initialization completed');
    }
    catch (error) {
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
