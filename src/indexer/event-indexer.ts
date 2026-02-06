import { createPublicClient, http, decodeEventLog, type Address, type Log } from 'viem';
import { simpleBankAbi } from '../abis/simple-bank';
import { TransactionRepository, type Transaction } from '../database/transaction-repository';
import { SyncStatusRepository } from '../database/sync-status-repository';
import { strictValidateLogs, type ValidatedLog } from '../database/strict-schemas';
import logger from '../utils/logger';

/**
 * Event Indexer - Phase 3: Event parsing core logic
 * 
 * Fetches logs from RPC, decodes events, validates with Zod, saves to DB
 * 
 * SpaceX philosophy:
 * - getLogs error -> crash immediately
 * - decode error -> crash immediately  
 * - validation error -> crash immediately
 * - DB constraint violation -> crash immediately
 */
export class EventIndexer {
  private client: ReturnType<typeof createPublicClient>;
  private txRepo: TransactionRepository;
  private syncRepo: SyncStatusRepository;
  private contractAddress: Address;
  private readonly processorName = 'simplebank_event_indexer';

  constructor(
    rpcUrl: string,
    contractAddress: Address
  ) {
    this.client = createPublicClient({
      transport: http(rpcUrl),
    });
    this.txRepo = new TransactionRepository();
    this.syncRepo = new SyncStatusRepository();
    this.contractAddress = contractAddress;
  }

  /**
   * Index events from a block range
   * Fail-fast: any error throws immediately
   */
  async indexEvents(fromBlock: bigint, toBlock: bigint): Promise<number> {
    logger.info({
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      contract: this.contractAddress,
    }, 'Indexing events');

    // 1. Fetch logs from RPC - fail fast on error
    const logs = await this.fetchLogs(fromBlock, toBlock);
    if (logs.length === 0) {
      logger.info('No events found in range');
      return 0;
    }

    // 2. Validate raw logs with Zod - fail fast on invalid data
    const validatedLogs = strictValidateLogs(logs, 'event_indexer');

    // 3. Decode events - fail fast on decode error
    const decodedEvents = this.decodeEvents(validatedLogs);

    // 4. Transform to transactions
    const transactions = this.transformToTransactions(decodedEvents);

    // 5. Save to DB with idempotent upsert
    await this.saveTransactions(transactions);

    // 6. Update sync status
    const lastBlockHash = logs[logs.length - 1]?.blockHash;
    await this.syncRepo.updateProgress(
      this.processorName,
      toBlock,
      null,
      lastBlockHash ?? undefined
    );

    logger.info({
      count: transactions.length,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
    }, 'Events indexed successfully');

    return transactions.length;
  }

  /**
   * Fetch logs from RPC
   * @throws Error if RPC fails (fail fast)
   */
  private async fetchLogs(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
    try {
      const logs = await this.client.getLogs({
        address: this.contractAddress,
        fromBlock,
        toBlock,
      });
      return logs;
    } catch (error) {
      logger.error({ error, fromBlock, toBlock }, 'RPC getLogs failed');
      throw new Error(`Failed to fetch logs: ${error}`);
    }
  }

  /**
   * Decode events using ABI
   * @throws Error if decode fails (fail fast)
   */
  private decodeEvents(logs: ValidatedLog[]): Array<{
    eventName: string;
    args: Record<string, unknown>;
    blockNumber: bigint;
    txHash: string;
    logIndex: number;
  }> {
    const decodedEvents = logs.map((log) => {
      try {
        const decoded = decodeEventLog({
          abi: simpleBankAbi,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });

        // Enhanced diagnostic logging
        console.log('🔍 [EVENT DECODED]', {
          eventName: decoded.eventName,
          blockNumber: log.blockNumber.toString(),
          txHash: log.transactionHash,
          args: decoded.args,
        });

        return {
          eventName: decoded.eventName,
          args: decoded.args as Record<string, unknown>,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        };
      } catch (error) {
        logger.error({ error, log }, 'Event decode failed');
        throw new Error(`Failed to decode event: ${error}`);
      }
    });

    // Log event type distribution
    const eventCounts = decodedEvents.reduce((acc, e) => {
      acc[e.eventName] = (acc[e.eventName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('📊 [EVENT DISTRIBUTION]', eventCounts);

    return decodedEvents;
  }

  /**
   * Transform decoded events to transaction records
   */
  private transformToTransactions(
    events: Array<{
      eventName: string;
      args: Record<string, unknown>;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }>
  ): Omit<Transaction, 'id' | 'created_at'>[] {
    const filtered = events.filter((e) => e.eventName === 'Transfer'); // Index Transfer events (called by demo script)

    console.log(`✅ [FILTER] Kept ${filtered.length}/${events.length} Transfer events`);

    return filtered.map((event) => {
      const tx = {
        tx_hash: event.txHash,
        block_number: event.blockNumber,
        from_address: String(event.args.from || '0x0'),
        to_address: String(event.args.to || '0x0'),
        value: String(event.args.amount || '0'),
        gas_price: null,
        gas_used: null,
        status: 1, // success
      };

      console.log('💾 [TO SAVE]', {
        txHash: tx.tx_hash,
        from: tx.from_address,
        to: tx.to_address,
        amount: tx.value,
      });

      return tx;
    });
  }

  /**
   * Save transactions to DB
   * Uses idempotent upsert - duplicate (block_number, tx_hash) will update
   */
  private async saveTransactions(
    transactions: Omit<Transaction, 'id' | 'created_at'>[]
  ): Promise<void> {
    for (const tx of transactions) {
      try {
        await this.txRepo.saveTransaction(tx);
      } catch (error) {
        logger.error({ error, tx }, 'Failed to save transaction');
        throw new Error(`DB save failed: ${error}`);
      }
    }
  }

  /**
   * Get last processed block from sync status
   */
  async getLastProcessedBlock(): Promise<bigint> {
    const status = await this.syncRepo.getStatus(this.processorName);
    return status?.last_processed_block ?? 0n;
  }

  /**
   * Run continuous indexing with polling
   */
  async startPolling(pollIntervalMs: number = 2000): Promise<void> {
    logger.info({ pollIntervalMs }, 'Starting event indexer polling');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const lastBlock = await this.getLastProcessedBlock();
        const currentBlock = await this.client.getBlockNumber();

        if (lastBlock < currentBlock) {
          const fromBlock = lastBlock + 1n;
          await this.indexEvents(fromBlock, currentBlock);
        } else {
          logger.debug('No new blocks to index');
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        logger.error({ error }, 'Polling error - crashing');
        throw error; // Fail fast - let global handler catch
      }
    }
  }
}

/**
 * Factory function to create indexer
 */
export function createEventIndexer(
  rpcUrl: string = process.env.RPC_URL || 'http://localhost:8545',
  contractAddress: Address
): EventIndexer {
  return new EventIndexer(rpcUrl, contractAddress);
}
