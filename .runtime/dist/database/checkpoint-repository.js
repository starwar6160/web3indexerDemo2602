"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointRepository = void 0;
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
/**
 * Repository for managing sync checkpoints
 *
 * Provides crash recovery and resume capability for the indexer
 */
class CheckpointRepository {
    constructor() {
        this.db = (0, database_config_1.getDb)();
    }
    /**
     * Initialize checkpoint table if it doesn't exist
     */
    async initialize() {
        await (0, kysely_1.sql) `
      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        block_number NUMERIC(78,0) NOT NULL,
        block_hash VARCHAR(66) NOT NULL,
        synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_name ON sync_checkpoints(name);
      CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_block_number ON sync_checkpoints(block_number);
    `.execute(this.db);
    }
    /**
     * Save or update a checkpoint
     */
    async saveCheckpoint(checkpoint) {
        const now = new Date();
        await this.db
            .insertInto('sync_checkpoints')
            .values({
            name: checkpoint.name,
            block_number: checkpoint.block_number,
            block_hash: checkpoint.block_hash,
            synced_at: now,
            metadata: checkpoint.metadata ?? null,
            created_at: now,
            updated_at: now,
        })
            .onConflict((oc) => oc
            .column('name')
            .doUpdateSet({
            block_number: checkpoint.block_number,
            block_hash: checkpoint.block_hash,
            synced_at: now,
            metadata: checkpoint.metadata ?? null,
            updated_at: now,
        }))
            .execute();
    }
    /**
     * Get a checkpoint by name
     */
    async getCheckpoint(name) {
        const result = await this.db
            .selectFrom('sync_checkpoints')
            .selectAll()
            .where('name', '=', name)
            .executeTakeFirst();
        if (!result) {
            return null;
        }
        return {
            id: result.id,
            name: result.name,
            block_number: BigInt(result.block_number),
            block_hash: result.block_hash,
            synced_at: result.synced_at,
            metadata: result.metadata ? JSON.parse(String(result.metadata)) : undefined,
        };
    }
    /**
     * Get the latest checkpoint (highest block number)
     */
    async getLatestCheckpoint() {
        const result = await this.db
            .selectFrom('sync_checkpoints')
            .selectAll()
            .orderBy('block_number', 'desc')
            .limit(1)
            .executeTakeFirst();
        if (!result) {
            return null;
        }
        return {
            id: result.id,
            name: result.name,
            block_number: BigInt(result.block_number),
            block_hash: result.block_hash,
            synced_at: result.synced_at,
            metadata: result.metadata ? JSON.parse(String(result.metadata)) : undefined,
        };
    }
    /**
     * Delete a checkpoint
     */
    async deleteCheckpoint(name) {
        await this.db
            .deleteFrom('sync_checkpoints')
            .where('name', '=', name)
            .execute();
    }
    /**
     * List all checkpoints
     */
    async listCheckpoints() {
        const results = await this.db
            .selectFrom('sync_checkpoints')
            .selectAll()
            .orderBy('block_number', 'desc')
            .execute();
        return results.map(r => ({
            id: r.id,
            name: r.name,
            block_number: BigInt(r.block_number),
            block_hash: r.block_hash,
            synced_at: r.synced_at,
            metadata: r.metadata ? JSON.parse(String(r.metadata)) : undefined,
        }));
    }
    /**
     * Clean up old checkpoints (keep only the latest N)
     */
    async cleanupOldCheckpoints(keepLatest = 10) {
        const checkpoints = await this.listCheckpoints();
        if (checkpoints.length <= keepLatest) {
            return 0;
        }
        const toDelete = checkpoints.slice(keepLatest);
        for (const checkpoint of toDelete) {
            if (checkpoint.name) {
                await this.deleteCheckpoint(checkpoint.name);
            }
        }
        return toDelete.length;
    }
}
exports.CheckpointRepository = CheckpointRepository;
