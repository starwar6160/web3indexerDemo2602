import { getDb } from './database-config';
import { sql } from 'kysely';

/**
 * Checkpoint data structure
 */
export interface Checkpoint {
  id?: number;
  name: string;
  block_number: bigint;
  block_hash: string;
  synced_at: string;
  metadata?: Record<string, any>;
}

/**
 * Repository for managing sync checkpoints
 *
 * Provides crash recovery and resume capability for the indexer
 */
export class CheckpointRepository {
  private db = getDb();

  /**
   * Initialize checkpoint table if it doesn't exist
   */
  async initialize(): Promise<void> {
    await sql`
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
   *
   * PRODUCTION MODE: Uses "update-or-insert" pattern to avoid Kysely onConflict bug
   * This approach is 100% reliable and avoids the "non-string identifier" compilation error
   */
  async saveCheckpoint(checkpoint: Omit<Checkpoint, 'id' | 'synced_at'>): Promise<void> {
    const now = new Date().toISOString();

    // Step 1: Try to update existing record
    const updateResult = await this.db
      .updateTable('sync_checkpoints')
      .set({
        block_number: checkpoint.block_number,
        block_hash: checkpoint.block_hash,
        synced_at: now,
        metadata: checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null,
        updated_at: now
      })
      .where('name', '=', checkpoint.name)
      .executeTakeFirst();

    // Step 2: If no rows were updated, insert new record
    if (Number(updateResult.numUpdatedRows) === 0) {
      await this.db
        .insertInto('sync_checkpoints')
        .values({
          name: checkpoint.name,
          block_number: checkpoint.block_number,
          block_hash: checkpoint.block_hash,
          synced_at: now,
          metadata: checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null,
          created_at: now,
          updated_at: now
        })
        .execute();
    }
  }

  /**
   * Get a checkpoint by name
   */
  async getCheckpoint(name: string): Promise<Checkpoint | null> {
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
      synced_at: result.synced_at instanceof Date ? result.synced_at.toISOString() : result.synced_at,
      metadata: result.metadata ? JSON.parse(String(result.metadata)) : undefined,
    };
  }

  /**
   * Get the latest checkpoint (highest block number)
   */
  async getLatestCheckpoint(): Promise<Checkpoint | null> {
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
      synced_at: result.synced_at instanceof Date ? result.synced_at.toISOString() : result.synced_at,
      metadata: result.metadata ? JSON.parse(String(result.metadata)) : undefined,
    };
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(name: string): Promise<void> {
    await this.db
      .deleteFrom('sync_checkpoints')
      .where('name', '=', name)
      .execute();
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    const results = await this.db
      .selectFrom('sync_checkpoints')
      .selectAll()
      .orderBy('block_number', 'desc')
      .execute();

    return results.map(r => {
      // Handle metadata that may be already an object or a JSON string
      let parsedMetadata: Record<string, unknown> | undefined;
      if (r.metadata) {
        if (typeof r.metadata === 'string') {
          try {
            parsedMetadata = JSON.parse(r.metadata) as Record<string, unknown>;
          } catch {
            parsedMetadata = undefined;
          }
        } else if (typeof r.metadata === 'object') {
          parsedMetadata = r.metadata as Record<string, unknown>;
        }
      }

      return {
        id: r.id,
        name: r.name,
        block_number: BigInt(r.block_number),
        block_hash: r.block_hash,
        synced_at: r.synced_at instanceof Date ? r.synced_at.toISOString() : r.synced_at,
        metadata: parsedMetadata,
      };
    });
  }

  /**
   * Clean up old checkpoints (keep only the latest N)
   */
  async cleanupOldCheckpoints(keepLatest: number = 10): Promise<number> {
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
