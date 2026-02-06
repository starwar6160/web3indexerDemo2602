import { createPublicClient, http, Block, Log, decodeEventLog, type Address } from 'viem';
import { BlockRepository } from './database/block-repository';
import { LogRepository, TransactionLog } from './database/log-repository';
import { TransfersRepository, type Transfer } from './database/transfers-repository';
import { validateBlocks, toDbBlock, ValidatedBlock } from './database/schemas';
import { sql } from 'kysely';
import pLimit from 'p-limit';

/**
 * SimpleBank Transfer Event ABI
 * Phase 3: Event parsing - Transfer(address indexed from, address indexed to, uint256 amount, uint256 timestamp)
 * 
 * NOTE: SimpleBank's Transfer event has 4 parameters including timestamp,
 * unlike standard ERC20 which only has 3 parameters (from, to, value).
 */
const simpleBankTransferAbi = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const;

/**
 * Configuration for the sync engine
 */
export interface SyncEngineConfig {
  rpcUrl: string | string[]; // Support multiple RPC URLs for load balancing
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  confirmationDepth?: number; // Number of blocks to wait before confirming
  concurrency?: number; // P1 Fix: Parallel block fetching concurrency
  rpcTimeout?: number; // P4 Fix: RPC request timeout in ms
  fetchLogs?: boolean; // P3 Fix: Fetch transaction logs atomically
  tokenContract?: Address; // ERC20 contract to monitor
}

/**
 * Result of a batch sync operation
 */
export interface BatchSyncResult {
  synced: number;
  failed: number;
  reorgDetected: boolean;
  lastBlockNumber: bigint;
  lastBlockHash: string;
}

/**
 * Enhanced sync engine with atomic batch processing, chain validation, and reorg handling
 *
 * CRITICAL FIXES:
 * - C1: All-or-nothing batch sync with retry queue
 * - C2: ParentHash chain validation within batches
 * - C3: Transaction boundary - validation before write
 * - P3: Atomic block + Transfer event sync in single transaction
 */
export class SyncEngine {
  private client: ReturnType<typeof createPublicClient>;
  private clients: ReturnType<typeof createPublicClient>[] = [];
  private blockRepository: BlockRepository;
  private transfersRepository: TransfersRepository; // P3: Transfer events
  private config: SyncEngineConfig;
  private currentRpcIndex = 0;

  constructor(config: SyncEngineConfig) {
    // 🟡 Fix A2: Validate batchSize boundaries
    // Problem: Extremely large batchSize (e.g., > 1000) could cause memory issues
    // Solution: Enforce reasonable limits at construction time
    if (config.batchSize <= 0 || config.batchSize > 100) {
      throw new Error(
        `Invalid batchSize: ${config.batchSize}. ` +
        `Must be between 1 and 100. ` +
        `This limit prevents memory exhaustion from large batches.`
      );
    }

    this.config = config;
    this.blockRepository = new BlockRepository();
    this.transfersRepository = new TransfersRepository(); // P3: Transfer events

    // P4 Fix: Support multiple RPC URLs with round-robin
    const rpcUrls = Array.isArray(config.rpcUrl) ? config.rpcUrl : [config.rpcUrl];

    this.clients = rpcUrls.map(url =>
      createPublicClient({
        transport: http(url, {
          timeout: config.rpcTimeout || 30000, // 30s default
          retryCount: 0, // We handle retries manually
        }),
      })
    );

    this.client = this.clients[0]; // Primary client
  }

