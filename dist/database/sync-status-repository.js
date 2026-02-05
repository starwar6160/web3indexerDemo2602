"use strict";
/**
 * Sync Status Repository - Manages checkpoint and gap tracking
 *
 * This repository implements the critical fixes for:
 * 1. Permanent block gaps (through checkpoint system)
 * 2. Gap detection and repair
 * 3. Confirmation depth tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStatusRepository = void 0;
const database_config_1 = require("./database-config");
const kysely_1 = require("kysely");
class SyncStatusRepository {
    constructor() {
        this.db = (0, database_config_1.getDb)();
    }
    /**
     * Get sync status for a chain
     */
    async getSyncStatus(chainId = 1n) {
        const result = await this.db
            .selectFrom('sync_status')
            .selectAll()
            .where('chain_id', '=', chainId)
            .executeTakeFirst();
        return result || null;
    }
    /**
     * Initialize sync status for a chain
     */
    async initializeSyncStatus(chainId = 1n) {
        await this.db
            .insertInto('sync_status')
            .values({
            chain_id: chainId,
            next_block: 0n,
            confirmed_block: 0n,
            head_block: 0n,
        })
            .onConflict((oc) => oc.doNothing())
            .execute();
    }
    /**
     * Advance next_block checkpoint (strict sequential write)
     *
     * Only advances if fromBlock matches current next_block (CAS operation)
     * This ensures no gaps are skipped
     */
    async advanceNextBlock(chainId, fromBlock, toBlock) {
        const result = await this.db
            .updateTable('sync_status')
            .set({
            next_block: toBlock + 1n,
            updated_at: new Date(),
        })
            .where('chain_id', '=', chainId)
            .where('next_block', '=', fromBlock) // CAS: ensure sequential
            .executeTakeFirst();
        const numUpdatedRows = result.numUpdatedRows;
        return numUpdatedRows > 0;
    }
    /**
     * Update confirmed and head blocks
     */
    async updateChainTip(chainId, confirmedBlock, headBlock) {
        await this.db
            .updateTable('sync_status')
            .set({
            confirmed_block: confirmedBlock,
            head_block: headBlock,
            updated_at: new Date(),
        })
            .where('chain_id', '=', chainId)
            .execute();
    }
    /**
     * Detect gaps in block sequence using SQL window function
     */
    async detectGaps(chainId = 1n) {
        const result = await this.db
            .selectFrom('blocks')
            .select((0, kysely_1.sql) `number + 1`.as('gap_start'))
            .select((0, kysely_1.sql) `
        (SELECT MIN(b2.number) - 1
         FROM blocks b2
         WHERE b2.number > blocks.number
           AND b2.chain_id = ${chainId})
      `.as('gap_end'))
            .where('chain_id', '=', chainId)
            .where((0, kysely_1.sql) `
        NOT EXISTS (
          SELECT 1 FROM blocks b2
          WHERE b2.number = blocks.number + 1
            AND b2.chain_id = ${chainId}
        )
        AND number < (SELECT MAX(number) FROM blocks WHERE chain_id = ${chainId})
      `.as('exists'))
            .execute();
        const gaps = result
            .filter((row) => row.gap_end !== null)
            .map((row) => ({
            chain_id: chainId,
            gap_start: BigInt(row.gap_start),
            gap_end: BigInt(row.gap_end),
            detected_at: new Date(),
            retry_count: 0,
            status: 'pending',
        }));
        return gaps;
    }
    /**
     * Report a gap (will be inserted if not exists)
     */
    async reportGap(chainId, gapStart, gapEnd) {
        await this.db
            .insertInto('sync_gaps')
            .values({
            chain_id: chainId,
            gap_start: gapStart,
            gap_end: gapEnd,
        })
            .onConflict((oc) => oc.doNothing())
            .execute();
    }
    /**
     * Get pending gaps for retry
     */
    async getPendingGaps(chainId = 1n, limit = 10) {
        const gaps = await this.db
            .selectFrom('sync_gaps')
            .selectAll()
            .where('chain_id', '=', chainId)
            .where('status', '=', 'pending')
            .orderBy('detected_at', 'asc')
            .limit(limit)
            .execute();
        return gaps.map((gap) => ({
            ...gap,
            chain_id: BigInt(gap.chain_id),
            gap_start: BigInt(gap.gap_start),
            gap_end: BigInt(gap.gap_end),
        }));
    }
    /**
     * Mark gap as retrying
     */
    async markGapRetrying(gapId) {
        await this.db
            .updateTable('sync_gaps')
            .set({
            status: 'retrying',
            retry_count: (0, kysely_1.sql) `retry_count + 1`,
            last_retry_at: new Date(),
        })
            .where('id', '=', gapId)
            .execute();
    }
    /**
     * Mark gap as filled
     */
    async markGapFilled(gapId) {
        await this.db
            .updateTable('sync_gaps')
            .set({
            status: 'filled',
        })
            .where('id', '=', gapId)
            .execute();
    }
    /**
     * Update gap error
     */
    async updateGapError(gapId, errorMessage) {
        await this.db
            .updateTable('sync_gaps')
            .set({
            status: 'pending', // Back to pending for retry
            error_message: errorMessage,
        })
            .where('id', '=', gapId)
            .execute();
    }
    /**
     * Delete filled gaps older than specified days
     */
    async cleanupFilledGaps(daysToKeep = 7) {
        const result = await this.db
            .deleteFrom('sync_gaps')
            .where('status', '=', 'filled')
            .where('detected_at', '<', (0, kysely_1.sql) `now() - interval '${daysToKeep} days'`)
            .execute();
        return result.length;
    }
    /**
     * Get sync statistics
     */
    async getSyncStats(chainId = 1n) {
        const status = await this.getSyncStatus(chainId);
        if (!status) {
            throw new Error(`Sync status not found for chain ${chainId}`);
        }
        const pendingGapsResult = await this.db
            .selectFrom('sync_gaps')
            .select((0, kysely_1.sql) `count(*)`.as('count'))
            .where('chain_id', '=', chainId)
            .where('status', 'in', ['pending', 'retrying'])
            .executeTakeFirst();
        const totalBlocksResult = await this.db
            .selectFrom('blocks')
            .select((0, kysely_1.sql) `count(*)`.as('count'))
            .where('chain_id', '=', chainId)
            .executeTakeFirst();
        return {
            nextBlock: status.next_block,
            confirmedBlock: status.confirmed_block,
            headBlock: status.head_block,
            pendingGaps: Number(pendingGapsResult?.count || 0),
            totalBlocks: Number(totalBlocksResult?.count || 0),
        };
    }
}
exports.SyncStatusRepository = SyncStatusRepository;
