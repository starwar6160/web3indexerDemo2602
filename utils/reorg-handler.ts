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
    logger.error({ error }, 'Error detecting reorg');
    return {
      detected: false,
      message: `Error detecting reorg: ${error}`,
    };
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
  const visitedHashes = new Set<string>(); // 🟣 Fix R3: Detect circular references

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
    const newBlock = await blockRepository.findByHash(currentHash);
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
 */
export async function verifyChainContinuity(
  blockRepository: BlockRepository,
  blockNumber: bigint,
  parentHash: string
): Promise<void> {
  // Genesis block has no parent
  if (blockNumber === 0n) {
    return;
  }

  const parentBlock = await blockRepository.findByHash(parentHash);

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

    // Call custom handler
    await opts.onReorgDetected(deletedCount, commonAncestor);

    return deletedCount;
  } catch (error) {
    logger.error({ error }, 'Failed to handle reorg');
    throw error;
  }
}
