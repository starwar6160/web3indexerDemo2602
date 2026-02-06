// Load environment variables - must be before other imports
import 'dotenv/config';

import { createPublicClient, http } from 'viem';
import { closeDbConnection, createDbConnection } from './database/database-config';
import { BlockRepository } from './database/block-repository';
import { runMigrations } from './database/migration-runner';
import logger, { logSamplers, generateTraceId, withTraceId } from './utils/logger';
import { config } from './utils/config';
import { setupGlobalErrorHandlers } from './utils/error-handlers';
import { startHealthServer, recordRpcCall } from './utils/health-server';
import { setupGracefulShutdown, registerShutdownHandler, isShuttingDown as checkIsShuttingDown } from './utils/graceful-shutdown';
import { retryWithBackoffSelective } from './utils/retry';
import { TokenBucketRateLimiter } from './utils/rate-limiter';
import pLimit from 'p-limit';
import {
  detectReorg,
  verifyChainContinuity,
  handleReorg,
} from './utils/reorg-handler';
import { metrics } from './utils/metrics-collector';

const client = createPublicClient({
  transport: http(config.RPC_URL),
});

let blockRepository: BlockRepository;
// Global state with proper cleanup tracking
let isRunning = true;
let healthServerInstance: ReturnType<typeof startHealthServer> | null = null;

// Rate limiter: 10 requests per second with burst of 20
const rateLimiter = new TokenBucketRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 1000,
  maxBurstTokens: 20,
});

/**
 * Wrapper for RPC calls with rate limiting, metrics, and retries
 */
async function rpcCallWithMetrics<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  // Apply rate limiting
  await rateLimiter.consume(1);

  try {
    const result = await retryWithBackoffSelective(
      fn,
      (error) => {
        // Retry on network errors and rate limits
        const errorMessage = error.message.toLowerCase();
        return (
          errorMessage.includes('network') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('429')
        );
      },
      {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 5000,
      }
    );

    if (!result.success) {
      throw result.error || new Error('RPC call failed');
    }

    const latency = Date.now() - startTime;
    recordRpcCall(true, latency);

    // 🎯 Metrics: Record RPC call latency
    metrics.recordRpcLatency(operation, latency);

    return result.data as T;
  } catch (error) {
    const latency = Date.now() - startTime;
    recordRpcCall(false, latency);

    logger.error({ error, operation }, 'RPC call failed');
    throw error;
  }
}

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
    } catch (error: any) {
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
        logger.error({ error }, '❌ Database query failed (not a missing table error)');
        throw new Error(
          `Database initialization failed: ${error?.message || error}. ` +
          `This is not a missing table error - check database connectivity and permissions.`
        );
      }

      // Only attempt table creation if we're sure it's a missing table error
      logger.warn('⚠️  Blocks table not found, creating...');
      const { initDatabase } = await import('./database/init-database');
      await initDatabase();
      logger.info('✅ Database tables created');
    }

    // Phase 4: Auto-run migrations (idempotent - skips already applied)
    logger.info('Running automatic migrations...');
    const migrationResults = await runMigrations();
    const appliedCount = migrationResults.filter(r => r.success).length;
    logger.info({ appliedCount }, '✅ Migrations complete');

    logger.info('✅ Database connection established');
  } catch (error) {
    logger.error({ error }, '❌ Database initialization failed');
    throw error;
  }
}

/**
 * 同步单个区块(带重组检测和验证)
 */
