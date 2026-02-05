"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDbConnection = createDbConnection;
exports.getDb = getDb;
exports.closeDbConnection = closeDbConnection;
const kysely_1 = require("kysely");
const pg_1 = require("pg");
let dbInstance = null;
function createDbConnection() {
    if (dbInstance) {
        return dbInstance;
    }
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:15432/web3_indexer';
    const dialect = new kysely_1.PostgresDialect({
        pool: new pg_1.Pool({
            connectionString: databaseUrl,
        }),
    });
    dbInstance = new kysely_1.Kysely({
        dialect,
    });
    return dbInstance;
}
function getDb() {
    if (!dbInstance) {
        throw new Error('Database connection not initialized');
    }
    return dbInstance;
}
function closeDbConnection() {
    if (dbInstance) {
        return dbInstance.destroy().then(() => {
            dbInstance = null;
        });
    }
    return Promise.resolve();
}