  /**
   * Sync blocks from startBlock to endBlock with full chain validation
   *
   * This implements the fail-fast + atomic strategy:
   * 1. Fetch all blocks in memory first
   * 2. Validate chain continuity (parentHash matching)
   * 3. Write atomically in a single transaction
   *
   * @param startBlock Starting block number (inclusive)
   * @param endBlock Ending block number (inclusive)
   * @param expectedParentHash Expected parent hash for startBlock (for validation)
   * @returns Last block hash for next batch validation
   */
  private async getTransferEvents(fromBlock: bigint, toBlock: bigint): Promise<Omit<Transfer, 'id' | 'created_at'>[]> {
    if (!this.config.tokenContract) {
      return [];
    }

    try {
      const logs = await this.client.getLogs({
        address: this.config.tokenContract,
        event: simpleBankTransferAbi[0],
        fromBlock,
        toBlock,
      });

      return logs.map((log) => {
        const decoded = decodeEventLog({
          abi: simpleBankTransferAbi,
          data: log.data,
          topics: log.topics,
        });

        return {
          block_number: log.blockNumber,
          transaction_hash: log.transactionHash,
          log_index: log.logIndex,
          from_address: String(decoded.args?.from || '0x0'),
          to_address: String(decoded.args?.to || '0x0'),
          amount: String(decoded.args?.amount || '0'),
          contract_address: this.config.tokenContract!,
        };
      });
    } catch (error) {
      console.error('[SyncEngine] Failed to fetch Transfer events:', error);
      throw new Error(`Event fetch failed: ${error}`);
    }
  }

