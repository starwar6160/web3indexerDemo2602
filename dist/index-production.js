"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// Load environment variables - must be before other imports
require("dotenv/config");
const viem_1 = require("viem");
const database_config_1 = require("./database/database-config");
const block_repository_1 = require("./database/block-repository");
const logger_1 = __importStar(require("./utils/logger"));
const config_1 = require("./utils/config");
const error_handlers_1 = require("./utils/error-handlers");
const health_server_1 = require("./utils/health-server");
const retry_1 = require("./utils/retry");
const rate_limiter_1 = require("./utils/rate-limiter");
const reorg_handler_1 = require("./utils/reorg-handler");
const client = (0, viem_1.createPublicClient)({
    transport: (0, viem_1.http)(config_1.config.RPC_URL),
});
let blockRepository;
let isRunning = true;
// Rate limiter: 10 requests per second with burst of 20
const rateLimiter = new rate_limiter_1.TokenBucketRateLimiter({
    tokensPerInterval: 10,
    intervalMs: 1000,
    maxBurstTokens: 20,
});
/**
 * Wrapper for RPC calls with rate limiting, metrics, and retries
 */
async function rpcCallWithMetrics(operation, fn) {
    const startTime = Date.now();
    // Apply rate limiting
    await rateLimiter.consume(1);
    try {
        const result = await (0, retry_1.retryWithBackoffSelective)(fn, (error) => {
            // Retry on network errors and rate limits
            const errorMessage = error.message.toLowerCase();
            return (errorMessage.includes('network') ||
                errorMessage.includes('timeout') ||
                errorMessage.includes('rate limit') ||
                errorMessage.includes('429'));
        }, {
            maxRetries: 3,
            baseDelayMs: 100,
            maxDelayMs: 5000,
        });
        if (!result.success) {
            throw result.error || new Error('RPC call failed');
        }
        const latency = Date.now() - startTime;
        (0, health_server_1.recordRpcCall)(true, latency);
        return result.data;
    }
    catch (error) {
        const latency = Date.now() - startTime;
        (0, health_server_1.recordRpcCall)(false, latency);
        logger_1.default.error({ error, operation }, 'RPC call failed');
        throw error;
    }
}
/**
 * 初始化数据库连接
 */
async function initializeDatabase() {
    logger_1.default.info('Initializing database connection...');
    try {
        await (0, database_config_1.createDbConnection)();
        blockRepository = new block_repository_1.BlockRepository();
        // 尝试查询，如果表不存在则创建
        try {
            await blockRepository.getBlockCount();
            logger_1.default.info('✅ Database tables already exist');
        }
        catch (error) {
            logger_1.default.warn('⚠️  Blocks table not found, creating...');
            const { initDatabase } = await Promise.resolve().then(() => __importStar(require('./database/init-database')));
            await initDatabase();
            logger_1.default.info('✅ Database tables created');
        }
        logger_1.default.info('✅ Database connection established');
    }
    catch (error) {
        logger_1.default.error({ error }, '❌ Database initialization failed');
        throw error;
    }
}
/**
 * 同步单个区块(带重组检测和验证)
 */
async function syncBlockWithValidation(blockNumber, parentHash) {
    try {
        // Fetch block with rate limiting and retry
        const block = await rpcCallWithMetrics(`getBlock-${blockNumber}`, () => client.getBlock({ blockNumber }));
        // Verify chain continuity (check parent exists)
        await (0, reorg_handler_1.verifyChainContinuity)(blockRepository, block.number, block.parentHash);
        // Check for reorg if we have previous block info
        if (parentHash) {
            const reorgResult = await (0, reorg_handler_1.detectReorg)(blockRepository, block.hash, block.number, parentHash);
            if (reorgResult.detected && reorgResult.commonAncestor !== undefined) {
                logger_1.default.warn({
                    blockNumber: block.number.toString(),
                    depth: reorgResult.reorgDepth,
                    commonAncestor: reorgResult.commonAncestor.toString(),
                }, 'Reorganization detected, rolling back...');
                await (0, reorg_handler_1.handleReorg)(blockRepository, reorgResult.commonAncestor);
                // After rollback, re-verify continuity
                await (0, reorg_handler_1.verifyChainContinuity)(blockRepository, block.number, block.parentHash);
            }
        }
        // Save validated block
        const saved = await blockRepository.saveValidatedBlocks([block]);
        // Verify write
        if (saved > 0) {
            const verified = await blockRepository.verifyBlocksWritten([block.number]);
            if (!verified) {
                throw new Error(`Block ${block.number} write verification failed`);
            }
            // Sampled logging for high-frequency block sync
            if (logger_1.logSamplers.perBlock.shouldLog()) {
                const suppressed = logger_1.logSamplers.perBlock.getSuppressedCount();
                logger_1.default.info({
                    blockNumber: block.number.toString(),
                    hash: block.hash,
                    suppressedLogs: suppressed,
                }, '✅ Block synced');
            }
            return true;
        }
        return false;
    }
    catch (error) {
        logger_1.default.error({ error, blockNumber: blockNumber.toString() }, 'Failed to sync block');
        throw error;
    }
}
/**
 * 批量同步区块(带事务和重组检测)
 */
