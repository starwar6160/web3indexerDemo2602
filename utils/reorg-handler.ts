/**
 * Chain reorganization handling utilities
 * Detects and handles blockchain reorganizations
 */

import { BlockRepository } from '../database/block-repository';
import logger from './logger';

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

    const reorgDepth = commonAncestor
      ? Number(newBlockNumber - commonAncestor)
      : 0;

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

  while (iterations < maxDepth && currentNumber >= 0n) {
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

  // Verify parent number is correct
  if (parentBlock.number !== blockNumber - 1n) {
    throw new Error(
      `Parent block number mismatch: expected ${blockNumber - 1n}, got ${parentBlock.number}`
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
