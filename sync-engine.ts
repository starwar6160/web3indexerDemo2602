import { createPublicClient, http, Block } from 'viem';
import { BlockRepository } from './database/block-repository';
import { validateBlocks, toDbBlock, ValidatedBlock } from './database/schemas';
import { sql } from 'kysely';

type PublicClient = ReturnType<typeof createPublicClient>;

/**
 * Configuration for the sync engine
 */
export interface SyncEngineConfig {
  rpcUrl: string;
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  confirmationDepth?: number; // Number of blocks to wait before confirming
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
 */
export class SyncEngine {
  private client: PublicClient;
  private blockRepository: BlockRepository;
  private config: SyncEngineConfig;

  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
    this.blockRepository = new BlockRepository();
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
  async syncBatch(
    startBlock: bigint,
    endBlock: bigint,
    expectedParentHash?: string
  ): Promise<BatchSyncResult> {
    console.log(`[SyncEngine] Syncing batch ${startBlock} to ${endBlock}`);

    const blocksToSave: Block[] = [];
    let currentParentHash = expectedParentHash;
    const failedBlocks: Array<{number: bigint, error: string}> = [];

    // Phase 1: Fetch all blocks with retry logic (C1 fix)
    let blockNumber = startBlock;
    let retryCount = 0;

    while (blockNumber <= endBlock) {
      try {
        const block = await this.client.getBlock({ blockNumber });
        blocksToSave.push(block);

        console.log(`[SyncEngine] Fetched block ${blockNumber}: ${block.hash}`);
        blockNumber = blockNumber + 1n;
        retryCount = 0; // Reset retry on success
      } catch (error) {
        retryCount++;

        if (retryCount >= this.config.maxRetries) {
          const errorMsg = `Failed to fetch block ${blockNumber} after ${this.config.maxRetries} attempts`;
          console.error(`[SyncEngine] ${errorMsg}:`, error);
          failedBlocks.push({ number: blockNumber, error: String(error) });

          // C1 Fix: Fail-fast - don't skip blocks
          throw new Error(`${errorMsg}. Aborting batch to prevent data loss.`);
        }

        console.warn(
          `[SyncEngine] Failed to fetch block ${blockNumber} ` +
          `(attempt ${retryCount}/${this.config.maxRetries}), retrying...`
        );

        await this.sleep(this.config.retryDelayMs * retryCount);
      }
    }

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
        const existingBlock = await this.blockRepository.findById(block.number);

        if (existingBlock && existingBlock.hash !== block.hash) {
          console.warn(
            `[SyncEngine] Reorg detected at block ${block.number}:\n` +
            `  Old hash: ${existingBlock.hash}\n` +
            `  New hash: ${block.hash}`
          );

          // Handle reorg
          if (block.parentHash) {
            await this.handleReorg(block.number, block.parentHash);
          }
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

    const dbBlocks = validatedBlocks.map(toDbBlock);

    // Phase 4: Atomic database write in transaction (C3 fix)
    let insertedCount = 0;
    let updatedCount = 0;

    await this.blockRepository.db.transaction().execute(async (trx) => {
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
          // Determine insert vs update
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
   * Handle reorg by deleting conflicting blocks and resetting sync point
   */
  private async handleReorg(blockNumber: bigint, newParentHash: string): Promise<void> {
    console.warn(`[SyncEngine] Handling reorg at block ${blockNumber}`);

    // Delete all blocks after the reorg point
    const deletedCount = await this.blockRepository.deleteBlocksAfter(blockNumber - 1n);

    console.warn(`[SyncEngine] Deleted ${deletedCount} blocks due to reorg`);
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