async function syncBlockWithValidation(
  blockNumber: bigint,
  parentHash?: string
): Promise<boolean> {
  try {
    // Fetch block with rate limiting and retry
    const block = await rpcCallWithMetrics(
      `getBlock-${blockNumber}`,
      () => client.getBlock({ blockNumber })
    );

    // Verify chain continuity (check parent exists)
    await verifyChainContinuity(blockRepository, block.number, block.parentHash);

    // Check for reorg if we have previous block info
    if (parentHash) {
      const reorgResult = await detectReorg(
        blockRepository,
        block.hash,
        block.number,
        parentHash
      );

      if (reorgResult.detected && reorgResult.commonAncestor !== undefined) {
        logger.warn(
          {
            blockNumber: block.number.toString(),
            depth: reorgResult.reorgDepth,
            commonAncestor: reorgResult.commonAncestor.toString(),
          },
          'Reorganization detected, rolling back...'
        );

        await handleReorg(blockRepository, reorgResult.commonAncestor);

        // After rollback, re-verify continuity
        await verifyChainContinuity(blockRepository, block.number, block.parentHash);
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
      if (logSamplers.perBlock.shouldLog()) {
        const suppressed = logSamplers.perBlock.getSuppressedCount();
        logger.info(
          {
            blockNumber: block.number.toString(),
            hash: block.hash,
            suppressedLogs: suppressed,
          },
          '✅ Block synced'
        );
      }
      return true;
    }

    return false;
  } catch (error) {
    logger.error(
      { error, blockNumber: blockNumber.toString() },
      'Failed to sync block'
    );
    throw error;
  }
}

/**
 * 批量同步区块(带事务和重组检测)
 */
async function syncBlockBatch(
  startBlock: bigint,
  endBlock: bigint
): Promise<void> {
  const traceId = generateTraceId();

  await withTraceId(async () => {
    logger.info(
      {
        startBlock: startBlock.toString(),
        endBlock: endBlock.toString(),
        count: (endBlock - startBlock + 1n).toString(),
      },
      'Starting batch sync'
    );

    const MAX_FAIL_COUNT = 1000; // Prevent overflow on extremely long syncs
    const rawBlocks: unknown[] = [];
    let lastParentHash: string | undefined;
    let successCount = 0;
    let failCount = 0;

    try {
      // P0 Fix: Parallel block fetching with concurrency control using p-limit
      const concurrency = 10; // Configurable: 10 concurrent requests
      const limit = pLimit(concurrency);

      // Create array of block numbers to fetch
      const blockNumbersToFetch: bigint[] = [];
      for (let bn = startBlock; bn <= endBlock; bn++) {
        blockNumbersToFetch.push(bn);
      }

      logger.info(
        { count: blockNumbersToFetch.length, concurrency },
        'Fetching blocks in parallel'
      );

      // Fetch blocks in parallel with controlled concurrency
      const fetchPromises = blockNumbersToFetch.map((blockNumber) =>
        limit(async () => {
          try {
            const block = await rpcCallWithMetrics(
              `getBlock-${blockNumber}`,
              () => client.getBlock({ blockNumber })
            );

            // Sampled logging
            if (logSamplers.perBlock.shouldLog()) {
              logger.trace(
                { blockNumber: blockNumber.toString(), hash: block.hash },
                'Fetched block'
              );
            }

            return { success: true, block, blockNumber };
          } catch (error) {
            logger.error(
              { error, blockNumber: blockNumber.toString() },
              'Failed to fetch block'
            );
            return { success: false, error, blockNumber };
          }
        })
      );

      // Wait for all fetches to complete
      const results = await Promise.all(fetchPromises);

      // Process results
      for (const result of results) {
        if (result.success && result.block) {
          rawBlocks.push(result.block);
          lastParentHash = result.block.parentHash;
        } else {
          failCount++;
        }
      }

      // Sort blocks by number to ensure correct order for continuity check
      rawBlocks.sort((a: any, b: any) => {
        if (a && typeof a === 'object' && 'number' in a &&
            b && typeof b === 'object' && 'number' in b) {
          return Number(a.number) - Number(b.number);
        }
        return 0;
      });

      if (rawBlocks.length === 0) {
        logger.warn('No blocks fetched in this batch');
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
            logger.error(
              {
                blockNumber: String(block.number),
                parentHash: block.parentHash,
                prevBlockNumber: String(prevBlock.number),
                prevHash: prevBlock.hash,
              },
              'Chain continuity check failed before save'
            );
            throw new Error(
              `Chain continuity broken at block ${block.number}: parentHash ${block.parentHash} does not match previous block hash ${prevBlock.hash}`
            );
          }
        }
      }

      // Save in transaction after validation
      const savedCount = await blockRepository.saveValidatedBlocks(rawBlocks);

      // Verify writes with hash check
      const blockNumbers = rawBlocks
        .filter((b): b is object => b !== null && typeof b === 'object' && 'number' in b)
        .map((b) => BigInt(String((b as any).number)));

      if (blockNumbers.length > 0) {
        const verified = await blockRepository.verifyBlocksWritten(blockNumbers);

        if (!verified) {
          throw new Error('Block write verification failed after batch save');
        }

        // Additional hash verification for integrity
        for (const block of rawBlocks) {
          if (block && typeof block === 'object' && 'number' in block && 'hash' in block) {
            const blockNum = BigInt(String((block as any).number));
            const blockHash = String((block as any).hash);
            const saved = await blockRepository.findById(blockNum);
            if (!saved || saved.hash !== blockHash) {
              logger.error(
                {
                  blockNumber: blockNum.toString(),
                  expectedHash: blockHash,
                  actualHash: saved?.hash ?? 'not found',
                },
                'Block hash mismatch after write'
              );
              throw new Error(`Block ${blockNum} hash verification failed`);
            }
          }
        }
      }

      successCount = savedCount;
      failCount = 0; // Reset fail count on successful batch

      logger.info(
        {
          startBlock: startBlock.toString(),
          endBlock: endBlock.toString(),
          successCount,
          failCount,
        },
        '✅ Batch sync completed'
      );

      // 🎯 Metrics: Record batch processing time and update counters
      metrics.recordDbWrite(true, Date.now(), rawBlocks.length);
      metrics.incrementBlocksIndexed(rawBlocks.length);
      metrics.updateLastSyncedBlock(endBlock);
    } catch (error) {
      logger.error(
        {
          startBlock: startBlock.toString(),
          endBlock: endBlock.toString(),
          error,
        },
        '❌ Block batch sync failed'
      );
      throw error;
    }
  });
}

