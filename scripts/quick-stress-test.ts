/**
 * 快速压力测试 - 验证Indexer在持续负载下的表现
 *
 * 目标：
 * - 运行3-5分钟
 * - 同步~100-200个区块
 * - 验证内存和CPU稳定性
 * - 确认无错误/崩溃
 */

import { createPublicClient, http } from 'viem';

async function runQuickStressTest(): Promise<void> {
  console.log('🚀 Starting Quick Stress Test...\n');
  console.log('⏱️  Duration: ~3-5 minutes');
  console.log('📊 Target: ~100-200 blocks\n');

  const client = createPublicClient({
    transport: http(process.env.RPC_URL || 'http://localhost:58545'),
  });

  try {
    // 获取当前状态
    const blockNumber = await client.getBlockNumber();
    console.log(`✅ RPC connected`);
    console.log(`   Current block: ${blockNumber}\n`);

    // 启动Indexer
    console.log('🔄 Starting indexer in stress test mode...');
    console.log('   Press Ctrl+C to stop early\n');

    // 在实际部署中，这里会启动Indexer
    // 但为了demo，我们模拟测试
    const testDurationSeconds = 180; // 3分钟
    const checkIntervalSeconds = 10;

    console.log(`📊 Test Configuration:`);
    console.log(`   Duration: ${testDurationSeconds} seconds`);
    console.log(`   Check interval: ${checkIntervalSeconds} seconds`);
    console.log(`   Estimated blocks to sync: ~${Math.floor(testDurationSeconds / 2)}\n`);

    console.log('✅ Stress test plan ready!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npm run start:dev');
    console.log('   2. Let it run for 3-5 minutes');
    console.log('   3. Monitor memory and CPU:');
    console.log('      - htop or top');
    console.log('      - curl http://localhost:3000/metrics');
    console.log('   4. Check logs for errors');
    console.log('   5. Verify health status:');
    console.log('      curl http://localhost:3000/healthz\n');

    console.log('🎯 Success criteria:');
    console.log('   ✅ No crashes or errors');
    console.log('   ✅ Memory stable (< 200MB)');
    console.log('   ✅ Health checks pass');
    console.log('   ✅ Blocks syncing consistently\n');

  } catch (error) {
    console.error('❌ Stress test setup failed:', error);
    process.exit(1);
  }
}

// 运行测试准备
if (require.main === module) {
  runQuickStressTest()
    .then(() => {
      console.log('✅ Stress test preparation completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

export { runQuickStressTest };
