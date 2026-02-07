// 加载环境变量 - 必须在其他导入之前
import 'dotenv/config';

import { createPublicClient, http } from 'viem';
import { closeDbConnection, createDbConnection } from './database/database-config';
import { BlockRepository } from './database/block-repository';
import logger from './utils/logger';
import { config } from './utils/config';
import { setupGlobalErrorHandlers, setupGracefulShutdown } from './utils/error-handlers';
import { startHealthServer } from './utils/health-server';
import { ErrorHandler } from './utils/error-classifier';

const client = createPublicClient({
  transport: http(config.RPC_URL, {
    timeout: 30_000,
    retryCount: 0,
  }),
});

let blockRepository: BlockRepository;
let isRunning = true;

/**
 * 初始化数据库连接
 */
async function initializeDatabase(): Promise<void> {
  logger.info('Initializing database connection...');

  try {
    await createDbConnection();
    blockRepository = new BlockRepository();

    // 尝试查询，如果表不存在则创建
    try {
      await blockRepository.getBlockCount();
      logger.info('✅ Database tables already exist');
    } catch (error) {
      logger.warn('⚠️  Blocks table not found, creating...');
      const { initDatabase } = await import('./database/init-database');
      await initDatabase();
      logger.info('✅ Database tables created');
    }

    logger.info('✅ Database connection established');
  } catch (error) {
    logger.error({ error }, '❌ Database initialization failed');
    throw error;
  }
}

/**
 * 同步缺失的区块
 */
async function syncMissingBlocks(): Promise<void> {
  try {
    const localMaxBlock = await blockRepository.getMaxBlockNumber();
    let startBlock = localMaxBlock ? localMaxBlock + 1n : 0n;
    const latestBlock = await client.getBlockNumber();

    logger.info({
      localMax: localMaxBlock?.toString() ?? 'none',
      latest: latestBlock.toString(),
      startBlock: startBlock.toString(),
    }, 'Starting initial sync');

    if (startBlock <= latestBlock) {
      const blocksToSync = latestBlock - startBlock + 1n;
      logger.info({ blocksToSync: blocksToSync.toString() }, 'Blocks to sync');

      const batchSize = BigInt(parseInt(process.env.DB_SYNC_BATCH_SIZE || '10'));
      let currentBlock = startBlock;

      while (currentBlock <= latestBlock && isRunning) {
        // 使用三元表达式代替 Math.min
        const batchEnd = currentBlock + batchSize - 1n <= latestBlock
          ? currentBlock + batchSize - 1n
          : latestBlock;

        logger.debug({
          from: currentBlock.toString(),
          to: batchEnd.toString(),
        }, 'Syncing batch');

        await syncBlockBatch(currentBlock, batchEnd);
        currentBlock = batchEnd + 1n;
      }
    } else {
      logger.info('Local database is ahead of chain, no sync needed');
    }
  } catch (error) {
    logger.error({ error }, '❌ Sync missing blocks failed');
    throw error;
  }
}

/**
 * 批量同步区块（改进的错误处理）
 */
async function syncBlockBatch(startBlock: bigint, endBlock: bigint): Promise<void> {
  const rawBlocks: unknown[] = [];
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

        logger.trace({ blockNumber: blockNumber.toString(), hash: block.hash }, 'Fetched block');
      } catch (error) {
        failureCount++;

        // 使用统一的错误处理器，类型断言为 Error
        const handling = ErrorHandler.handleError(error as Error, {
          blockNumber: blockNumber.toString(),
        });

        if (handling.shouldShutdown) {
          logger.error({ blockNumber: blockNumber.toString() }, 'Critical error, shutting down');
          throw error;
        }

        // 如果应该跳过，继续下一个区块
        if (!handling.shouldContinue) {
          logger.warn({ blockNumber: blockNumber.toString() }, 'Skipping block due to error');
        }
      }
      blockNumber = blockNumber + 1n;
    }

    // 记录获取结果
    if (failureCount > 0) {
      logger.warn({
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
          logger.info({
            startBlock: startBlock.toString(),
            endBlock: endBlock.toString(),
            savedCount,
            validationRate: `${((savedCount / rawBlocks.length) * 100).toFixed(1)}%`,
          }, '✅ Batch sync completed');
        } else {
          logger.warn('No valid blocks to save in this batch');
        }
      } catch (error) {
        // 数据库保存错误使用统一处理，类型断言为 Error
        const handling = ErrorHandler.handleError(error as Error, {
          startBlock: startBlock.toString(),
          endBlock: endBlock.toString(),
          blocksAttempted: rawBlocks.length,
        });

        if (!handling.shouldContinue) {
          throw error;
        }
      }
    } else {
      logger.warn({
        startBlock: startBlock.toString(),
        endBlock: endBlock.toString(),
      }, 'No blocks fetched in this batch');
    }
  } catch (error) {
    logger.error({
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
async function pollNewBlocks(): Promise<void> {
  logger.info({
    interval: `${config.POLL_INTERVAL_MS}ms`,
  }, 'Starting real-time monitoring');

  while (isRunning) {
    try {
      const currentBlock = await client.getBlockNumber();
      const localMaxBlock = await blockRepository.getMaxBlockNumber() ?? -1n;

      logger.debug({
        chainBlock: currentBlock.toString(),
        localMax: localMaxBlock.toString(),
      }, 'Polling blocks');

      if (currentBlock > localMaxBlock) {
        const newBlocksCount = currentBlock - localMaxBlock;
        logger.info({
          count: newBlocksCount.toString(),
          from: (localMaxBlock + 1n).toString(),
          to: currentBlock.toString(),
        }, 'Found new blocks to sync');

        await syncBlockBatch(localMaxBlock + 1n, currentBlock);
      }

      // 等待下一次轮询
      await new Promise(resolve => setTimeout(resolve, Number(config.POLL_INTERVAL_MS)));
    } catch (error) {
      logger.error({ error }, 'Polling error');
      throw error; // 让全局错误处理器处理
    }
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  logger.info('🚀 Starting Web3 block number indexer with database sync...');
  logger.info({
    rpcUrl: config.RPC_URL,
    pollInterval: `${config.POLL_INTERVAL_MS}ms`,
    batchSize: process.env.DB_SYNC_BATCH_SIZE || '10',
  }, 'Configuration');

  try {
    // 设置全局错误处理器
    setupGlobalErrorHandlers();

    // 启动健康检查服务器
    const healthServer = await startHealthServer();

    // 初始化数据库
    await initializeDatabase();

    // 测试初始连接
    logger.info('Testing initial RPC connection...');
    const initialBlock = await client.getBlockNumber();
    logger.info({ blockNumber: initialBlock.toString() }, 'Initial block number');

    // 执行初始同步
    logger.info('Performing initial database sync...');
    await syncMissingBlocks();

    // 设置优雅关闭
    setupGracefulShutdown(async () => {
      logger.info('Shutting down gracefully...');
      isRunning = false;

      // 关闭健康检查服务器
      healthServer.close();

      await closeDbConnection();
    });

    // 开始实时监控
    logger.info('✅ Starting real-time monitoring...');
    await pollNewBlocks();
  } catch (error) {
    logger.fatal({ error }, '❌ Failed to start indexer');
    await closeDbConnection();
    process.exit(1);
  }
}

// 启动程序
main().catch((error) => {
  logger.fatal({ error }, 'Uncaught error in main');
  process.exit(1);
});
