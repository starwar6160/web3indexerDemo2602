import { getDb } from './database-config';
import { sql } from 'kysely';

/**
 * Sync status data structure for detailed progress tracking
 * Phase 3: Event parsing core logic
 * Phase 4: Engineering optimization (status tracking, progress monitoring)
 */
export interface SyncStatus {
  id?: number;
  processor_name: string;
  last_processed_block: bigint;
  last_processed_hash: string | null;
  target_block: bigint | null;
  synced_percent: string | null; // DECIMAL(5,2) as string: 0.00 - 100.00
  status: 'active' | 'paused' | 'error' | 'complete';
  error_message: string | null;
  updated_at?: Date;
}

/**
 * Repository for sync status with progress tracking
 * Phase 3: Detailed sync progress monitoring
 * Phase 4: Engineering optimization (resumable sync, error tracking)
 */
export class SyncStatusRepository {
  private db = getDb();

  /**
   * Initialize sync_status table if it doesn't exist
   */
  async initialize(): Promise<void> {
    await sql`
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
  async updateStatus(status: Omit<SyncStatus, 'id' | 'updated_at'>): Promise<void> {
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
      .onConflict((oc) =>
        oc.column('processor_name').doUpdateSet({
          last_processed_block: status.last_processed_block,
          last_processed_hash: status.last_processed_hash,
          target_block: status.target_block,
          synced_percent: status.synced_percent,
          status: status.status,
          error_message: status.error_message,
          updated_at: now,
        })
      )
      .execute();
  }

  /**
   * Get sync status by processor name
   */
  async getStatus(processorName: string): Promise<SyncStatus | null> {
    const result = await this.db
      .selectFrom('sync_status')
      .selectAll()
      .where('processor_name', '=', processorName)
      .executeTakeFirst();

    if (!result) return null;

    return {
      id: result.id,
      processor_name: result.processor_name,
      last_processed_block: BigInt(result.last_processed_block),
      last_processed_hash: result.last_processed_hash,
      target_block: result.target_block ? BigInt(result.target_block) : null,
      synced_percent: result.synced_percent,
      status: result.status as SyncStatus['status'],
      error_message: result.error_message,
      updated_at: result.updated_at,
    };
  }

  /**
   * Update progress with percentage calculation
   */
  async updateProgress(
    processorName: string,
    lastBlock: bigint,
    targetBlock: bigint | null,
    lastHash?: string
  ): Promise<void> {
    let syncedPercent: string | null = null;

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
  async markError(processorName: string, errorMessage: string): Promise<void> {
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
  async markComplete(processorName: string): Promise<void> {
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
  async listActive(): Promise<SyncStatus[]> {
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
      status: r.status as SyncStatus['status'],
      error_message: r.error_message,
      updated_at: r.updated_at,
    }));
  }

  /**
   * Get sync statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    paused: number;
    error: number;
    complete: number;
  }> {
    const results = await this.db
      .selectFrom('sync_status')
      .select(['status', sql<number>`count(*)`.as('count')])
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
      if (row.status === 'active') stats.active = count;
      if (row.status === 'paused') stats.paused = count;
      if (row.status === 'error') stats.error = count;
      if (row.status === 'complete') stats.complete = count;
    }

    return stats;
  }
}
