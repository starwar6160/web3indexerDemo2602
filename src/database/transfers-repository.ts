import { getDb } from './database-config';
import { sql } from 'kysely';

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
  contract_address: string; // ERC20 token contract
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
        contract_address VARCHAR(42) NOT NULL,
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
        ON transfers(contract_address);
        
      -- Composite index for common queries
      CREATE INDEX IF NOT EXISTS idx_transfers_block_contract 
        ON transfers(block_number, contract_address);
    `.execute(this.db);
  }

  /**
   * Save transfers within a transaction (atomic with block write)
   * CRITICAL: Must be called within same trx as blockRepository.saveWithTrx
   */
  async saveWithTrx(
    trx: any,
    transfers: Omit<Transfer, 'id' | 'created_at'>[]
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
          contract_address: t.contract_address,
        }))
      )
      .onConflict((oc: any) =>
        oc.columns(['block_number', 'log_index']).doUpdateSet({
          transaction_hash: (trx: any) => trx.ref('excluded.transaction_hash'),
          from_address: (trx: any) => trx.ref('excluded.from_address'),
          to_address: (trx: any) => trx.ref('excluded.to_address'),
          amount: (trx: any) => trx.ref('excluded.amount'),
          contract_address: (trx: any) => trx.ref('excluded.contract_address'),
        })
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
      contract_address: r.contract_address,
      created_at: r.created_at,
    }));
  }

  /**
   * Get transfers by contract address
   */
  async getByContract(
    contractAddress: string,
    limit: number = 100
  ): Promise<Transfer[]> {
    const results = await this.db
      .selectFrom('transfers')
      .selectAll()
      .where('contract_address', '=', contractAddress)
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
      contract_address: r.contract_address,
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