async function syncBlockBatch(startBlock, endBlock) {
    const traceId = (0, logger_1.generateTraceId)();
    await (0, logger_1.withTraceId)(async () => {
        logger_1.default.info({
            startBlock: startBlock.toString(),
            endBlock: endBlock.toString(),
            count: (endBlock - startBlock + 1n).toString(),
        }, 'Starting batch sync');
        const rawBlocks = [];
        let lastParentHash;
        let successCount = 0;
        let failCount = 0;
        try {
            // Fetch blocks with rate limiting
            let blockNumber = startBlock;
            while (blockNumber <= endBlock) {
                try {
                    const block = await rpcCallWithMetrics(`getBlock-${blockNumber}`, () => client.getBlock({ blockNumber }));
                    rawBlocks.push(block);
                    // Store parent hash for next iteration
                    lastParentHash = block.parentHash;
                    // Sampled logging
                    if (logger_1.logSamplers.perBlock.shouldLog()) {
                        logger_1.default.trace({ blockNumber: blockNumber.toString(), hash: block.hash }, 'Fetched block');
                    }
                    blockNumber = blockNumber + 1n;
                }
                catch (error) {
                    logger_1.default.error({ error, blockNumber: blockNumber.toString() }, 'Failed to fetch block');
                    failCount++;
                    blockNumber = blockNumber + 1n;
                }
            }
            if (rawBlocks.length === 0) {
                logger_1.default.warn('No blocks fetched in this batch');
                return;
            }
            // Verify chain continuity before saving
            for (const block of rawBlocks) {
                if (block && typeof block === 'object' && 'number' in block && 'parentHash' in block) {
                    try {
                        await (0, reorg_handler_1.verifyChainContinuity)(blockRepository, block.number, block.parentHash);
                    }
                    catch (error) {
                        logger_1.default.error({
                            blockNumber: block.number.toString(),
                            parentHash: block.parentHash,
                            error: error instanceof Error ? error.message : String(error),
                        }, 'Chain continuity verification failed');
                        throw error;
                    }
                }
            }
            // Save in transaction
            const savedCount = await blockRepository.saveValidatedBlocks(rawBlocks);
            // Verify writes
            const blockNumbers = rawBlocks
                .filter((b) => b !== null && typeof b === 'object')
                .map((b) => b.number);
            if (blockNumbers.length > 0) {
                const verified = await blockRepository.verifyBlocksWritten(blockNumbers);
                if (!verified) {
                    throw new Error('Block write verification failed after batch save');
                }
            }
            successCount = savedCount;
            logger_1.default.info({
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                successCount,
                failCount,
            }, '✅ Batch sync completed');
        }
        catch (error) {
            logger_1.default.error({
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                error,
            }, '❌ Block batch sync failed');
            throw error;
        }
    });
}
/**
 * 同步缺失的区块
 */