  async syncBatch(
    startBlock: bigint,
    endBlock: bigint,
    expectedParentHash?: string
  ): Promise<BatchSyncResult> {
    console.log(`[SyncEngine] Syncing batch ${startBlock} to ${endBlock}`);

    // 🟣 Fix R4: Check batch size to prevent V8 heap exhaustion
    // CRITICAL FIX: Use BigInt comparison to avoid 2^53 precision loss
    const batchRange = endBlock - startBlock + 1n;
    if (batchRange > 1000n) {
      throw new Error(
        `Batch size ${batchRange.toString()} exceeds safe limit of 1000 blocks. ` +
        `This could cause V8 heap exhaustion. ` +
        `Please reduce batchSize or sync in smaller chunks.`
      );
    }

    const blocksToSave: Block[] = [];
    let currentParentHash = expectedParentHash;
    const failedBlocks: Array<{number: bigint, error: string}> = [];
    let reorgDetectedAt: bigint | null = null;
    let reorgParentHash: string | null = null;

    // P1 Fix: Parallel block fetching with concurrency control
    const concurrency = this.config.concurrency || 10; // Default: 10 concurrent requests
    const limit = pLimit(concurrency);

    console.log(`[SyncEngine] Fetching ${endBlock - startBlock + 1n} blocks with concurrency ${concurrency}`);

    // Create array of block numbers to fetch
    const blockNumbers: bigint[] = [];
    let bn = startBlock;
    while (bn <= endBlock) {
      blockNumbers.push(bn);
      bn = bn + 1n;
    }

    // Phase 1: Parallel fetch with retry logic (C1 + P1 fix)
    const fetchPromises = blockNumbers.map((blockNumber) =>
      limit(async () => {
        let retryCount = 0;
        let clientIndex = 0;

        while (retryCount < this.config.maxRetries) {
          try {
            // P4 Fix: Round-robin RPC selection
            const client = this.clients[clientIndex % this.clients.length];
            const block = await client.getBlock({ blockNumber });

            console.log(`[SyncEngine] ✅ Fetched block ${blockNumber} from RPC ${clientIndex}`);
            return { success: true, block, blockNumber };
          } catch (error) {
            retryCount++;
            clientIndex++; // Try next RPC on failure

            if (retryCount >= this.config.maxRetries) {
              const errorMsg = `Failed to fetch block ${blockNumber} after ${this.config.maxRetries} attempts`;
              console.error(`[SyncEngine] ❌ ${errorMsg}:`, error);
              return { success: false, error: String(error), blockNumber };
            }

            // P4 Fix: Check for rate limiting (429)
            if (String(error).includes('429') || String(error).includes('rate limit')) {
              const backoffMs = this.config.retryDelayMs * retryCount * 2; // Exponential backoff for 429
              console.warn(
                `[SyncEngine] ⚠️  Rate limited on block ${blockNumber}, ` +
                `waiting ${backoffMs}ms before retry...`
              );
              await this.sleep(backoffMs);
            } else {
              await this.sleep(this.config.retryDelayMs * retryCount);
            }
          }
        }

        return { success: false, error: 'Max retries exceeded', blockNumber };
      })
    );

    // Wait for all fetches to complete
    const results = await Promise.all(fetchPromises);

    // Process results
    for (const result of results) {
      if (result.success && 'block' in result) {
        blocksToSave.push(result.block);
      } else {
        failedBlocks.push({ number: result.blockNumber, error: result.error });
      }
    }

    // C1 Fix: Fail-fast if any blocks failed
    if (failedBlocks.length > 0) {
      throw new Error(
        `Failed to fetch ${failedBlocks.length} blocks: ${failedBlocks.map(f => `#${f.number}`).join(', ')}. ` +
        `Aborting batch to prevent data loss.`
      );
    }

    // Sort blocks by number to ensure correct order
    blocksToSave.sort((a, b) => (a.number > b.number ? 1 : -1));

    if (blocksToSave.length === 0) {
      throw new Error('No blocks fetched in batch');
    }

    // Phase 2: Validate chain continuity (C2 fix)
    let previousHash = currentParentHash;
    let firstBlock = true;

    for (const block of blocksToSave) {
      // Skip parentHash validation for genesis block or first block in batch if no expectedParentHash
      if (firstBlock && previousHash === undefined) {
        firstBlock = false;
        previousHash = block.hash;
        continue;
      }

      firstBlock = false;

      // Verify parentHash chain
      if (previousHash && block.parentHash !== previousHash) {
        console.error(
          `[SyncEngine] CHAIN_DISCONTINUITY at block ${block.number}:\n` +
          `  Expected parent: ${previousHash}\n` +
          `  Got parent: ${block.parentHash}`
        );

        // Check if this is a reorg by looking up the block in database
        // 🔵 Fix D5: Use SELECT FOR UPDATE to lock the row during transaction
        // Problem: Reading (findById) and writing (insert) in same transaction without lock
        // Solution: Lock the row to prevent concurrent modifications
        const existingBlock = await this.blockRepository.findByIdForUpdate(block.number);

        if (existingBlock && existingBlock.hash !== block.hash) {
          console.warn(
            `[SyncEngine] Reorg detected at block ${block.number}:\n` +
            `  Old hash: ${existingBlock.hash}\n` +
            `  New hash: ${block.hash}`
          );

          // Mark for reorg handling - will be processed inside transaction
          reorgDetectedAt = block.number;
          reorgParentHash = block.parentHash || null;
        } else {
          throw new Error(
            `Chain discontinuity detected at block ${block.number}. ` +
            `Parent hash mismatch indicates missing or out-of-order blocks.`
          );
        }
      }

      previousHash = block.hash;
    }

    // Phase 3: Validate with Zod and convert to DB format
    const validatedBlocks = validateBlocks(blocksToSave);

    if (validatedBlocks.length !== blocksToSave.length) {
      throw new Error(
        `Zod validation failed: ${validatedBlocks.length}/${blocksToSave.length} blocks valid`
      );
    }

    // CRITICAL FIX: Convert validated blocks to DB format
    const dbBlocks = validatedBlocks.map(toDbBlock);

    // Phase 3.5: Fetch Transfer events (INSIDE transaction for true atomicity)
    // Phase 4: Atomic database write in transaction (C3 fix) - BLOCKS + TRANSFERS
    let insertedCount = 0;
    let updatedCount = 0;
    let transfersSaved = 0;

    await this.blockRepository.db.transaction().execute(async (trx) => {
      // 0. Handle reorg first if detected - must be inside same transaction
      if (reorgDetectedAt !== null) {
        console.warn(`[SyncEngine] Handling reorg at block ${reorgDetectedAt} inside transaction`);
        
        // Delete blocks due to reorg
        const deleteResult = await trx
          .deleteFrom('blocks')
          .where('number', '>=', reorgDetectedAt)
          .execute();
        console.warn(`[SyncEngine] Deleted ${deleteResult.length} blocks due to reorg`);

        // Verify cascade delete worked
        if (this.config.tokenContract) {
          const remainingTransfers = await trx
            .selectFrom('transfers')
            .select('block_number')
            .where('block_number', '>=', reorgDetectedAt)
            .limit(1)
            .executeTakeFirst();

          if (remainingTransfers) {
            throw new Error(
              `Cascade delete failed: transfers still exist at block ${reorgDetectedAt}. ` +
              `Database inconsistency detected.`
            );
          }
        }
        console.warn(`[SyncEngine] ✅ Reorg handled atomically inside transaction`);
      }

      // 4a. Fetch events INSIDE transaction - fail fast if RPC unavailable
      let transfers: Omit<Transfer, 'id' | 'created_at'>[] = [];
      if (this.config.tokenContract) {
        console.log(`[SyncEngine] Fetching Transfer events for batch (inside transaction)...`);
        transfers = await this.getTransferEvents(startBlock, endBlock);
        console.log(`[SyncEngine] Fetched ${transfers.length} Transfer events`);
      }

      // 4b. Save blocks
      for (const block of dbBlocks) {
        const now = new Date().toISOString();

        const result = await trx
          .insertInto('blocks')
          .values({
            ...block,
            created_at: now,
            updated_at: now,
          })
          .onConflict((oc) => oc
            .column(['chain_id', 'number'])
            .doUpdateSet({
              hash: block.hash,
              parent_hash: block.parent_hash,
              timestamp: block.timestamp,
              updated_at: now,
            })
            .where('blocks.hash', '!=', block.hash)
          )
          .returningAll()
          .executeTakeFirst();

        if (result) {
          const dateNow = Date.now();
          const createdAt = new Date(result.created_at).getTime();
          const isFreshInsert = (dateNow - createdAt) < 1000;

          if (isFreshInsert) {
            insertedCount++;
          } else {
            updatedCount++;
          }
        }
      }

      // 4c. Save transfers atomically (cascade delete via FK)
      if (transfers.length > 0) {
        transfersSaved = await this.transfersRepository.saveWithTrx(trx, transfers);
        console.log(`[SyncEngine] ✅ Saved ${transfersSaved} Transfer events in same transaction`);
      }
    });

    const lastBlock = blocksToSave[blocksToSave.length - 1];

    console.log(
      `[SyncEngine] ✅ Batch sync complete: ${insertedCount} inserted, ` +
      `${updatedCount} updated, ${failedBlocks.length} failed`
    );

    return {
      synced: blocksToSave.length,
      failed: failedBlocks.length,
      reorgDetected: updatedCount > 0,
      lastBlockNumber: lastBlock.number,
      lastBlockHash: lastBlock.hash,
    };
  }

