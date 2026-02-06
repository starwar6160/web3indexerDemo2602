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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Load environment variables - must be before other imports
require("dotenv/config");
const viem_1 = require("viem");
const database_config_1 = require("./database/database-config");
const block_repository_1 = require("./database/block-repository");
const migration_runner_1 = require("./database/migration-runner");
const logger_1 = __importStar(require("./utils/logger"));
const config_1 = require("./utils/config");
const error_handlers_1 = require("./utils/error-handlers");
const health_server_1 = require("./utils/health-server");
const graceful_shutdown_1 = require("./utils/graceful-shutdown");
const retry_1 = require("./utils/retry");
const rate_limiter_1 = require("./utils/rate-limiter");
const p_limit_1 = __importDefault(require("p-limit"));
const reorg_handler_1 = require("./utils/reorg-handler");
const metrics_collector_1 = require("./utils/metrics-collector");
const client = (0, viem_1.createPublicClient)({
    transport: (0, viem_1.http)(config_1.config.RPC_URL),
});
let blockRepository;
// Global state with proper cleanup tracking
let isRunning = true;
let healthServerInstance = null;
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
        // 🎯 Metrics: Record RPC call latency
        metrics_collector_1.metrics.recordRpcLatency(operation, latency);
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
            // 🟣 Fix R2: Check specific error before assuming table doesn't exist
            // Problem: Any error (e.g., connection lost, permission denied) is assumed to be
            // "table not found", leading to attempting table creation on a potentially
            // more serious problem
            // Solution: Check error code for specific "table not found" error (PostgreSQL 42P01)
            const isTableNotFoundError = error?.code === '42P01' ||
                error?.message?.includes('does not exist') ||
                error?.message?.includes('relation');
            if (!isTableNotFoundError) {
                // This is NOT a "table not found" error - it's something more serious
                logger_1.default.error({ error }, '❌ Database query failed (not a missing table error)');
                throw new Error(`Database initialization failed: ${error?.message || error}. ` +
                    `This is not a missing table error - check database connectivity and permissions.`);
            }
            // Only attempt table creation if we're sure it's a missing table error
            logger_1.default.warn('⚠️  Blocks table not found, creating...');
            const { initDatabase } = await Promise.resolve().then(() => __importStar(require('./database/init-database')));
            await initDatabase();
            logger_1.default.info('✅ Database tables created');
        }
        // Phase 4: Auto-run migrations (idempotent - skips already applied)
        logger_1.default.info('Running automatic migrations...');
        const migrationResults = await (0, migration_runner_1.runMigrations)();
        const appliedCount = migrationResults.filter(r => r.success).length;
        logger_1.default.info({ appliedCount }, '✅ Migrations complete');
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
        const MAX_FAIL_COUNT = 1000; // Prevent overflow on extremely long syncs
        const rawBlocks = [];
        let lastParentHash;
        let successCount = 0;
        let failCount = 0;
        try {
            // P0 Fix: Parallel block fetching with concurrency control using p-limit
            const concurrency = 10; // Configurable: 10 concurrent requests
            const limit = (0, p_limit_1.default)(concurrency);
            // Create array of block numbers to fetch
            const blockNumbersToFetch = [];
            for (let bn = startBlock; bn <= endBlock; bn++) {
                blockNumbersToFetch.push(bn);
            }
            logger_1.default.info({ count: blockNumbersToFetch.length, concurrency }, 'Fetching blocks in parallel');
            // Fetch blocks in parallel with controlled concurrency
            const fetchPromises = blockNumbersToFetch.map((blockNumber) => limit(async () => {
                try {
                    const block = await rpcCallWithMetrics(`getBlock-${blockNumber}`, () => client.getBlock({ blockNumber }));
                    // Sampled logging
                    if (logger_1.logSamplers.perBlock.shouldLog()) {
                        logger_1.default.trace({ blockNumber: blockNumber.toString(), hash: block.hash }, 'Fetched block');
                    }
                    return { success: true, block, blockNumber };
                }
                catch (error) {
                    logger_1.default.error({ error, blockNumber: blockNumber.toString() }, 'Failed to fetch block');
                    return { success: false, error, blockNumber };
                }
            }));
            // Wait for all fetches to complete
            const results = await Promise.all(fetchPromises);
            // Process results
            for (const result of results) {
                if (result.success && result.block) {
                    rawBlocks.push(result.block);
                    lastParentHash = result.block.parentHash;
                }
                else {
                    failCount++;
                }
            }
            // Sort blocks by number to ensure correct order for continuity check
            rawBlocks.sort((a, b) => {
                if (a && typeof a === 'object' && 'number' in a &&
                    b && typeof b === 'object' && 'number' in b) {
                    return Number(a.number) - Number(b.number);
                }
                return 0;
            });
            if (rawBlocks.length === 0) {
                logger_1.default.warn('No blocks fetched in this batch');
                return;
            }
            // Validate chain continuity BEFORE saving (prevent dirty data)
            for (let i = 1; i < rawBlocks.length; i++) {
                const block = rawBlocks[i];
                const prevBlock = rawBlocks[i - 1];
                if (block && typeof block === 'object' && 'number' in block && 'parentHash' in block &&
                    prevBlock && typeof prevBlock === 'object' && 'number' in prevBlock && 'hash' in prevBlock) {
                    // Verify that current block's parentHash matches previous block's hash
                    if (block.parentHash !== prevBlock.hash) {
                        logger_1.default.error({
                            blockNumber: String(block.number),
                            parentHash: block.parentHash,
                            prevBlockNumber: String(prevBlock.number),
                            prevHash: prevBlock.hash,
                        }, 'Chain continuity check failed before save');
                        throw new Error(`Chain continuity broken at block ${block.number}: parentHash ${block.parentHash} does not match previous block hash ${prevBlock.hash}`);
                    }
                }
            }
            // Save in transaction after validation
            const savedCount = await blockRepository.saveValidatedBlocks(rawBlocks);
            // Verify writes with hash check
            const blockNumbers = rawBlocks
                .filter((b) => b !== null && typeof b === 'object' && 'number' in b)
                .map((b) => BigInt(String(b.number)));
            if (blockNumbers.length > 0) {
                const verified = await blockRepository.verifyBlocksWritten(blockNumbers);
                if (!verified) {
                    throw new Error('Block write verification failed after batch save');
                }
                // Additional hash verification for integrity
                for (const block of rawBlocks) {
                    if (block && typeof block === 'object' && 'number' in block && 'hash' in block) {
                        const blockNum = BigInt(String(block.number));
                        const blockHash = String(block.hash);
                        const saved = await blockRepository.findById(blockNum);
                        if (!saved || saved.hash !== blockHash) {
                            logger_1.default.error({
                                blockNumber: blockNum.toString(),
                                expectedHash: blockHash,
                                actualHash: saved?.hash ?? 'not found',
                            }, 'Block hash mismatch after write');
                            throw new Error(`Block ${blockNum} hash verification failed`);
                        }
                    }
                }
            }
            successCount = savedCount;
            failCount = 0; // Reset fail count on successful batch
            logger_1.default.info({
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                successCount,
                failCount,
            }, '✅ Batch sync completed');
            // 🎯 Metrics: Record batch processing time and update counters
            metrics_collector_1.metrics.recordDbWrite(true, Date.now(), rawBlocks.length);
            metrics_collector_1.metrics.incrementBlocksIndexed(rawBlocks.length);
            metrics_collector_1.metrics.updateLastSyncedBlock(endBlock);
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
            const batchSize = BigInt(parseInt(process.env.DB_SYNC_BATCH_SIZE || '10', 10));
            let currentBlock = startBlock;
            while (currentBlock <= latestBlock && isRunning && !(0, graceful_shutdown_1.isShuttingDown)()) {
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
    while (isRunning && !(0, graceful_shutdown_1.isShuttingDown)()) {
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
            // 等待下一次轮询 (with NaN protection)
            const pollInterval = Number(config_1.config.POLL_INTERVAL_MS);
            const safeInterval = Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : 2000;
            await new Promise((resolve) => setTimeout(resolve, safeInterval));
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
        logger_1.default.info('✅ Step 1: Global error handlers configured');
        // 启动健康检查服务器
        healthServerInstance = await (0, health_server_1.startHealthServer)();
        logger_1.default.info('✅ Step 2: Health server started');
        // 初始化数据库
        await initializeDatabase();
        logger_1.default.info('✅ Step 3: Database initialized');
        // 测试初始连接
        logger_1.default.info('Testing initial RPC connection...');
        const initialBlock = await rpcCallWithMetrics('initialBlockNumber', () => client.getBlockNumber());
        logger_1.default.info({ blockNumber: initialBlock.toString() }, '✅ Step 4: RPC connection verified');
        // 执行初始同步
        logger_1.default.info('Performing initial database sync...');
        await syncMissingBlocks();
        logger_1.default.info('✅ Step 5: Initial sync completed');
        // 设置优雅关闭 - RAII风格
        (0, graceful_shutdown_1.setupGracefulShutdown)();
        // 优先级1: 停止接受新请求
        (0, graceful_shutdown_1.registerShutdownHandler)({
            name: 'Health Server',
            priority: 1,
            shutdown: async () => {
                if (!healthServerInstance) {
                    logger_1.default.warn('Health server instance not found');
                    return;
                }
                await new Promise((resolve) => {
                    healthServerInstance.close(() => {
                        logger_1.default.info('[SHUTDOWN] 🌐 Health server - No longer accepting requests');
                        resolve();
                    });
                });
            },
        });
        // 优先级5: 停止同步循环
        (0, graceful_shutdown_1.registerShutdownHandler)({
            name: 'Sync Loop',
            priority: 5,
            shutdown: async () => {
                isRunning = false;
                logger_1.default.info('[SHUTDOWN] 🔄 Sync loop - Signaled to stop');
                // Give in-flight operations time to complete
                await new Promise(resolve => setTimeout(resolve, 1000));
            },
        });
        // 优先级10: 清理数据库连接
        (0, graceful_shutdown_1.registerShutdownHandler)({
            name: 'Database Pool',
            priority: 10,
            shutdown: async () => {
                // 记录最终统计
                const stats = await blockRepository.getBlockCoverageStats();
                logger_1.default.info({
                    totalBlocks: stats.totalBlocks,
                    coverage: stats.coverage,
                }, '[SHUTDOWN] 📊 Final sync statistics');
                await (0, database_config_1.closeDbConnection)();
                logger_1.default.info('[SHUTDOWN] 📦 Database pool - All connections drained');
            },
        });
        // 开始实时监控
        logger_1.default.info('✅ Step 6: Starting real-time monitoring...');
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
