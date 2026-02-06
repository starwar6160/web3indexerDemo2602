import { config } from 'dotenv';
import { createDbConnection, closeDbConnection } from './database/database-config';
import { CheckpointRepository } from './database/checkpoint-repository';
import { SyncEngine } from './sync-engine';
import { DistributedLock, AppLock } from './database/distributed-lock';
import { initLockTable } from './database/init-lock-table';
import { randomUUID } from 'crypto';

// Load environment variables
config();

const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000'); // 5 seconds
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100'); // 100 blocks per batch
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');
const CONFIRMATION_DEPTH = parseInt(process.env.CONFIRMATION_DEPTH || '12'); // P5 Fix: Default 12 blocks (~2 min on Ethereum)
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10'); // P1 Fix: Parallel fetch concurrency
const TOKEN_CONTRACT_ADDRESS = process.env.TOKEN_CONTRACT_ADDRESS; // ERC20 token to monitor for Transfer events
const INSTANCE_ID = process.env.INSTANCE_ID || randomUUID(); // Unique instance identifier

let isRunning = true;

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] 🚀 Starting Enhanced Web3 Block Indexer`);
  console.log(`[${new Date().toISOString()}] Instance ID: ${INSTANCE_ID}`);
  console.log(`[${new Date().toISOString()}] RPC URL: ${RPC_URL}`);
  console.log(`[${new Date().toISOString()}] Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`[${new Date().toISOString()}] Batch size: ${BATCH_SIZE}`);
  console.log(`[${new Date().toISOString()}] Max retries: ${MAX_RETRIES}`);
  console.log(`[${new Date().toISOString()}] Confirmation depth: ${CONFIRMATION_DEPTH} (P5 Fix: prevents reorg storms)`);
  console.log(`[${new Date().toISOString()}] Concurrency: ${CONCURRENCY} (P1 Fix: parallel fetch)`);
  console.log(`[${new Date().toISOString()}] Token contract: ${TOKEN_CONTRACT_ADDRESS || 'None (Transfer event indexing disabled)'}`);

  // Initialize database
  console.log(`[${new Date().toISOString()}] Initializing database...`);
  await createDbConnection();

  // Initialize lock table (P2 Fix)
  await initLockTable();
  const appLock = new AppLock();
  await appLock.cleanupExpiredLocks();
  console.log(`[${new Date().toISOString()}] ✅ Distributed lock system initialized`);

  // Initialize checkpoint repository
  const checkpointRepo = new CheckpointRepository();
  await checkpointRepo.initialize();
  console.log(`[${new Date().toISOString()}] ✅ Checkpoint system initialized`);

  // Create sync engine
  const syncEngine = new SyncEngine({
    rpcUrl: RPC_URL,
    batchSize: BATCH_SIZE,
    maxRetries: MAX_RETRIES,
    retryDelayMs: 1000,
    confirmationDepth: CONFIRMATION_DEPTH,
    concurrency: CONCURRENCY, // P1 Fix
    rpcTimeout: 30000, // P4 Fix: 30s timeout
    fetchLogs: true, // Enable Transfer event fetching
    tokenContract: TOKEN_CONTRACT_ADDRESS as any, // ERC20 token contract to monitor
  });

  // Check for existing checkpoint
  const checkpoint = await checkpointRepo.getLatestCheckpoint();
  if (checkpoint) {
    console.log(`[${new Date().toISOString()}] 📍 Found checkpoint at block ${checkpoint.block_number}`);
  }

  // Initial sync and gap repair with distributed lock (P2 Fix)
  console.log(`[${new Date().toISOString()}] 🔄 Running initial sync and gap repair...`);

  try {
    // P2 Fix: Acquire distributed lock before syncing
    const lock = new DistributedLock('block-sync');
    const acquired = await lock.acquire();

    if (!acquired) {
      console.warn(`[${new Date().toISOString()}] ⚠️  Another instance is already syncing. Exiting.`);
      console.warn(`[${new Date().toISOString()}] 💡 To force sync, release the lock or wait for it to expire.`);
      await closeDbConnection();
      process.exit(0);
    }

    try {
      // First, repair any gaps
      await syncEngine.repairGaps();

      // Then sync to tip
      await syncEngine.syncToTip();

      // Show statistics
      await syncEngine.getStats();

      // Save checkpoint
      const chainTip = await syncEngine['client'].getBlockNumber();
      const tipBlock = await syncEngine['blockRepository'].getMaxBlockNumber();
      const latestBlock = tipBlock ? await syncEngine['blockRepository'].findById(tipBlock) : null;

      if (latestBlock) {
        await checkpointRepo.saveCheckpoint({
          name: 'latest',
          block_number: latestBlock.number,
          block_hash: latestBlock.hash,
          metadata: {
            chain_tip: chainTip.toString(),
            confirmation_depth: CONFIRMATION_DEPTH,
            instance_id: INSTANCE_ID,
          },
        });
        console.log(`[${new Date().toISOString()}] ✅ Checkpoint saved at block ${latestBlock.number}`);
      }

      // Clean up old checkpoints
      const cleaned = await checkpointRepo.cleanupOldCheckpoints(10);
      if (cleaned > 0) {
        console.log(`[${new Date().toISOString()}] 🧹 Cleaned up ${cleaned} old checkpoints`);
      }
    } finally {
      // P2 Fix: Always release lock
      await lock.release();
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Initial sync failed:`, error);
    throw error;
  }

  // Start polling loop
  console.log(`[${new Date().toISOString()}] 🔍 Starting continuous monitoring...`);

  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  while (isRunning) {
    try {
      await syncEngine.syncToTip();

      // Update checkpoint periodically
      const latestBlock = await syncEngine['blockRepository'].getMaxBlockNumber();
      if (latestBlock) {
        const block = await syncEngine['blockRepository'].findById(latestBlock);
        if (block) {
          await checkpointRepo.saveCheckpoint({
            name: 'latest',
            block_number: block.number,
            block_hash: block.hash,
            metadata: {
              chain_tip: (await syncEngine['client'].getBlockNumber()).toString(),
              instance_id: INSTANCE_ID,
            },
          });
        }
      }

      // Reset error counter on success
      consecutiveErrors = 0;

      // Wait for next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } catch (error) {
      consecutiveErrors++;

      console.error(
        `[${new Date().toISOString()}] ❌ Sync error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
        error
      );

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[${new Date().toISOString()}] ❌ Too many consecutive errors, shutting down`);
        throw error;
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

// ============================================================================
// SpaceX哲学: 边界层异常处理（唯一允许catch的地方）
// ============================================================================

/**
 * 致命错误处理器
 *
 * 规则：
 * - 记录完整日志（带telemetry）
 * - 优雅退出（让容器重启）
 * - 不要尝试恢复
 *
 * 原因：
 * - 未捕获异常 = 未知状态
 * - 未知状态 = 必须重启
 * - Docker/systemd会自动重启我们
 */
function fatal(error: Error, context: string) {
  const timestamp = new Date().toISOString();
  const errorMsg = {
    timestamp,
    context,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    instanceId: INSTANCE_ID,
  };

  // 结构化日志输出（JSON格式，方便日志聚合）
  console.error(JSON.stringify({ level: 'FATAL', ...errorMsg }));

  // 立即退出（非0状态码触发容器重启）
  process.exit(1);
}

// 未处理的Promise rejection
process.on('unhandledRejection', (reason, promise) => {
  fatal(
    reason instanceof Error ? reason : new Error(String(reason)),
    'unhandledRejection'
  );
});

// 未捕获的异常
process.on('uncaughtException', (error) => {
  fatal(error, 'uncaughtException');
});

// 优雅关闭信号
process.on('SIGINT', async () => {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    level: 'INFO',
    timestamp,
    message: 'Received SIGINT. Shutting down gracefully.',
    instanceId: INSTANCE_ID,
  }));

  isRunning = false;
  await closeDbConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    level: 'INFO',
    timestamp,
    message: 'Received SIGTERM. Shutting down gracefully.',
    instanceId: INSTANCE_ID,
  }));

  isRunning = false;
  await closeDbConnection();
  process.exit(0);
});

// ============================================================================
// 边界层：main函数（唯一的try-catch位置）
// ============================================================================

main().catch(error => {
  fatal(error, 'main_function');
});
