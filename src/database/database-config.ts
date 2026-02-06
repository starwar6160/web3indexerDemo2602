import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from './database-types';

let dbInstance: Kysely<Database> | null = null;
let isInitializing = false; // 🟣 Fix R1: Track initialization state

export async function createDbConnection(): Promise<Kysely<Database>> {
  if (dbInstance) {
    return dbInstance;
  }

  // 🟣 Fix R1: Prevent concurrent initialization attempts
  if (isInitializing) {
    throw new Error(
      'Database connection is already being initialized. ' +
      'This may indicate a race condition in your startup code. '
    );
  }

  isInitializing = true;

  try {
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:15432/web3_indexer';

    const dialect = new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
        query_timeout: 30000,
      }),
    });

    dbInstance = new Kysely<Database>({
      dialect,
    });

    // CRITICAL FIX: Test connection immediately
    try {
      await dbInstance.selectFrom('blocks').select('number').limit(1).executeTakeFirst();
      console.log('✅ Database connection verified');
    } catch (error) {
      dbInstance = null;
      throw new Error(`Database connection test failed: ${error}`);
    }

    return dbInstance;
  } catch (error) {
    dbInstance = null;
    isInitializing = false;
    throw new Error(
      `Failed to create database connection: ${error}. `
    );
  } finally {
    if (dbInstance) {
      isInitializing = false;
    }
  }
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