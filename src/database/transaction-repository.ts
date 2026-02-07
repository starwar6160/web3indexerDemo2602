import { getDb } from './database-config';
import { sql, type Transaction as KyselyTransaction } from 'kysely';
import type { Database } from './database-types';

/**
 * Transaction data structure for decoded events
 * Phase 3: Event parsing core logic
 */
export interface BlockchainTransaction {
  id?: number;
  tx_hash: string;
  block_number: bigint;
  from_address: string;
  to_address: string | null;
  value: string | null; // DECIMAL(78,18) as string
  gas_price: string | null;
  gas_used: bigint | null;
  status: number | null; // 1 = success, 0 = failed
  created_at?: Date;
}

/**
 * Repository for transaction data with idempotent writes
 * Phase 3: Event parsing core logic
 * Phase 4: Engineering optimization (idempotency, DECIMAL types)
 */
export class TransactionRepository {
  private db = getDb();

  /**
   * Initialize transactions table if it doesn't exist
   */
  async initialize(): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        tx_hash VARCHAR(66) NOT NULL UNIQUE,
        block_number BIGINT NOT NULL,
        from_address VARCHAR(42) NOT NULL,
        to_address VARCHAR(42),
        value DECIMAL(78,18),
        gas_price DECIMAL(78,18),
        gas_used BIGINT,
        status INTEGER, -- 1 = success, 0 = failed
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      -- Phase 4: Composite unique index for idempotency
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_block_hash_unique 
      ON transactions(block_number, tx_hash);

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_transactions_block_number 
      ON transactions(block_number);
      CREATE INDEX IF NOT EXISTS idx_transactions_from_address 
      ON transactions(from_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_to_address 
      ON transactions(to_address);
    `.execute(this.db);
  }

  /**
   * Save transaction with idempotent upsert
   * Phase 4: Ensures duplicate events don't create duplicate records
   */
  async saveTransaction(tx: Omit<BlockchainTransaction, 'id' | 'created_at'>): Promise<void> {
    await this.db
      .insertInto('transactions')
      .values({
        tx_hash: tx.tx_hash,
        block_number: tx.block_number,
        from_address: tx.from_address,
        to_address: tx.to_address,
        value: tx.value,
        gas_price: tx.gas_price,
        gas_used: tx.gas_used,
        status: tx.status,
      })
      .onConflict((oc) =>
        oc
          .columns(['block_number', 'tx_hash'])
          .doUpdateSet({
            from_address: tx.from_address,
            to_address: tx.to_address,
            value: tx.value,
            gas_price: tx.gas_price,
            gas_used: tx.gas_used,
            status: tx.status,
          })
      )
      .execute();
  }

  /**
   * Save multiple transactions within a transaction
   */
  async saveManyWithTrx(trx: KyselyTransaction<Database>, txs: BlockchainTransaction[]): Promise<void> {
    if (txs.length === 0) return;

    await trx
      .insertInto('transactions')
      .values(
        txs.map((tx) => ({
          tx_hash: tx.tx_hash,
          block_number: tx.block_number,
          from_address: tx.from_address,
          to_address: tx.to_address,
          value: tx.value,
          gas_price: tx.gas_price,
          gas_used: tx.gas_used,
          status: tx.status,
        }))
      )
      .onConflict((oc) =>
        oc.columns(['block_number', 'tx_hash']).doNothing()
      )
      .execute();
  }

  /**
   * Get transaction by hash
   */
  async getByHash(txHash: string): Promise<BlockchainTransaction | null> {
    const result = await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('tx_hash', '=', txHash)
      .executeTakeFirst();

    if (!result) return null;

    return {
      id: result.id,
      tx_hash: result.tx_hash,
      block_number: BigInt(result.block_number),
      from_address: result.from_address,
      to_address: result.to_address,
      value: result.value,
      gas_price: result.gas_price,
      gas_used: result.gas_used ? BigInt(result.gas_used) : null,
      status: result.status,
      created_at: result.created_at,
    };
  }

  /**
   * Get transactions by block number
   */
  async getByBlockNumber(blockNumber: bigint): Promise<BlockchainTransaction[]> {
    const results = await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('block_number', '=', blockNumber)
      .orderBy('id', 'asc')
      .execute();

    return results.map((r) => ({
      id: r.id,
      tx_hash: r.tx_hash,
      block_number: BigInt(r.block_number),
      from_address: r.from_address,
      to_address: r.to_address,
      value: r.value,
      gas_price: r.gas_price,
      gas_used: r.gas_used ? BigInt(r.gas_used) : null,
      status: r.status,
      created_at: r.created_at,
    }));
  }

  /**
   * Get transaction count for address
   */
  async getCountForAddress(address: string): Promise<number> {
    const result = await this.db
      .selectFrom('transactions')
      .select(sql<number>`count(*)`.as('count'))
      .where((eb) =>
        eb.or([eb('from_address', '=', address), eb('to_address', '=', address)])
      )
      .executeTakeFirst();

    return result?.count ?? 0;
  }

  /**
   * Delete transactions for blocks after a specific number (for reorg)
   */
  async deleteAfter(blockNumber: bigint): Promise<number> {
    const result = await this.db
      .deleteFrom('transactions')
      .where('block_number', '>', blockNumber)
      .execute();

    return result.length;
  }
}