  /**
   * Handle reorg by deleting conflicting blocks AND cascade delete transfers
   * CRITICAL: Wrapped in transaction for atomicity - crash mid-reorg won't leave orphans
   */
  private async handleReorg(blockNumber: bigint, newParentHash: string): Promise<void> {
    console.warn(`[SyncEngine] Handling reorg at block ${blockNumber}`);

    await this.blockRepository.db.transaction().execute(async (trx) => {
      // 1. Delete blocks within transaction
      const deleteResult = await trx
        .deleteFrom('blocks')
        .where('number', '>', blockNumber - 1n)
        .execute();
      const deletedBlocks = deleteResult.length;

      console.warn(`[SyncEngine] Deleted ${deletedBlocks} blocks due to reorg`);

      // 2. Verify cascade delete worked within same transaction
      if (this.config.tokenContract) {
        const remainingTransfers = await trx
          .selectFrom('transfers')
          .select('block_number')
          .where('block_number', '>', blockNumber - 1n)
          .limit(1)
          .executeTakeFirst();

        if (remainingTransfers) {
          throw new Error(
            `Cascade delete failed: transfers still exist after block ${blockNumber}. ` +
            `Database inconsistency detected.`
          );
        }
      }
    });

    console.warn(`[SyncEngine] ✅ Reorg handled atomically - all orphans deleted`);
  }

