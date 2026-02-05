import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from './database-types';

let dbInstance: Kysely<Database> | null = null;

export function createDbConnection(): Kysely<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:15432/web3_indexer';

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: databaseUrl,
      max: 20,                      // Maximum pool size
      idleTimeoutMillis: 30000,     // Close idle clients after 30 seconds
      connectionTimeoutMillis: 5000,// Return error after 5 seconds if connection cannot be established
      statement_timeout: 30000,     // Query timeout
      query_timeout: 30000,
    }),
  });

  dbInstance = new Kysely<Database>({
    dialect,
  });

  return dbInstance;
}

export function getDb(): Kysely<Database> {
  if (!dbInstance) {
    throw new Error('Database connection not initialized');
  }
  return dbInstance;
}

export function closeDbConnection(): Promise<void> {
  if (dbInstance) {
    return dbInstance.destroy().then(() => {
      dbInstance = null;
    });
  }
  return Promise.resolve();
}