"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStatusRepository = void 0;
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
/**
 * Repository for sync status with progress tracking
 * Phase 3: Detailed sync progress monitoring
 * Phase 4: Engineering optimization (resumable sync, error tracking)
 */
class SyncStatusRepository {
    constructor() {
        this.db = (0, database_config_1.getDb)();
    }
    /**
     * Initialize sync_status table if it doesn't exist
     */
    async initialize() {
        await (0, kysely_1.sql) `
      CREATE TABLE IF NOT EXISTS sync_status (
        id SERIAL PRIMARY KEY,
        processor_name VARCHAR(255) NOT NULL UNIQUE,
        last_processed_block BIGINT NOT NULL,
        last_processed_hash VARCHAR(66),
        target_block BIGINT,
        synced_percent DECIMAL(5,2), -- 0.00 - 100.00
        status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, paused, error, complete
        error_message TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_sync_status_processor 
      ON sync_status(processor_name);
      CREATE INDEX IF NOT EXISTS idx_sync_status_status 
      ON sync_status(status);
    `.execute(this.db);
    }
    /**
     * Update or create sync status
     */
    async updateStatus(status) {
        const now = new Date().toISOString();
        await this.db
            .insertInto('sync_status')
            .values({
            processor_name: status.processor_name,
            last_processed_block: status.last_processed_block,
            last_processed_hash: status.last_processed_hash,
            target_block: status.target_block,
            synced_percent: status.synced_percent,
            status: status.status,
            error_message: status.error_message,
            updated_at: now,
        })
            .onConflict((oc) => oc.column('processor_name').doUpdateSet({
            last_processed_block: status.last_processed_block,
            last_processed_hash: status.last_processed_hash,
            target_block: status.target_block,
            synced_percent: status.synced_percent,
            status: status.status,
            error_message: status.error_message,
            updated_at: now,
        }))
            .execute();
    }
    /**
     * Get sync status by processor name
     */
    async getStatus(processorName) {
        const result = await this.db
            .selectFrom('sync_status')
            .selectAll()
            .where('processor_name', '=', processorName)
            .executeTakeFirst();
        if (!result)
            return null;
        return {
            id: result.id,
            processor_name: result.processor_name,
            last_processed_block: BigInt(result.last_processed_block),
            last_processed_hash: result.last_processed_hash,
            target_block: result.target_block ? BigInt(result.target_block) : null,
            synced_percent: result.synced_percent,
            status: result.status,
            error_message: result.error_message,
            updated_at: result.updated_at,
        };
    }
    /**
     * Update progress with percentage calculation
     */
    async updateProgress(processorName, lastBlock, targetBlock, lastHash) {
        let syncedPercent = null;
        if (targetBlock && targetBlock > 0n) {
            const percent = (Number(lastBlock) / Number(targetBlock)) * 100;
            syncedPercent = percent.toFixed(2);
        }
        await this.updateStatus({
            processor_name: processorName,
            last_processed_block: lastBlock,
            last_processed_hash: lastHash ?? null,
            target_block: targetBlock,
            synced_percent: syncedPercent,
            status: 'active',
            error_message: null,
        });
    }
    /**
     * Mark processor as error state
     */
    async markError(processorName, errorMessage) {
        const existing = await this.getStatus(processorName);
        await this.updateStatus({
            processor_name: processorName,
            last_processed_block: existing?.last_processed_block ?? 0n,
            last_processed_hash: existing?.last_processed_hash ?? null,
            target_block: existing?.target_block ?? null,
            synced_percent: existing?.synced_percent ?? null,
            status: 'error',
            error_message: errorMessage,
        });
    }
    /**
     * Mark processor as complete
     */
    async markComplete(processorName) {
        const existing = await this.getStatus(processorName);
        await this.updateStatus({
            processor_name: processorName,
            last_processed_block: existing?.last_processed_block ?? 0n,
            last_processed_hash: existing?.last_processed_hash ?? null,
            target_block: existing?.target_block ?? null,
            synced_percent: '100.00',
            status: 'complete',
            error_message: null,
        });
    }
    /**
     * List all active processors
     */
    async listActive() {
        const results = await this.db
            .selectFrom('sync_status')
            .selectAll()
            .where('status', 'in', ['active', 'error'])
            .orderBy('updated_at', 'desc')
            .execute();
        return results.map((r) => ({
            id: r.id,
            processor_name: r.processor_name,
            last_processed_block: BigInt(r.last_processed_block),
            last_processed_hash: r.last_processed_hash,
            target_block: r.target_block ? BigInt(r.target_block) : null,
            synced_percent: r.synced_percent,
            status: r.status,
            error_message: r.error_message,
            updated_at: r.updated_at,
        }));
    }
    /**
     * Get sync statistics
     */
    async getStats() {
        const results = await this.db
            .selectFrom('sync_status')
            .select(['status', (0, kysely_1.sql) `count(*)`.as('count')])
            .groupBy('status')
            .execute();
        const stats = {
            total: 0,
            active: 0,
            paused: 0,
            error: 0,
            complete: 0,
        };
        for (const row of results) {
            const count = row.count ?? 0;
            stats.total += count;
            if (row.status === 'active')
                stats.active = count;
            if (row.status === 'paused')
                stats.paused = count;
            if (row.status === 'error')
                stats.error = count;
            if (row.status === 'complete')
                stats.complete = count;
        }
        return stats;
    }
}
exports.SyncStatusRepository = SyncStatusRepository;
