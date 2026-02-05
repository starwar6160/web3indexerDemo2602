"use strict";
/**
 * Chain reorganization handling utilities
 * Detects and handles blockchain reorganizations
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectReorg = detectReorg;
exports.verifyChainContinuity = verifyChainContinuity;
exports.handleReorg = handleReorg;
const logger_1 = __importDefault(require("./logger"));
const DEFAULT_REORG_OPTIONS = {
    maxReorgDepth: 100, // Maximum reorg depth to handle
    onReorgDetected: async (depth, commonAncestor) => {
        logger_1.default.error({ depth, commonAncestor: commonAncestor.toString() }, 'Reorganization detected but no handler configured');
    },
};
/**
 * Detect chain reorganization by verifying parent hash linkage
 */
async function detectReorg(blockRepository, newBlockHash, newBlockNumber, expectedParentHash) {
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
        logger_1.default.warn({
            blockNumber: newBlockNumber.toString(),
            expectedHash: newBlockHash,
            actualHash: existingBlock.hash,
            actualParent: existingBlock.parent_hash,
        }, 'Reorg detected: Block hash mismatch');
        // Find common ancestor to determine reorg depth
        const commonAncestor = await findCommonAncestor(blockRepository, expectedParentHash, newBlockNumber);
        const reorgDepth = commonAncestor
            ? Number(newBlockNumber - commonAncestor)
            : 0;
        return {
            detected: true,
            reorgDepth,
            commonAncestor: commonAncestor || undefined,
            message: `Reorg detected at block ${newBlockNumber}, depth: ${reorgDepth}`,
        };
    }
    catch (error) {
        logger_1.default.error({ error }, 'Error detecting reorg');
        return {
            detected: false,
            message: `Error detecting reorg: ${error}`,
        };
    }
}
/**
 * Find the common ancestor between new chain and existing chain
 */
async function findCommonAncestor(blockRepository, newChainParentHash, forkBlock) {
    let currentHash = newChainParentHash;
    let currentNumber = forkBlock - 1n;
    const maxDepth = 1000; // Safety limit
    let iterations = 0;
    while (iterations < maxDepth && currentNumber >= 0n) {
        // Check if this block exists in our database
        const existingBlock = await blockRepository.findById(currentNumber);
        if (existingBlock && existingBlock.hash === currentHash) {
            // Found common ancestor
            logger_1.default.info({ blockNumber: currentNumber.toString(), hash: currentHash }, 'Found common ancestor');
            return currentNumber;
        }
        // Move to parent
        const newBlock = await blockRepository.findByHash(currentHash);
        if (!newBlock) {
            logger_1.default.warn({ blockNumber: currentNumber.toString(), hash: currentHash }, 'Cannot find parent block in new chain');
            break;
        }
        currentHash = newBlock.parent_hash;
        currentNumber = currentNumber - 1n;
        iterations++;
    }
    logger_1.default.warn('Could not find common ancestor within depth limit');
    return null;
}
/**
 * Verify chain continuity before saving blocks
 * Throws error if parent block is missing (except for genesis)
 */
async function verifyChainContinuity(blockRepository, blockNumber, parentHash) {
    // Genesis block has no parent
    if (blockNumber === 0n) {
        return;
    }
    const parentBlock = await blockRepository.findByHash(parentHash);
    if (!parentBlock) {
        throw new Error(`Parent block ${parentHash} not found for block ${blockNumber}. ` +
            `Possible reorg or out-of-order data.`);
    }
    // Verify parent number is correct
    if (parentBlock.number !== blockNumber - 1n) {
        throw new Error(`Parent block number mismatch: expected ${blockNumber - 1n}, got ${parentBlock.number}`);
    }
}
/**
 * Handle reorg by rolling back blocks to common ancestor
 */
async function handleReorg(blockRepository, commonAncestor, options = {}) {
    const opts = { ...DEFAULT_REORG_OPTIONS, ...options };
    logger_1.default.info({ commonAncestor: commonAncestor.toString() }, 'Starting reorg handling');
    try {
        // Delete blocks after common ancestor
        const deletedCount = await blockRepository.deleteBlocksAfter(commonAncestor);
        logger_1.default.warn({ commonAncestor: commonAncestor.toString(), deletedCount }, 'Reorg handling: rolled back blocks');
        // Call custom handler
        await opts.onReorgDetected(deletedCount, commonAncestor);
        return deletedCount;
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to handle reorg');
        throw error;
    }
}
