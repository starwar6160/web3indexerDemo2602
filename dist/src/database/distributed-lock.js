"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLock = exports.DistributedLock = void 0;
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
/**
 * Distributed lock implementation using PostgreSQL advisory locks
 *
 * P2 Fix: Prevents multiple instances from syncing the same block range
 *
 * Usage:
 * ```typescript
 * const lock = new DistributedLock('block-sync');
 * const acquired = await lock.acquire();
 * if (acquired) {
 *   try {
 *     await syncBlocks();
 *   } finally {
 *     await lock.release();
 *   }
 * }
 * ```
 */
class DistributedLock {
    /**
     * Create a distributed lock
     *
     * @param lockName Unique name for this lock (e.g., 'block-sync', 'gap-repair')
     * @param timeoutMs Lock timeout in milliseconds (default: 30000 = 30s)
     */
    constructor(lockName, timeoutMs = 30000) {
        this.timeoutMs = timeoutMs;
        this.db = (0, database_config_1.getDb)();
        this.acquired = false;
        this.lockName = lockName;
        // Generate a consistent ID from lock name using hash
        this.lockId = this.hashString(lockName);
    }
    /**
     * Attempt to acquire the lock
     *
     * Uses PostgreSQL advisory locks which are:
     * - Automatically released on connection close
     * - Server-wide (work across all connections)
     * - Fast and scalable
     *
     * @returns true if lock was acquired, false otherwise
     */
    async acquire() {
        try {
            const result = await (0, kysely_1.sql) `
        SELECT pg_try_advisory_lock(${this.lockId}) as acquired
      `.execute(this.db);
            this.acquired = result.rows[0]?.acquired || false;
            if (this.acquired) {
                console.log(`[DistributedLock] ✅ Acquired lock '${this.lockName}' (ID: ${this.lockId})`);
            }
            else {
                console.warn(`[DistributedLock] ⚠️  Failed to acquire lock '${this.lockName}' - another instance holds it`);
            }
            return this.acquired;
        }
        catch (error) {
            console.error(`[DistributedLock] ❌ Error acquiring lock:`, error);
            return false;
        }
    }
    /**
     * Release the lock
     *
     * Note: Advisory locks are automatically released when the connection closes,
     * but explicit release is good practice.
     */
    async release() {
        if (!this.acquired) {
            return;
        }
        try {
            await (0, kysely_1.sql) `
        SELECT pg_advisory_unlock(${this.lockId})
      `.execute(this.db);
            this.acquired = false;
            console.log(`[DistributedLock] 🔓 Released lock '${this.lockName}'`);
        }
        catch (error) {
            console.error(`[DistributedLock] ❌ Error releasing lock:`, error);
        }
    }
    /**
     * Execute a function with the lock held
     *
     * @param fn Function to execute while holding lock
     * @returns Result of the function
     * @throws Error if lock cannot be acquired
     */
    async withLock(fn) {
        const acquired = await this.acquire();
        if (!acquired) {
            throw new Error(`Could not acquire lock '${this.lockName}'. ` +
                `Another instance may be running.`);
        }
        try {
            return await fn();
        }
        finally {
            await this.release();
        }
    }
    /**
     * Check if lock is currently held
     */
    async isLocked() {
        try {
            const result = await (0, kysely_1.sql) `
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory'
          AND objid = ${this.lockId}
          AND pid <> pg_backend_pid()
        ) as locked
      `.execute(this.db);
            return result.rows[0]?.locked || false;
        }
        catch (error) {
            console.error(`[DistributedLock] ❌ Error checking lock status:`, error);
            return false;
        }
    }
    /**
     * Generate a numeric hash from string for use as lock ID
     *
     * PostgreSQL advisory locks use a 64-bit integer ID.
     * This converts a string name to a consistent number.
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
}
exports.DistributedLock = DistributedLock;
/**
 * Application-level lock table implementation (fallback)
 *
 * This provides additional metadata and timeout support beyond advisory locks.
 */
class AppLock {
    constructor() {
        this.db = (0, database_config_1.getDb)();
    }
    async acquireLock(lockName, instanceId, timeoutMs = 30000) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeoutMs);
        try {
            // Try to insert a new lock or update expired lock
            await (0, kysely_1.sql) `
        INSERT INTO app_locks (name, instance_id, expires_at)
        VALUES (${lockName}, ${instanceId}, ${expiresAt.toISOString()})
        ON CONFLICT (name)
        DO UPDATE SET
          instance_id = ${instanceId},
          expires_at = ${expiresAt.toISOString()},
          updated_at = ${now.toISOString()}
        WHERE app_locks.expires_at < ${now.toISOString()}
      `.execute(this.db);
            // Verify we actually own the lock
            const lock = await (0, kysely_1.sql) `
        SELECT instance_id FROM app_locks WHERE name = ${lockName}
      `.execute(this.db);
            const owned = lock.rows[0]?.instance_id === instanceId;
            if (owned) {
                console.log(`[AppLock] ✅ Acquired lock '${lockName}' for instance '${instanceId}'`);
            }
            else {
                console.warn(`[AppLock] ⚠️  Lock '${lockName}' held by another instance`);
            }
            return owned;
        }
        catch (error) {
            console.error(`[AppLock] ❌ Error acquiring lock:`, error);
            return false;
        }
    }
    async releaseLock(lockName, instanceId) {
        try {
            await (0, kysely_1.sql) `
        DELETE FROM app_locks
        WHERE name = ${lockName} AND instance_id = ${instanceId}
      `.execute(this.db);
            console.log(`[AppLock] 🔓 Released lock '${lockName}'`);
        }
        catch (error) {
            console.error(`[AppLock] ❌ Error releasing lock:`, error);
        }
    }
    async cleanupExpiredLocks() {
        try {
            const result = await (0, kysely_1.sql) `
        DELETE FROM app_locks
        WHERE expires_at < NOW()
      `.execute(this.db);
            const count = result.rowCount ?? 0;
            if (count > 0) {
                console.log(`[AppLock] 🧹 Cleaned up ${count} expired locks`);
            }
            return count;
        }
        catch (error) {
            console.error(`[AppLock] ❌ Error cleaning up locks:`, error);
            return 0;
        }
    }
}
exports.AppLock = AppLock;
