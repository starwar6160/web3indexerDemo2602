import { getDb } from './database-config';
import { sql, type Transaction } from 'kysely';
import type { TransferDTO } from '../schemas/transfer.schema';
import type { Database } from './database-types';

/**
 * Transfer event data structure (ERC20 Transfer)
 * Phase 3: Event parsing - atomic block+event sync
 */
export interface Transfer {
  id?: number;
  block_number: bigint;
  transaction_hash: string;
  log_index: number;
  from_address: string;
  to_address: string;
  amount: string; // DECIMAL(78,18) as string for uint256
  token_address: string; // ERC20 token contract
  created_at?: Date;
}

/**
 * Repository for Transfer events with atomic writes and cascade delete
 * 
 * CRITICAL: All operations must be within same transaction as block writes
 * to ensure atomicity during reorgs.
 */
export class TransfersRepository {
  private db = getDb();

  /**
   * Initialize transfers table with foreign key to blocks
   */
  async initialize(): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS transfers (
        id SERIAL PRIMARY KEY,
        block_number BIGINT NOT NULL,
        transaction_hash VARCHAR(66) NOT NULL,
        log_index INTEGER NOT NULL,
        from_address VARCHAR(42) NOT NULL,
        to_address VARCHAR(42) NOT NULL,
        amount DECIMAL(78,18) NOT NULL,
        token_address VARCHAR(42) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        
        -- Composite unique constraint for idempotency
        UNIQUE(block_number, log_index),
        
        -- Foreign key to blocks table (enables cascade delete)
        CONSTRAINT fk_block 
          FOREIGN KEY (block_number) 
          REFERENCES blocks(number) 
          ON DELETE CASCADE
      );

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_transfers_block_number 
        ON transfers(block_number);
      CREATE INDEX IF NOT EXISTS idx_transfers_tx_hash 
        ON transfers(transaction_hash);
      CREATE INDEX IF NOT EXISTS idx_transfers_from 
        ON transfers(from_address);
      CREATE INDEX IF NOT EXISTS idx_transfers_to 
        ON transfers(to_address);
      CREATE INDEX IF NOT EXISTS idx_transfers_contract 
        ON transfers(token_address);
        
      -- Composite index for common queries
      CREATE INDEX IF NOT EXISTS idx_transfers_block_contract 
        ON transfers(block_number, token_address);
    `.execute(this.db);
  }

  /**
   * Save transfers within a transaction (atomic with block write)
   * CRITICAL: Must be called within same trx as blockRepository.saveWithTrx
   *
   * Zod Validated: Accepts only TransferDTO from Zod schema validation
   */
  async saveWithTrx(
    trx: Transaction<Database>,
    transfers: TransferDTO[]
  ): Promise<number> {
    if (transfers.length === 0) return 0;

    await trx
      .insertInto('transfers')
      .values(
        transfers.map((t) => ({
          block_number: t.block_number,
          transaction_hash: t.transaction_hash,
          log_index: t.log_index,
          from_address: t.from_address,
          to_address: t.to_address,
          amount: t.amount,
          token_address: t.token_address,
        }))
      )
      .execute();

    return transfers.length;
  }

  /**
   * Delete transfers for blocks after a specific number (for reorg)
   * CASCADE DELETE handles this automatically via FK, but explicit method
   * provided for cases where FK might not be available.
   */
  async deleteAfter(blockNumber: bigint): Promise<number> {
    const result = await this.db
      .deleteFrom('transfers')
      .where('block_number', '>', blockNumber)
      .execute();

    return result.length;
  }

  /**
   * Get transfers by block number
   */
  async getByBlockNumber(blockNumber: bigint): Promise<Transfer[]> {
    const results = await this.db
      .selectFrom('transfers')
      .selectAll()
      .where('block_number', '=', blockNumber)
      .orderBy('log_index', 'asc')
      .execute();

    return results.map((r) => ({
      id: r.id,
      block_number: BigInt(r.block_number),
      transaction_hash: r.transaction_hash,
      log_index: r.log_index,
      from_address: r.from_address,
      to_address: r.to_address,
      amount: r.amount,
      token_address: r.token_address,
      created_at: r.created_at,
    }));
  }

  /**
   * Get transfers by token address
   */
  async getByContract(
    tokenAddress: string,
    limit: number = 100
  ): Promise<Transfer[]> {
    const results = await this.db
      .selectFrom('transfers')
      .selectAll()
      .where('token_address', '=', tokenAddress)
      .orderBy('block_number', 'desc')
      .limit(limit)
      .execute();

    return results.map((r) => ({
      id: r.id,
      block_number: BigInt(r.block_number),
      transaction_hash: r.transaction_hash,
      log_index: r.log_index,
      from_address: r.from_address,
      to_address: r.to_address,
      amount: r.amount,
      token_address: r.token_address,
      created_at: r.created_at,
    }));
  }

  /**
   * Count transfers for a specific block
   */
  async countByBlock(blockNumber: bigint): Promise<number> {
    const result = await this.db
      .selectFrom('transfers')
      .select(sql<number>`count(*)`.as('count'))
      .where('block_number', '=', blockNumber)
      .executeTakeFirst();

    return result?.count ?? 0;
  }
}