  /**
   * Sync from current database state to chain tip
   */
  async syncToTip(): Promise<void> {
    const localMaxBlock = await this.blockRepository.getMaxBlockNumber();
    const chainTip = await this.client.getBlockNumber();

    let startBlock = localMaxBlock !== null ? localMaxBlock + 1n : 0n;

    // Apply confirmation depth if configured
    let targetBlock = chainTip;
    if (this.config.confirmationDepth && this.config.confirmationDepth > 0) {
      targetBlock = chainTip - BigInt(this.config.confirmationDepth);
      if (targetBlock < 0n) targetBlock = 0n;

      console.log(`[SyncEngine] Using confirmation depth ${this.config.confirmationDepth}, syncing to ${targetBlock}`);
    }

    if (startBlock > targetBlock) {
      console.log(`[SyncEngine] Local database (${localMaxBlock}) is ahead of target (${targetBlock})`);
      return;
    }

    console.log(`[SyncEngine] Syncing from ${startBlock} to ${targetBlock}`);

    // Get expected parent hash for validation
    let expectedParentHash: string | undefined;
    if (localMaxBlock !== null) {
      const lastBlock = await this.blockRepository.findById(localMaxBlock);
      if (lastBlock) {
        expectedParentHash = lastBlock.hash;
      }
    }

    // Sync in batches
    while (startBlock <= targetBlock) {
      const batchEnd = startBlock + BigInt(this.config.batchSize) - 1n <= targetBlock
        ? startBlock + BigInt(this.config.batchSize) - 1n
        : targetBlock;

      const result = await this.syncBatch(startBlock, batchEnd, expectedParentHash);

      // Update for next batch
      startBlock = batchEnd + 1n;
      expectedParentHash = result.lastBlockHash;
    }

    console.log(`[SyncEngine] ✅ Sync complete to block ${targetBlock}`);
  }

  /**
   * Detect and repair gaps in the blockchain
   */
  async repairGaps(): Promise<void> {
    console.log(`[SyncEngine] Checking for gaps...`);

    const gaps = await this.blockRepository.detectGaps();

    if (gaps.length === 0) {
      console.log(`[SyncEngine] No gaps detected`);
      return;
    }

    console.warn(`[SyncEngine] Found ${gaps.length} gaps:`);
    gaps.forEach((gap, i) => {
      console.warn(`  Gap ${i + 1}: blocks ${gap.start} to ${gap.end}`);
    });

    // Repair each gap
    for (const gap of gaps) {
      console.log(`[SyncEngine] Repairing gap ${gap.start} to ${gap.end}`);

      const chainTip = await this.client.getBlockNumber();
      const safeEnd = gap.end <= chainTip ? gap.end : chainTip;

      if (gap.start > safeEnd) {
        console.warn(`[SyncEngine] Gap ${gap.start}-${gap.end} is beyond chain tip, skipping`);
        continue;
      }

      await this.syncBatch(gap.start, safeEnd);
    }

    console.log(`[SyncEngine] ✅ Gap repair complete`);
  }

  /**
   * Get statistics about block coverage
   */
  async getStats(): Promise<void> {
    const stats = await this.blockRepository.getBlockCoverageStats();

    console.log(`[SyncEngine] Block Coverage Statistics:`);
    console.log(`  Total blocks: ${stats.totalBlocks}`);
    console.log(`  Expected blocks: ${stats.expectedBlocks}`);
    console.log(`  Missing blocks: ${stats.missingBlocks}`);
    console.log(`  Coverage: ${stats.coverage}%`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
