import { getDb } from './database-config';
import { sql, type Transaction } from 'kysely';
import type { Database } from './database-types';

/**
 * Transaction log data structure
 */
export interface TransactionLog {
  log_index: number;
  transaction_hash: string;
  block_number: bigint;
  address: string;
  topics: string[];
  data: string;
}

/**
 * Repository for transaction logs with atomic write guarantees
 *
 * P3 Fix: Ensures logs are written atomically with blocks
 */
export class LogRepository {
  private db = getDb();

  /**
   * Initialize logs table if it doesn't exist
   */
  async initialize(): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS transaction_logs (
        id SERIAL PRIMARY KEY,
        log_index INTEGER NOT NULL,
        transaction_hash VARCHAR(66) NOT NULL,
        block_number NUMERIC(78,0) NOT NULL,
        address VARCHAR(42) NOT NULL,
        topics TEXT[] NOT NULL,
        data TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

        UNIQUE(block_number, log_index)
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_logs_block_number ON transaction_logs(block_number);
      CREATE INDEX IF NOT EXISTS idx_transaction_logs_tx_hash ON transaction_logs(transaction_hash);
      CREATE INDEX IF NOT EXISTS idx_transaction_logs_address ON transaction_logs(address);

      COMMENT ON TABLE transaction_logs IS 'Transaction logs with atomic writes to blocks';
      COMMENT ON COLUMN transaction_logs.topics IS 'Array of topic signatures (max 4)';
      COMMENT ON COLUMN transaction_logs.data IS 'Hex-encoded log data';
    `.execute(this.db);
  }

  /**
   * Save logs within a transaction
   *
   * CRITICAL: This must be called within the same transaction as block write
   */
  async saveManyWithTrx(trx: Transaction<Database>, logs: TransactionLog[]): Promise<void> {
    if (logs.length === 0) return;

    const now = new Date().toISOString();

    await trx
      .insertInto('transaction_logs')
      .values(
        logs.map(log => ({
          log_index: log.log_index,
          transaction_hash: log.transaction_hash,
          block_number: log.block_number.toString(),
          address: log.address,
          topics: log.topics,
          data: log.data,
          created_at: now,
        }))
      )
      .onConflict((oc) =>
        oc
          .columns(['block_number', 'log_index'])
          .doNothing()
      )
      .execute();
  }

  /**
   * Get logs by block number
   */
  async getByBlockNumber(blockNumber: bigint): Promise<TransactionLog[]> {
    const result = await this.db
      .selectFrom('transaction_logs')
      .selectAll()
      .where('block_number', '=', blockNumber.toString())
      .orderBy('log_index', 'asc')
      .execute();

    return result.map((row) => ({
      log_index: row.log_index,
      transaction_hash: row.transaction_hash,
      block_number: BigInt(row.block_number),
      address: row.address,
      topics: row.topics as string[],
      data: row.data,
    }));
  }

  /**
   * Check if logs exist for a block
   */
  async hasLogsForBlock(blockNumber: bigint): Promise<boolean> {
    const result = await this.db
      .selectFrom('transaction_logs')
      .select('block_number')
      .where('block_number', '=', blockNumber.toString())
      .limit(1)
      .executeTakeFirst();

    return !!result;
  }

  /**
   * Delete logs for blocks after a specific number (for reorg)
   */
  async deleteAfter(blockNumber: bigint): Promise<number> {
    const result = await this.db
      .deleteFrom('transaction_logs')
      .where('block_number', '>', blockNumber.toString())
      .execute();

    return result.length;
  }

  /**
   * Get log statistics
   */
  async getStats(): Promise<{
    totalLogs: number;
    blocksWithLogs: number;
    avgLogsPerBlock: number;
  }> {
    const totalLogsResult = await this.db
      .selectFrom('transaction_logs')
      .select(sql<number>`count(*)`.as('count'))
      .executeTakeFirst();

    const blocksWithLogsResult = await this.db
      .selectFrom('transaction_logs')
      .select(sql<number>`count(DISTINCT block_number)`.as('count'))
      .executeTakeFirst();

    const totalLogs = totalLogsResult?.count ?? 0;
    const blocksWithLogs = blocksWithLogsResult?.count ?? 0;
    const avgLogsPerBlock = blocksWithLogs > 0 ? totalLogs / blocksWithLogs : 0;

    return {
      totalLogs,
      blocksWithLogs,
      avgLogsPerBlock: Math.round(avgLogsPerBlock * 100) / 100,
    };
  }
}