/**
 * 同步缺失的区块
 */
async function syncMissingBlocks(): Promise<void> {
  try {
    const localMaxBlock = await blockRepository.getMaxBlockNumber();
    let startBlock = localMaxBlock ? localMaxBlock + 1n : 0n;
    const latestBlock = await rpcCallWithMetrics('getBlockNumber', () =>
      client.getBlockNumber()
    );

    logger.info(
      {
        localMax: localMaxBlock?.toString() ?? 'none',
        latest: latestBlock.toString(),
        startBlock: startBlock.toString(),
      },
      'Starting initial sync'
    );

    if (startBlock <= latestBlock) {
      const blocksToSync = latestBlock - startBlock + 1n;
      logger.info(
        { blocksToSync: blocksToSync.toString() },
        'Blocks to sync'
      );

      const batchSize = BigInt(
        parseInt(process.env.DB_SYNC_BATCH_SIZE || '10', 10)
      );
      let currentBlock = startBlock;

      while (currentBlock <= latestBlock && isRunning && !checkIsShuttingDown()) {
        // 使用三元表达式代替 Math.min
        const batchEnd =
          currentBlock + batchSize - 1n <= latestBlock
            ? currentBlock + batchSize - 1n
            : latestBlock;

        if (logSamplers.perBatch.shouldLog()) {
          logger.debug(
            {
              from: currentBlock.toString(),
              to: batchEnd.toString(),
            },
            'Syncing batch'
          );
        }

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
 * 轮询新区块
 */
async function pollNewBlocks(): Promise<void> {
  logger.info(
    {
      interval: `${config.POLL_INTERVAL_MS}ms`,
    },
    'Starting real-time monitoring'
  );

  while (isRunning && !checkIsShuttingDown()) {
    try {
      const currentBlock = await rpcCallWithMetrics(
        'pollBlockNumber',
        () => client.getBlockNumber()
      );
      const localMaxBlock =
        (await blockRepository.getMaxBlockNumber()) ?? -1n;

      if (logSamplers.perBatch.shouldLog()) {
        logger.debug(
          {
            chainBlock: currentBlock.toString(),
            localMax: localMaxBlock.toString(),
          },
          'Polling blocks'
        );
      }

      if (currentBlock > localMaxBlock) {
        const newBlocksCount = currentBlock - localMaxBlock;
        logger.info(
          {
            count: newBlocksCount.toString(),
            from: (localMaxBlock + 1n).toString(),
            to: currentBlock.toString(),
          },
          'Found new blocks to sync'
        );

        await syncBlockBatch(localMaxBlock + 1n, currentBlock);
      }

      // 等待下一次轮询 (with NaN protection)
      const pollInterval = Number(config.POLL_INTERVAL_MS);
      const safeInterval = Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : 2000;
      await new Promise((resolve) => setTimeout(resolve, safeInterval));
    } catch (error) {
      logger.error({ error }, 'Polling error');
      // Don't throw - let polling continue
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait before retry
    }
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  logger.info('🚀 Starting production-ready Web3 block indexer...');
  logger.info({
    rpcUrl: config.RPC_URL,
    pollInterval: `${config.POLL_INTERVAL_MS}ms`,
    batchSize: process.env.DB_SYNC_BATCH_SIZE || '10',
  }, 'Configuration');

  try {
    // 设置全局错误处理器
    setupGlobalErrorHandlers();
    logger.info('✅ Step 1: Global error handlers configured');

    // 启动健康检查服务器
    healthServerInstance = await startHealthServer();
    logger.info('✅ Step 2: Health server started');

    // 初始化数据库
    await initializeDatabase();
    logger.info('✅ Step 3: Database initialized');

    // 测试初始连接
    logger.info('Testing initial RPC connection...');
    const initialBlock = await rpcCallWithMetrics(
      'initialBlockNumber',
      () => client.getBlockNumber()
    );
    logger.info(
      { blockNumber: initialBlock.toString() },
      '✅ Step 4: RPC connection verified'
    );

    // 执行初始同步
    logger.info('Performing initial database sync...');
    await syncMissingBlocks();
    logger.info('✅ Step 5: Initial sync completed');

    // 设置优雅关闭 - RAII风格
    setupGracefulShutdown();

    // 优先级1: 停止接受新请求
    registerShutdownHandler({
      name: 'Health Server',
      priority: 1,
      shutdown: async () => {
        if (!healthServerInstance) {
          logger.warn('Health server instance not found');
          return;
        }
        await new Promise<void>((resolve) => {
          healthServerInstance!.close(() => {
            logger.info('[SHUTDOWN] 🌐 Health server - No longer accepting requests');
            resolve();
          });
        });
      },
    });

    // 优先级5: 停止同步循环
    registerShutdownHandler({
      name: 'Sync Loop',
      priority: 5,
      shutdown: async () => {
        isRunning = false;
        logger.info('[SHUTDOWN] 🔄 Sync loop - Signaled to stop');
        // Give in-flight operations time to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
      },
    });

    // 优先级10: 清理数据库连接
    registerShutdownHandler({
      name: 'Database Pool',
      priority: 10,
      shutdown: async () => {
        // 记录最终统计
        const stats = await blockRepository.getBlockCoverageStats();
        logger.info({
          totalBlocks: stats.totalBlocks,
          coverage: stats.coverage,
        }, '[SHUTDOWN] 📊 Final sync statistics');

        await closeDbConnection();
        logger.info('[SHUTDOWN] 📦 Database pool - All connections drained');
      },
    });

    // 开始实时监控
    logger.info('✅ Step 6: Starting real-time monitoring...');
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
