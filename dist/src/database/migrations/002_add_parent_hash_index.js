"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
const database_config_1 = require("../database-config");
/**
 * Migration 002: Add parent_hash index for reorg performance
 */
async function up() {
    const db = (0, database_config_1.createDbConnection)();
    console.log('[Migration 002] Adding parent_hash index...');
    try {
        await db.schema
            .createIndex('idx_blocks_parent_hash')
            .on('blocks')
            .column('parent_hash')
            .execute();
        console.log('[Migration 002] ✅ Parent hash index created');
    }
    catch (error) {
        if (error.code === '42P07') {
            console.log('[Migration 002] ✅ Parent hash index already exists');
        }
        else {
            throw error;
        }
    }
}
async function down() {
    const db = (0, database_config_1.createDbConnection)();
    console.log('[Migration 002] Dropping parent_hash index...');
    try {
        await db.schema
            .dropIndex('idx_blocks_parent_hash')
            .execute();
        console.log('[Migration 002] ✅ Parent hash index dropped');
    }
    catch (error) {
        console.error('[Migration 002] ❌ Failed to drop index:', error);
        throw error;
    }
}
// Run migration if executed directly
if (require.main === module) {
    up()
        .then(() => {
        console.log('[Migration 002] completed');
        process.exit(0);
    })
        .catch((error) => {
        console.error('[Migration 002] failed:', error);
        process.exit(1);
    });
}
