import { Kysely, PostgresDialect } from 'kysely';
import { Pool, PoolClient } from 'pg';
import { Database } from './database-types';

/**
 * Database connection manager with proper lifecycle management
 * 
 * Addresses [C3] Proper Connection Lifecycle:
 * - Removes global singleton
 * - Supports parallel instances
 * - Auto-cleanup on process exit
 * - Connection pooling with configurable limits
 */
export class ConnectionManager {
  private static instances: Map<string, ConnectionManager> = new Map();
  private db: Kysely<Database> | null = null;
  private pool: Pool | null = null;
  private connectionUrl: string;
  private instanceId: string;
  private isShuttingDown = false;
  // M5 Fix: Health check tracking
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck = Date.now();
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

  constructor(connectionUrl: string, instanceId?: string) {
    this.connectionUrl = connectionUrl;
    this.instanceId = instanceId || `db-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Factory method to get or create a connection manager
   * Tracks instances for cleanup
   */
  static getInstance(connectionUrl: string, instanceId?: string): ConnectionManager {
    const key = instanceId || connectionUrl;
    
    if (!ConnectionManager.instances.has(key)) {
      ConnectionManager.instances.set(key, new ConnectionManager(connectionUrl, instanceId));
    }
    
    return ConnectionManager.instances.get(key)!;
  }

  /**
   * Create database connection with proper pool configuration
   * 
   * Pool settings:
   * - max: 20 (max concurrent connections)
   * - idleTimeoutMillis: 30000 (close idle after 30s)
   * - connectionTimeoutMillis: 5000 (fail if can't connect in 5s)
   */
  async connect(): Promise<Kysely<Database>> {
    if (this.db) {
      return this.db;
    }

    if (this.isShuttingDown) {
      throw new Error('Connection manager is shutting down, cannot create new connection');
    }

    // Create pool with proper configuration
    this.pool = new Pool({
      connectionString: this.connectionUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
    });

    // Add pool error handler
    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });

    const dialect = new PostgresDialect({
      pool: this.pool,
    });

    this.db = new Kysely<Database>({
      dialect,
    });

    // CRITICAL: Test connection immediately
    try {
      await this.db.selectFrom('blocks').select('number').limit(1).executeTakeFirst();
      console.log(`[ConnectionManager] ✅ Connection verified (${this.instanceId})`);
    } catch (error) {
      await this.destroy();
      throw new Error(`Database connection test failed: ${error}`);
    }

    // M5 Fix: Start periodic health check
    this.startHealthCheck();

    return this.db;
  }

  /**
   * M5 Fix: Start periodic health check
   * Monitors connection health and attempts recovery on failure
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      const isHealthy = await this.healthCheck();
      this.lastHealthCheck = Date.now();

      if (!isHealthy) {
        this.consecutiveFailures++;
        console.warn(
          `[ConnectionManager] Health check failed (${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}) for ${this.instanceId}`
        );

        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `[ConnectionManager] Max consecutive failures reached. Attempting recovery...`
          );
          await this.attemptRecovery();
        }
      } else {
        if (this.consecutiveFailures > 0) {
          console.log(`[ConnectionManager] Health check recovered for ${this.instanceId}`);
        }
        this.consecutiveFailures = 0;
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);

    console.log(`[ConnectionManager] Health check started (${this.HEALTH_CHECK_INTERVAL_MS}ms)`);
  }

  /**
   * M5 Fix: Stop periodic health check
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * M5 Fix: Attempt to recover connection
   */
  private async attemptRecovery(): Promise<void> {
    try {
      console.log(`[ConnectionManager] Attempting connection recovery...`);
      
      // Destroy existing connection
      const wasDb = this.db;
      const wasPool = this.pool;
      
      this.db = null;
      this.pool = null;
      
      if (wasDb) {
        try {
          await wasDb.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Reconnect
      await this.connect();
      this.consecutiveFailures = 0;
      console.log(`[ConnectionManager] ✅ Connection recovered successfully`);
    } catch (error) {
      console.error(`[ConnectionManager] Connection recovery failed:`, error);
      // Keep consecutiveFailures high to trigger retry on next interval
    }
  }

  /**
   * Get existing connection or throw
   */
  getDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first');
    }
    return this.db;
  }

  /**
   * Get raw pool for advanced operations
   */
  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Pool not initialized');
    }
    return this.pool;
  }

  /**
   * Get a client from pool for raw queries
   */
  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Pool not initialized');
    }
    return this.pool.connect();
  }

  /**
   * Gracefully close all connections
   */
  async destroy(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.log(`[ConnectionManager] Closing connection pool (${this.instanceId})`);

    // M5 Fix: Stop health check
    this.stopHealthCheck();

    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }

    // Pool is closed by Kysely, but ensure it's nullified
    this.pool = null;

    // Remove from tracking
    ConnectionManager.instances.delete(this.instanceId);
    ConnectionManager.instances.delete(this.connectionUrl);

    console.log(`[ConnectionManager] ✅ Connection closed (${this.instanceId})`);
  }

  /**
   * Check if connection is healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    try {
      await this.db.selectFrom('blocks').select('number').limit(1).executeTakeFirst();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get connection stats
   */
  getStats(): { totalCount: number; idleCount: number; waitingCount: number } | null {
    if (!this.pool) {
      return null;
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Cleanup all tracked instances
   * Call on process exit
   */
  static async cleanupAll(): Promise<void> {
    console.log(`[ConnectionManager] Cleaning up ${ConnectionManager.instances.size} connections`);
    
    const promises = Array.from(ConnectionManager.instances.values()).map(async (manager) => {
      try {
        await manager.destroy();
      } catch (error) {
        console.error('Error during connection cleanup:', error);
      }
    });

    await Promise.all(promises);
    ConnectionManager.instances.clear();
  }

  /**
   * Get number of tracked instances
   */
  static getInstanceCount(): number {
    return ConnectionManager.instances.size;
  }
}

/**
 * Legacy compatibility functions
 * These maintain backward compatibility while transitioning to ConnectionManager
 */

let defaultManager: ConnectionManager | null = null;

export async function createDbConnection(connectionUrl?: string): Promise<Kysely<Database>> {
  const url = connectionUrl || process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:15432/web3_indexer';
  
  if (!defaultManager) {
    defaultManager = ConnectionManager.getInstance(url, 'default');
  }
  
  return defaultManager.connect();
}

export function getDb(): Kysely<Database> {
  if (!defaultManager) {
    throw new Error('Database connection not initialized. Call createDbConnection() first');
  }
  return defaultManager.getDb();
}

export async function closeDbConnection(): Promise<void> {
  if (defaultManager) {
    await defaultManager.destroy();
    defaultManager = null;
  }
}

// Auto-cleanup on process exit
process.on('SIGINT', async () => {
  console.log('[ConnectionManager] SIGINT received, cleaning up connections...');
  await ConnectionManager.cleanupAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[ConnectionManager] SIGTERM received, cleaning up connections...');
  await ConnectionManager.cleanupAll();
  process.exit(0);
});

// For uncaught exceptions, try cleanup but don't block
process.on('uncaughtException', async (err) => {
  console.error('[ConnectionManager] Uncaught exception:', err);
  try {
    await ConnectionManager.cleanupAll();
  } catch (cleanupErr) {
    console.error('[ConnectionManager] Cleanup error during exception:', cleanupErr);
  }
  process.exit(1);
});
