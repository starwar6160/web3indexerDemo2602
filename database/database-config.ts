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