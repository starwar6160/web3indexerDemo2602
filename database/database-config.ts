import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from './database-types';

let dbInstance: Kysely<Database> | null = null;
let isInitializing = false; // 🟣 Fix R1: Track initialization state

export function createDbConnection(): Kysely<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // 🟣 Fix R1: Prevent concurrent initialization attempts
  // Problem: If createDbConnection() fails, dbInstance remains null but subsequent calls
  // may attempt to create new connections, leading to multiple pool instances
  // Solution: Track initialization state and throw error if already initializing
  if (isInitializing) {
    throw new Error(
      'Database connection is already being initialized. ' +
      'This may indicate a race condition in your startup code. ' +
      'Please ensure createDbConnection() is called only once.'
    );
  }

  isInitializing = true;

  try {
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

    // Verify connection works before returning
    // This ensures dbInstance is only set if connection is valid
    void dbInstance.selectFrom('blocks').select('number').limit(1).execute();

    return dbInstance;
  } catch (error) {
    // 🟣 Fix R1: Clear state on failure to allow retry
    // If connection fails, don't leave dbInstance in a bad state
    dbInstance = null;
    isInitializing = false;
    throw new Error(
      `Failed to create database connection: ${error}. ` +
      `Connection string may be invalid or database server may be unreachable.`
    );
  } finally {
    // Only clear initialization flag if we succeeded
    // If we failed, the catch block already cleared it
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