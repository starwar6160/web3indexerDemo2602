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
const viem_1 = require("viem");
const database_config_1 = require("./database/database-config");
const block_repository_1 = require("./database/block-repository");
const ANVIL_RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000'); // 2 seconds
const DB_SYNC_BATCH_SIZE = BigInt(parseInt(process.env.DB_SYNC_BATCH_SIZE || '10')); // 同步批次大小 - 使用 BigInt
const client = (0, viem_1.createPublicClient)({
    transport: (0, viem_1.http)(ANVIL_RPC_URL),
});
let blockRepository;
let retryCount = 0;
const MAX_RETRIES = 3;
let isRunning = true;
async function initializeDatabase() {
    console.log(`[${new Date().toISOString()}] Initializing database connection...`);
    try {
        // 创建数据库连接
        await (0, database_config_1.createDbConnection)();
        blockRepository = new block_repository_1.BlockRepository();
        // 尝试查询 blocks 表，如果不存在则创建
        try {
            await blockRepository.getBlockCount();
            console.log(`[${new Date().toISOString()}] ✅ Database tables already exist`);
        }
        catch (error) {
            console.log(`[${new Date().toISOString()}] ⚠️  Blocks table not found, creating...`);
            const { initDatabase } = await Promise.resolve().then(() => __importStar(require('./database/init-database')));
            await initDatabase();
        }
        console.log(`[${new Date().toISOString()}] ✅ Database connection established`);
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Database initialization failed:`, error);
        throw error;
    }
}
async function syncMissingBlocks() {
    try {
        // 获取本地数据库中的最大区块号
        const localMaxBlock = await blockRepository.getMaxBlockNumber();
        let startBlock = localMaxBlock ? BigInt(localMaxBlock) + BigInt(1) : BigInt(0);
        // 获取链上当前最新区块号
        const latestBlock = await client.getBlockNumber();
        console.log(`[${new Date().toISOString()}] Local max block: ${localMaxBlock ?? 'none'}`);
        console.log(`[${new Date().toISOString()}] Latest block on chain: ${latestBlock}`);
        console.log(`[${new Date().toISOString()}] Syncing from block: ${startBlock}`);
        // 如果本地最新区块落后于链上，同步缺失的区块
        if (startBlock <= latestBlock) {
            const blocksToSync = latestBlock - startBlock + BigInt(1);
            console.log(`[${new Date().toISOString()}] Need to sync ${blocksToSync} blocks`);
            // 分批同步以避免内存问题和 RPC 限制
            let currentBlock = startBlock;
            while (currentBlock <= latestBlock && isRunning) {
                // 使用三元表达式代替 Math.min，因为 Math.min 不支持 BigInt
                const batchEnd = currentBlock + DB_SYNC_BATCH_SIZE - 1n <= latestBlock
                    ? currentBlock + DB_SYNC_BATCH_SIZE - 1n
                    : latestBlock;
                console.log(`[${new Date().toISOString()}] Syncing batch: ${currentBlock} to ${batchEnd}`);
                await syncBlockBatch(currentBlock, batchEnd);
                currentBlock = batchEnd + 1n; // 使用 1n 代替 BigInt(1)
            }
        }
        else {
            console.log(`[${new Date().toISOString()}] Local database is ahead of chain, no sync needed`);
        }
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Sync missing blocks failed:`, error);
        throw error;
    }
}
async function syncBlockBatch(startBlock, endBlock) {
    const rawBlocks = [];
    try {
        // 批量获取区块数据 - 使用 while 循环避免 BigInt 增量问题
        let blockNumber = startBlock;
        while (blockNumber <= endBlock) {
            try {
                const block = await client.getBlock({ blockNumber });
                rawBlocks.push(block);
                // 实时输出进度
                console.log(`[${new Date().toISOString()}] Fetched block ${blockNumber}: ${block.hash}`);
            }
            catch (error) {
                console.error(`[${new Date().toISOString()}] Failed to fetch block ${blockNumber}:`, error);
                // 继续尝试下一个区块，不要因为单个区块失败而中断整个批次
            }
            blockNumber = blockNumber + 1n; // 使用 1n 进行 BigInt 增量
        }
        // 使用 Zod 验证并保存区块数据
        if (rawBlocks.length > 0) {
            const savedCount = await blockRepository.saveValidatedBlocks(rawBlocks);
            if (savedCount > 0) {
                console.log(`[${new Date().toISOString()}] ✅ Batch sync completed: ${savedCount} blocks saved`);
            }
            else {
                console.log(`[${new Date().toISOString()}] ⚠️  No valid blocks to save in this batch`);
            }
        }
        else {
            console.log(`[${new Date().toISOString()}] ⚠️  No blocks fetched in this batch`);
        }
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Block batch sync failed:`, error);
        throw error;
    }
}
async function pollNewBlocks() {
    while (isRunning) {
        try {
            const currentBlock = await client.getBlockNumber();
            const localMaxBlock = await blockRepository.getMaxBlockNumber() ?? BigInt(-1);
            console.log(`[${new Date().toISOString()}] Chain block: ${currentBlock.toString()}, Local max: ${localMaxBlock.toString()}`);
            // 检查是否有新区块需要同步
            if (currentBlock > localMaxBlock) {
                const newBlocksCount = currentBlock - localMaxBlock;
                console.log(`[${new Date().toISOString()}] Found ${newBlocksCount} new blocks to sync`);
                // 同步新区块 - 使用 1n 代替 BigInt(1)
                await syncBlockBatch(localMaxBlock + 1n, currentBlock);
            }
            else {
                console.log(`[${new Date().toISOString()}] No new blocks to sync`);
            }
            // Wait for the next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
        catch (error) {
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                console.error(`[${new Date().toISOString()}] Polling failed after ${MAX_RETRIES} attempts:`, error);
                // 重置重试计数并等待更长时间再试
                retryCount = 0;
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }
            console.warn(`[${new Date().toISOString()}] Polling error (attempt ${retryCount}/${MAX_RETRIES}):`, error);
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
async function main() {
    console.log(`[${new Date().toISOString()}] 🚀 Starting Web3 block number indexer with database sync...`);
    console.log(`[${new Date().toISOString()}] RPC URL: ${ANVIL_RPC_URL}`);
    console.log(`[${new Date().toISOString()}] Poll interval: ${POLL_INTERVAL}ms`);
    console.log(`[${new Date().toISOString()}] Max retries: ${MAX_RETRIES}`);
    console.log(`[${new Date().toISOString()}] Database sync batch size: ${DB_SYNC_BATCH_SIZE}`);
    try {
        // 初始化数据库
        await initializeDatabase();
        // 测试初始连接
        console.log(`[${new Date().toISOString()}] Testing initial RPC connection...`);
        const initialBlock = await client.getBlockNumber();
        console.log(`[${new Date().toISOString()}] Initial block number: ${initialBlock}`);
        // 执行初始同步
        console.log(`[${new Date().toISOString()}] Performing initial database sync...`);
        await syncMissingBlocks();
        // 开始实时监控
        console.log(`[${new Date().toISOString()}] Starting real-time monitoring...`);
        pollNewBlocks();
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Failed to start indexer:`, error);
        await (0, database_config_1.closeDbConnection)();
        process.exit(1);
    }
}
// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log(`\n[${new Date().toISOString()}] Received SIGINT. Shutting down gracefully...`);
    isRunning = false;
    (0, database_config_1.closeDbConnection)().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
    console.log(`\n[${new Date().toISOString()}] Received SIGTERM. Shutting down gracefully...`);
    isRunning = false;
    (0, database_config_1.closeDbConnection)().then(() => process.exit(0));
});
main().catch(error => {
    console.error(`[${new Date().toISOString()}] Uncaught error in main:`, error);
    process.exit(1);
});
