/**
 * Chain reorganization handling utilities
 * Detects and handles blockchain reorganizations
 *
 * Designed with C++-style type safety: all numeric comparisons
 * use explicit BigInt conversion to prevent JavaScript type coercion bugs.
 */

import { BlockRepository } from '../database/block-repository';
import logger from './logger';
import { toBigInt, assertBigInt } from './type-safety';

export interface ReorgDetectionResult {
  detected: boolean;
  reorgDepth?: number;
  commonAncestor?: bigint;
  message: string;
}

export interface ReorgHandlingOptions {
  maxReorgDepth: number;
  onReorgDetected: (depth: number, commonAncestor: bigint) => Promise<void>;
}

const DEFAULT_REORG_OPTIONS: ReorgHandlingOptions = {
  maxReorgDepth: 100, // Maximum reorg depth to handle
  onReorgDetected: async (depth, commonAncestor) => {
    logger.error(
      { depth, commonAncestor: commonAncestor.toString() },
      'Reorganization detected but no handler configured'
    );
  },
};

/**
 * Detect chain reorganization by verifying parent hash linkage
 */
export async function detectReorg(
  blockRepository: BlockRepository,
  newBlockHash: string,
  newBlockNumber: bigint,
  expectedParentHash?: string
): Promise<ReorgDetectionResult> {
  try {
    // If this is genesis block, no reorg possible
    if (newBlockNumber === 0n) {
      return {
        detected: false,
        message: 'Genesis block, reorg not applicable',
      };
    }

    // Get the block that should be the parent
    if (!expectedParentHash) {
      return {
        detected: false,
        message: 'No parent hash provided, cannot detect reorg',
      };
    }

    // Check if we have the expected parent block
    const expectedParent = await blockRepository.findByHash(expectedParentHash);

    // If parent exists, no reorg
    if (expectedParent) {
      return {
        detected: false,
        message: 'Parent block found, chain is continuous',
      };
    }

    // Parent not found - potential reorg
    // Check if we have a block at this height with different hash
    const existingBlock = await blockRepository.findById(newBlockNumber);

    if (!existingBlock) {
      // No existing block at this height - first sync or gap
      return {
        detected: false,
        message: 'No existing block at this height, likely initial sync or gap',
      };
    }

    // Block exists but has different hash - reorg detected!
    logger.warn(
      {
        blockNumber: newBlockNumber.toString(),
        expectedHash: newBlockHash,
        actualHash: existingBlock.hash,
        actualParent: existingBlock.parent_hash,
      },
      'Reorg detected: Block hash mismatch'
    );

    // Find common ancestor to determine reorg depth
    const commonAncestor = await findCommonAncestor(
      blockRepository,
      expectedParentHash,
      newBlockNumber
    );

    // 🟡 Fix A1: Keep reorgDepth as bigint to avoid precision loss
    // Problem: Number(newBlockNumber - commonAncestor) loses precision if > 2^53
    // Solution: Keep as bigint and convert to number only when safe
    const reorgDepthBigInt = commonAncestor
      ? newBlockNumber - commonAncestor
      : 0n;

    // Validate safe conversion before using as number
    if (reorgDepthBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Reorg depth ${reorgDepthBigInt} exceeds safe integer range (${Number.MAX_SAFE_INTEGER}). ` +
        `This indicates an extreme reorg that may require manual intervention.`
      );
    }

    const reorgDepth = Number(reorgDepthBigInt);

    return {
      detected: true,
      reorgDepth,
      commonAncestor: commonAncestor || undefined,
      message: `Reorg detected at block ${newBlockNumber}, depth: ${reorgDepth}`,
    };
  } catch (error) {
    // P1 Fix: Don't mask reorg detection errors as "not detected"
    // This could cause dirty data to be written during actual reorgs
    logger.error({ error }, 'Error detecting reorg - propagating error');
    throw new Error(
      `Reorg detection failed: ${error instanceof Error ? error.message : String(error)}. ` +
      `Cannot safely continue without reorg detection. Stopping to prevent dirty data.`
    );
  }
}

/**
 * Find the common ancestor between new chain and existing chain
 */
async function findCommonAncestor(
  blockRepository: BlockRepository,
  newChainParentHash: string,
  forkBlock: bigint
): Promise<bigint | null> {
  let currentHash = newChainParentHash;
  let currentNumber = forkBlock - 1n;
  const maxDepth = 1000; // Safety limit
  let iterations = 0;
  // P0 Fix: Limit Set size to prevent memory leak on extreme reorgs
  const VISITED_HASHES_MAX_SIZE = 100;
  const visitedHashes = new Set<string>();
  // Cache for batch fetching - P0 Fix N+1 problem
  const blockCache = new Map<string, {hash: string; parent_hash: string} | null>();

  while (iterations < maxDepth && currentNumber >= 0n) {
    // 🟣 Fix R3: Detect circular references to prevent infinite loops
    // Problem: If block parent_hash chain forms a cycle (theoretically impossible),
    // maxDepth might not be sufficient or we might loop infinitely
    // Solution: Track visited hashes and detect cycles early
    if (visitedHashes.has(currentHash)) {
      logger.error(
        { blockNumber: currentNumber.toString(), hash: currentHash },
        'Circular reference detected in blockchain - parent hash chain forms a cycle'
      );
      throw new Error(
        `Circular reference detected at block ${currentNumber}. ` +
        `This indicates data corruption or invalid blockchain data. ` +
        `Manual intervention required.`
      );
    }

    // P0 Fix: Limit Set size to prevent memory leak on extreme reorgs (1000+ depth)
    if (visitedHashes.size >= VISITED_HASHES_MAX_SIZE) {
      // Remove oldest entries (FIFO) - simple LRU by clearing half
      const entries = Array.from(visitedHashes).slice(0, VISITED_HASHES_MAX_SIZE / 2);
      visitedHashes.clear();
      entries.forEach(h => visitedHashes.add(h));
    }
    visitedHashes.add(currentHash);

    // Check if this block exists in our database
    const existingBlock = await blockRepository.findById(currentNumber);

    if (existingBlock && existingBlock.hash === currentHash) {
      // Found common ancestor
      logger.info(
        { blockNumber: currentNumber.toString(), hash: currentHash },
        'Found common ancestor'
      );
      return currentNumber;
    }

    // Move to parent
    // P0 Fix: Use cache to prevent N+1 query problem
    let newBlock = blockCache.get(currentHash);
    if (newBlock === undefined) {
      const fetchedBlock = await blockRepository.findByHash(currentHash);
      newBlock = fetchedBlock || null;
      blockCache.set(currentHash, newBlock);
      // Limit cache size to prevent memory leak
      if (blockCache.size > 100) {
        const firstKey = blockCache.keys().next().value;
        if (firstKey !== undefined) {
          blockCache.delete(firstKey);
        }
      }
    }
    if (!newBlock) {
      logger.warn(
        { blockNumber: currentNumber.toString(), hash: currentHash },
        'Cannot find parent block in new chain'
      );
      break;
    }

    currentHash = newBlock.parent_hash;
    currentNumber = currentNumber - 1n;
    iterations++;
  }

  logger.warn('Could not find common ancestor within depth limit');
  return null;
}

/**
 * Verify chain continuity before saving blocks
 * Throws error if parent block is missing (except for genesis)
 * 
 * P1 Fix: Added LRU cache to prevent N+1 queries during batch sync
 * Same parent hash queried repeatedly for each block in batch
 */

// P1 Fix: Simple LRU cache for parent block lookups
type ParentBlock = {number: bigint; hash: string} | null;
const parentHashCache = new Map<string, {block: ParentBlock; timestamp: number}>();
const PARENT_CACHE_MAX_SIZE = 100;
const PARENT_CACHE_TTL_MS = 60000; // 1 minute TTL

async function getCachedParentBlock(
  blockRepository: BlockRepository,
  parentHash: string
): Promise<ParentBlock> {
  const now = Date.now();
  const cached = parentHashCache.get(parentHash);

  // Return cached if not expired
  if (cached && (now - cached.timestamp) < PARENT_CACHE_TTL_MS) {
    return cached.block;
  }

  // Fetch from DB
  const parentBlock = await blockRepository.findByHash(parentHash);
  const result: ParentBlock = parentBlock ?? null;

  // Update cache
  parentHashCache.set(parentHash, {block: result, timestamp: now});

  // Evict oldest if over limit
  if (parentHashCache.size > PARENT_CACHE_MAX_SIZE) {
    const firstKey = parentHashCache.keys().next().value;
    if (firstKey !== undefined) {
      parentHashCache.delete(firstKey);
    }
  }

  return result;
}
export async function verifyChainContinuity(
  blockRepository: BlockRepository,
  blockNumber: bigint,
  parentHash: string
): Promise<void> {
  // Genesis block has no parent
  if (blockNumber === 0n) {
    return;
  }

  // P1 Fix: Use cached lookup to prevent N+1 queries during batch sync
  const parentBlock = await getCachedParentBlock(blockRepository, parentHash);

  if (!parentBlock) {
    throw new Error(
      `Parent block ${parentHash} not found for block ${blockNumber}. ` +
      `Possible reorg or out-of-order data.`
    );
  }

  // C++-style explicit type conversion
  // Like static_cast<int64_t> before comparison
  const parentBlockNumber = assertBigInt(parentBlock.number, 'parentBlock.number');
  const expectedParentNumber = toBigInt(blockNumber - 1n);

  // Detailed logging for type debugging (prevents "log hallucination")
  logger.trace({
    blockNumber: blockNumber.toString(),
    blockNumberType: typeof blockNumber,
    parentBlockNumber: parentBlockNumber.toString(),
    parentBlockNumberOriginalType: typeof parentBlock.number,
    expectedParentNumber: expectedParentNumber.toString(),
    expectedParentNumberType: 'bigint',
    comparison: parentBlockNumber === expectedParentNumber,
  }, 'Chain continuity type check');

  if (parentBlockNumber !== expectedParentNumber) {
    throw new Error(
      `Parent block number mismatch: expected ${expectedParentNumber} (bigint), ` +
      `got ${parentBlockNumber} (from ${typeof parentBlock.number}). ` +
      `This indicates data corruption or reorg. ` +
      `Context: verifying block ${blockNumber} against parent ${parentHash}`
    );
  }
}

/**
 * Handle reorg by rolling back blocks to common ancestor
 */
export async function handleReorg(
  blockRepository: BlockRepository,
  commonAncestor: bigint,
  options: Partial<ReorgHandlingOptions> = {}
): Promise<number> {
  const opts = { ...DEFAULT_REORG_OPTIONS, ...options };

  logger.info(
    { commonAncestor: commonAncestor.toString() },
    'Starting reorg handling'
  );

  try {
    // Delete blocks after common ancestor
    const deletedCount = await blockRepository.deleteBlocksAfter(commonAncestor);

    logger.warn(
      { commonAncestor: commonAncestor.toString(), deletedCount },
      'Reorg handling: rolled back blocks'
    );

    // P0 Fix: Skip callback if no blocks were actually deleted (not a real reorg)
    if (deletedCount === 0) {
      logger.warn(
        { commonAncestor: commonAncestor.toString() },
        'No blocks deleted, reorg depth is 0 - skipping handler'
      );
      return deletedCount;
    }

    // Call custom handler only for actual reorgs
    await opts.onReorgDetected(deletedCount, commonAncestor);

    return deletedCount;
  } catch (error) {
    logger.error({ error }, 'Failed to handle reorg');
    throw error;
  }
}
