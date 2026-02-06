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
// 加载环境变量 - 必须在其他导入之前
require("dotenv/config");
const viem_1 = require("viem");
const database_config_1 = require("./database/database-config");
const block_repository_1 = require("./database/block-repository");
const logger_1 = __importDefault(require("./utils/logger"));
const config_1 = require("./utils/config");
const error_handlers_1 = require("./utils/error-handlers");
const health_server_1 = require("./utils/health-server");
const error_classifier_1 = require("./utils/error-classifier");
const client = (0, viem_1.createPublicClient)({
    transport: (0, viem_1.http)(config_1.config.RPC_URL),
});
let blockRepository;
let isRunning = true;
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
 * 同步缺失的区块
 */
async function syncMissingBlocks() {
    try {
        const localMaxBlock = await blockRepository.getMaxBlockNumber();
        let startBlock = localMaxBlock ? localMaxBlock + 1n : 0n;
        const latestBlock = await client.getBlockNumber();
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
                logger_1.default.debug({
                    from: currentBlock.toString(),
                    to: batchEnd.toString(),
                }, 'Syncing batch');
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
 * 批量同步区块（改进的错误处理）
 */
async function syncBlockBatch(startBlock, endBlock) {
    const rawBlocks = [];
    let successCount = 0;
    let failureCount = 0;
    try {
        // 批量获取区块数据
        let blockNumber = startBlock;
        while (blockNumber <= endBlock) {
            try {
                const block = await client.getBlock({ blockNumber });
                rawBlocks.push(block);
                successCount++;
                logger_1.default.trace({ blockNumber: blockNumber.toString(), hash: block.hash }, 'Fetched block');
            }
            catch (error) {
                failureCount++;
                // 使用统一的错误处理器，类型断言为 Error
                const handling = error_classifier_1.ErrorHandler.handleError(error, {
                    blockNumber: blockNumber.toString(),
                });
                if (handling.shouldShutdown) {
                    logger_1.default.error({ blockNumber: blockNumber.toString() }, 'Critical error, shutting down');
                    throw error;
                }
                // 如果应该跳过，继续下一个区块
                if (!handling.shouldContinue) {
                    logger_1.default.warn({ blockNumber: blockNumber.toString() }, 'Skipping block due to error');
                }
            }
            blockNumber = blockNumber + 1n;
        }
        // 记录获取结果
        if (failureCount > 0) {
            logger_1.default.warn({
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
                successCount,
                failureCount,
            }, 'Block fetching completed with some failures');
        }
        // 使用 Zod 验证并保存区块数据
        if (rawBlocks.length > 0) {
            try {
                const savedCount = await blockRepository.saveValidatedBlocks(rawBlocks);
                if (savedCount > 0) {
                    logger_1.default.info({
                        startBlock: startBlock.toString(),
                        endBlock: endBlock.toString(),
                        savedCount,
                        validationRate: `${((savedCount / rawBlocks.length) * 100).toFixed(1)}%`,
                    }, '✅ Batch sync completed');
                }
                else {
                    logger_1.default.warn('No valid blocks to save in this batch');
                }
            }
            catch (error) {
                // 数据库保存错误使用统一处理，类型断言为 Error
                const handling = error_classifier_1.ErrorHandler.handleError(error, {
                    startBlock: startBlock.toString(),
                    endBlock: endBlock.toString(),
                    blocksAttempted: rawBlocks.length,
                });
                if (!handling.shouldContinue) {
                    throw error;
                }
            }
        }
        else {
            logger_1.default.warn({
                startBlock: startBlock.toString(),
                endBlock: endBlock.toString(),
            }, 'No blocks fetched in this batch');
        }
    }
    catch (error) {
        logger_1.default.error({
            startBlock: startBlock.toString(),
            endBlock: endBlock.toString(),
            successCount,
            failureCount,
            error,
        }, '❌ Block batch sync failed');
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
            const currentBlock = await client.getBlockNumber();
            const localMaxBlock = await blockRepository.getMaxBlockNumber() ?? -1n;
            logger_1.default.debug({
                chainBlock: currentBlock.toString(),
                localMax: localMaxBlock.toString(),
            }, 'Polling blocks');
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
            await new Promise(resolve => setTimeout(resolve, Number(config_1.config.POLL_INTERVAL_MS)));
        }
        catch (error) {
            logger_1.default.error({ error }, 'Polling error');
            throw error; // 让全局错误处理器处理
        }
    }
}
/**
 * 主函数
 */
async function main() {
    logger_1.default.info('🚀 Starting Web3 block number indexer with database sync...');
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
        const initialBlock = await client.getBlockNumber();
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
