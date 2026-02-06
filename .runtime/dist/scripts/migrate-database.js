"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateDatabase = migrateDatabase;
const database_config_1 = require("../database/database-config");
const init_database_1 = require("../database/init-database");
async function migrateDatabase() {
    console.log('[MIGRATE] Starting database migration...');
    const db = (0, database_config_1.createDbConnection)();
    try {
        await (0, init_database_1.initDatabase)();
        console.log('[MIGRATE] ✅ Database migration completed successfully');
    }
    catch (error) {
        console.error('[MIGRATE] ❌ Database migration failed:', error);
        throw error;
    }
    finally {
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
