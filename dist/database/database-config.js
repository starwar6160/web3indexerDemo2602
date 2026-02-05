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
            max: 20, // Maximum pool size
            idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
            connectionTimeoutMillis: 5000, // Return error after 5 seconds if connection cannot be established
            statement_timeout: 30000, // Query timeout
            query_timeout: 30000,
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
