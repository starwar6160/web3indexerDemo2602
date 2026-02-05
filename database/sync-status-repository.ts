/**
 * Sync Status Repository - Manages checkpoint and gap tracking
 *
 * This repository implements the critical fixes for:
 * 1. Permanent block gaps (through checkpoint system)
 * 2. Gap detection and repair
 * 3. Confirmation depth tracking
 */

import { getDb } from './database-config';
import { sql } from 'kysely';

export interface SyncStatus {
  chain_id: bigint;
  next_block: bigint;
  confirmed_block: bigint;
  head_block: bigint;
  updated_at: Date;
}

export interface Gap {
  id?: number;
  chain_id: bigint;
  gap_start: bigint;
  gap_end: bigint;
  detected_at: Date;
  retry_count: number;
  status: 'pending' | 'retrying' | 'filled';
  last_retry_at?: Date;
  error_message?: string;
}

export class SyncStatusRepository {
  private db = getDb();

  /**
   * Get sync status for a chain
   */
  async getSyncStatus(chainId: bigint = 1n): Promise<SyncStatus | null> {
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
  async initializeSyncStatus(chainId: bigint = 1n): Promise<void> {
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
  async advanceNextBlock(
    chainId: bigint,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<boolean> {
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
  async updateChainTip(
    chainId: bigint,
    confirmedBlock: bigint,
    headBlock: bigint
  ): Promise<void> {
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
  async detectGaps(chainId: bigint = 1n): Promise<Gap[]> {
    const result = await this.db
      .selectFrom('blocks')
      .select(sql<number>`number + 1`.as('gap_start'))
      .select(sql`
        (SELECT MIN(b2.number) - 1
         FROM blocks b2
         WHERE b2.number > blocks.number
           AND b2.chain_id = ${chainId})
      `.as('gap_end'))
      .where('chain_id', '=', chainId)
      .where(sql`
        NOT EXISTS (
          SELECT 1 FROM blocks b2
          WHERE b2.number = blocks.number + 1
            AND b2.chain_id = ${chainId}
        )
        AND number < (SELECT MAX(number) FROM blocks WHERE chain_id = ${chainId})
      `.as('exists'))
      .execute();

    const gaps: Gap[] = result
      .filter((row) => row.gap_end !== null)
      .map((row) => ({
        chain_id: chainId,
        gap_start: BigInt(row.gap_start),
        gap_end: BigInt(row.gap_end!),
        detected_at: new Date(),
        retry_count: 0,
        status: 'pending' as const,
      }));

    return gaps;
  }

  /**
   * Report a gap (will be inserted if not exists)
   */
  async reportGap(
    chainId: bigint,
    gapStart: bigint,
    gapEnd: bigint
  ): Promise<void> {
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
  async getPendingGaps(chainId: bigint = 1n, limit: number = 10): Promise<Gap[]> {
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
  async markGapRetrying(gapId: number): Promise<void> {
    await this.db
      .updateTable('sync_gaps')
      .set({
        status: 'retrying',
        retry_count: sql`retry_count + 1`,
        last_retry_at: new Date(),
      })
      .where('id', '=', gapId)
      .execute();
  }

  /**
   * Mark gap as filled
   */
  async markGapFilled(gapId: number): Promise<void> {
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
  async updateGapError(gapId: number, errorMessage: string): Promise<void> {
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
  async cleanupFilledGaps(daysToKeep: number = 7): Promise<number> {
    const result = await this.db
      .deleteFrom('sync_gaps')
      .where('status', '=', 'filled')
      .where('detected_at', '<', sql`now() - interval '${daysToKeep} days'`)
      .execute();

    return result.length;
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(chainId: bigint = 1n): Promise<{
    nextBlock: bigint;
    confirmedBlock: bigint;
    headBlock: bigint;
    pendingGaps: number;
    totalBlocks: number;
  }> {
    const status = await this.getSyncStatus(chainId);

    if (!status) {
      throw new Error(`Sync status not found for chain ${chainId}`);
    }

    const pendingGapsResult = await this.db
      .selectFrom('sync_gaps')
      .select(sql`count(*)`.as('count'))
      .where('chain_id', '=', chainId)
      .where('status', 'in', ['pending', 'retrying'])
      .executeTakeFirst();

    const totalBlocksResult = await this.db
      .selectFrom('blocks')
      .select(sql`count(*)`.as('count'))
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