async function syncMissingBlocks() {
    try {
        const localMaxBlock = await blockRepository.getMaxBlockNumber();
        let startBlock = localMaxBlock ? localMaxBlock + 1n : 0n;
        const latestBlock = await rpcCallWithMetrics('getBlockNumber', () => client.getBlockNumber());
        logger_1.default.info({
            localMax: localMaxBlock?.toString() ?? 'none',
            latest: latestBlock.toString(),
            startBlock: startBlock.toString(),
        }, 'Starting initial sync');
        if (startBlock <= latestBlock) {
            const blocksToSync = latestBlock - startBlock + 1n;
            logger_1.default.info({ blocksToSync: blocksToSync.toString() }, 'Blocks to sync');
            const batchSize = BigInt(parseInt(process.env.DB_SYNC_BATCH_SIZE || '10'));
            let currentBlock = startBlock;
            while (currentBlock <= latestBlock && isRunning) {
                // 使用三元表达式代替 Math.min
                const batchEnd = currentBlock + batchSize - 1n <= latestBlock
                    ? currentBlock + batchSize - 1n
                    : latestBlock;
                if (logger_1.logSamplers.perBatch.shouldLog()) {
                    logger_1.default.debug({
                        from: currentBlock.toString(),
                        to: batchEnd.toString(),
                    }, 'Syncing batch');
                }
                await syncBlockBatch(currentBlock, batchEnd);
                currentBlock = batchEnd + 1n;
            }
        }
        else {
            logger_1.default.info('Local database is ahead of chain, no sync needed');
        }
    }
    catch (error) {
        logger_1.default.error({ error }, '❌ Sync missing blocks failed');
        throw error;
    }
}
/**
 * 轮询新区块
 */
async function pollNewBlocks() {
    logger_1.default.info({
        interval: `${config_1.config.POLL_INTERVAL_MS}ms`,
    }, 'Starting real-time monitoring');
    while (isRunning) {
        try {
            const currentBlock = await rpcCallWithMetrics('pollBlockNumber', () => client.getBlockNumber());
            const localMaxBlock = (await blockRepository.getMaxBlockNumber()) ?? -1n;
            if (logger_1.logSamplers.perBatch.shouldLog()) {
                logger_1.default.debug({
                    chainBlock: currentBlock.toString(),
                    localMax: localMaxBlock.toString(),
                }, 'Polling blocks');
            }
            if (currentBlock > localMaxBlock) {
                const newBlocksCount = currentBlock - localMaxBlock;
                logger_1.default.info({
                    count: newBlocksCount.toString(),
                    from: (localMaxBlock + 1n).toString(),
                    to: currentBlock.toString(),
                }, 'Found new blocks to sync');
                await syncBlockBatch(localMaxBlock + 1n, currentBlock);
            }
            // 等待下一次轮询
            await new Promise((resolve) => setTimeout(resolve, Number(config_1.config.POLL_INTERVAL_MS)));
        }
        catch (error) {
            logger_1.default.error({ error }, 'Polling error');
            // Don't throw - let polling continue
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait before retry
        }
    }
}
/**
 * 主函数
 */
async function main() {
    logger_1.default.info('🚀 Starting production-ready Web3 block indexer...');
    logger_1.default.info({
        rpcUrl: config_1.config.RPC_URL,
        pollInterval: `${config_1.config.POLL_INTERVAL_MS}ms`,
        batchSize: process.env.DB_SYNC_BATCH_SIZE || '10',
    }, 'Configuration');
    try {
        // 设置全局错误处理器
        (0, error_handlers_1.setupGlobalErrorHandlers)();
        // 启动健康检查服务器
        const healthServer = await (0, health_server_1.startHealthServer)();
        // 初始化数据库
        await initializeDatabase();
        // 测试初始连接
        logger_1.default.info('Testing initial RPC connection...');
        const initialBlock = await rpcCallWithMetrics('initialBlockNumber', () => client.getBlockNumber());
        logger_1.default.info({ blockNumber: initialBlock.toString() }, 'Initial block number');
        // 执行初始同步
        logger_1.default.info('Performing initial database sync...');
        await syncMissingBlocks();
        // 设置优雅关闭
        (0, error_handlers_1.setupGracefulShutdown)(async () => {
            logger_1.default.info('Shutting down gracefully...');
            isRunning = false;
            // 关闭健康检查服务器
            healthServer.close();
            await (0, database_config_1.closeDbConnection)();
        });
        // 开始实时监控
        logger_1.default.info('✅ Starting real-time monitoring...');
        await pollNewBlocks();
    }
    catch (error) {
        logger_1.default.fatal({ error }, '❌ Failed to start indexer');
        await (0, database_config_1.closeDbConnection)();
        process.exit(1);
    }
}
// 启动程序
main().catch((error) => {
    logger_1.default.fatal({ error }, 'Uncaught error in main');
    process.exit(1);
});
