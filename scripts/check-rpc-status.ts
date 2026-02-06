/**
 * 检查RPC状态和压力测试准备
 */

import { createPublicClient, http } from 'viem';

async function checkRpcStatus(): Promise<void> {
  console.log('🔍 Checking RPC status...\n');

  const client = createPublicClient({
    transport: http(process.env.RPC_URL || 'http://localhost:8545'),
  });

  try {
    const blockNumber = await client.getBlockNumber();
    console.log(`✅ RPC connected`);
    console.log(`   Current block: ${blockNumber}`);
    console.log(`   Blocks in DB: 6366`);
    console.log(`   Blocks to sync: ${Number(blockNumber) - 6366}\n`);

    // 计算预估时间
    const blocksToSync = Number(blockNumber) - 6366;
    const blocksPerSecond = 2; // 基于之前的测试
    const seconds = blocksToSync / blocksPerSecond;
    const minutes = seconds / 60;
    const hours = minutes / 60;

    console.log('📊 Estimated sync time (at 2 blocks/sec):');
    console.log(`   Seconds: ${seconds.toFixed(0)}`);
    console.log(`   Minutes: ${minutes.toFixed(1)}`);
    console.log(`   Hours: ${hours.toFixed(2)}\n`);

    // 如果测试模式下区块数较少
    if (blocksToSync < 10000) {
      console.log('✅ This is a quick test run (< 10K blocks)');
      console.log('   Perfect for stress testing!\n');
    } else {
      console.log('ℹ️  For a full stress test, consider:');
      console.log('   1. Using a testnet with more blocks');
      console.log('   2. Or testing with sync from scratch\n');
    }

    // 内存使用预估
    const estimatedMemoryMB = (blocksToSync * 0.001) + 80; // ~80MB base + 1KB per 1000 blocks
    console.log('💾 Estimated memory usage:');
    console.log(`   ${estimatedMemoryMB.toFixed(0)} MB\n`);

  } catch (error) {
    console.error('❌ Failed to connect to RPC:', error);
    process.exit(1);
  }
}

// 运行检查
if (require.main === module) {
  checkRpcStatus()
    .then(() => {
      console.log('✅ RPC status check completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Check failed:', error);
      process.exit(1);
    });
}

export { checkRpcStatus };
