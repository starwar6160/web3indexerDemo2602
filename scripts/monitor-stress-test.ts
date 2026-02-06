/**
 * 压力测试监控脚本
 * 每10秒检查一次指标，持续3分钟
 */

import { writeFileSync, appendFileSync, readFileSync } from 'fs';

interface MetricsSnapshot {
  timestamp: string;
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
  };
  blockCount: string;
  syncLag: number;
  rpcLatency: number;
  rpcErrorRate: number;
}

const RESULTS_FILE = '/tmp/stress-test-results.json';

async function monitorStressTest(): Promise<void> {
  console.log('📊 Starting stress test monitoring...\n');
  console.log('⏱️  Duration: 3 minutes (180 seconds)');
  console.log('📈 Check interval: 10 seconds');
  console.log('🎯 Target: ~18 snapshots\n');

  const snapshots: MetricsSnapshot[] = [];
  const duration = 180; // 3 minutes
  const interval = 10; // 10 seconds
  const iterations = duration / interval;

  console.log('Starting monitoring...\n');

  for (let i = 0; i < iterations; i++) {
    try {
      const response = await fetch('http://localhost:3000/metrics');
      const data = await response.json() as {
        indexer: {
          uptime: number;
          memory: { rss: number; heapUsed: number };
          blockCount: string;
          syncLag: number;
        };
        rpc: {
          latency: number;
          errorRate: number;
        };
      };

      const snapshot: MetricsSnapshot = {
        timestamp: new Date().toISOString(),
        uptime: data.indexer.uptime,
        memory: {
          rss: data.indexer.memory.rss,
          heapUsed: data.indexer.memory.heapUsed,
        },
        blockCount: data.indexer.blockCount,
        syncLag: data.indexer.syncLag,
        rpcLatency: data.rpc.latency,
        rpcErrorRate: data.rpc.errorRate,
      };

      snapshots.push(snapshot);

      const memoryMB = (snapshot.memory.rss / 1024 / 1024).toFixed(1);
      const blocks = snapshot.blockCount;
      const lag = snapshot.syncLag;

      console.log(`[${i + 1}/${iterations}] ✅ ${new Date().toLocaleTimeString()}`);
      console.log(`   Blocks: ${blocks} | Lag: ${lag} | Memory: ${memoryMB}MB | RPC: ${snapshot.rpcLatency}ms`);
      console.log('');

      // 保存到文件
      writeFileSync(RESULTS_FILE, JSON.stringify(snapshots, null, 2));

      if (i < iterations - 1) {
        // 等待10秒（除了最后一次）
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
      }
    } catch (error) {
      console.error(`❌ Error fetching metrics: ${error}`);
      break;
    }
  }

  console.log('\n✅ Monitoring completed!\n');
  generateReport(snapshots);
}

function generateReport(snapshots: MetricsSnapshot[]): void {
  console.log('📊 STRESS TEST REPORT\n');
  console.log('=' .repeat(60));

  if (snapshots.length === 0) {
    console.log('No snapshots collected!');
    return;
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  // 区块同步统计
  const startBlocks = parseInt(last.blockCount) - parseInt(first.blockCount);
  const duration = (last.uptime - first.uptime) / 60; // minutes
  const blocksPerMinute = startBlocks / duration;

  console.log('\n🎯 Block Sync Performance:');
  console.log(`   Blocks synced: ${startBlocks}`);
  console.log(`   Duration: ${duration.toFixed(1)} minutes`);
  console.log(`   Rate: ${blocksPerMinute.toFixed(1)} blocks/minute`);
  console.log(`   (${(blocksPerMinute / 60).toFixed(2)} blocks/second)`);

  // 内存使用统计
  const memoryValues = snapshots.map(s => s.memory.rss / 1024 / 1024);
  const minMemory = Math.min(...memoryValues);
  const maxMemory = Math.max(...memoryValues);
  const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;

  console.log('\n💾 Memory Usage (MB):');
  console.log(`   Min: ${minMemory.toFixed(1)} MB`);
  console.log(`   Max: ${maxMemory.toFixed(1)} MB`);
  console.log(`   Avg: ${avgMemory.toFixed(1)} MB`);
  console.log(`   Growth: ${(maxMemory - minMemory).toFixed(1)} MB`);

  // RPC性能
  const rpcLatencies = snapshots.map(s => s.rpcLatency);
  const avgRpcLatency = rpcLatencies.reduce((a, b) => a + b, 0) / rpcLatencies.length;
  const totalErrors = snapshots.reduce((sum, s) => sum + s.rpcErrorRate, 0);
  const totalRequests = parseInt(snapshots[snapshots.length - 1].blockCount);

  console.log('\n🌐 RPC Performance:');
  console.log(`   Avg latency: ${avgRpcLatency.toFixed(1)} ms`);
  console.log(`   Total requests: ~${totalRequests}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`   Error rate: ${((totalErrors / totalRequests) * 100).toFixed(2)}%`);

  // 同步延迟
  const maxLag = Math.max(...snapshots.map(s => s.syncLag));
  const minLag = Math.min(...snapshots.map(s => s.syncLag));

  console.log('\n⏱️  Sync Lag:');
  console.log(`   Min: ${minLag}`);
  console.log(`   Max: ${maxLag}`);
  console.log(`   Final: ${last.syncLag}`);

  // 成功标准检查
  console.log('\n✅ Success Criteria:');
  console.log(`   ${maxMemory < 200 ? '✅' : '❌'} Memory < 200MB (${maxMemory.toFixed(1)} MB)`);
  console.log(`   ${totalErrors === 0 ? '✅' : '❌'} No errors (${totalErrors} errors)`);
  console.log(`   ${maxLag <= 5 ? '✅' : '❌'} Sync lag ≤ 5 (max: ${maxLag})`);
  console.log(`   ${(maxMemory - minMemory) < 20 ? '✅' : '❌'} Memory growth < 20MB (${(maxMemory - minMemory).toFixed(1)} MB)`);

  console.log('\n📁 Detailed results saved to:');
  console.log(`   ${RESULTS_FILE}\n`);

  // 最终结论
  const allPassed =
    maxMemory < 200 &&
    totalErrors === 0 &&
    maxLag <= 5 &&
    (maxMemory - minMemory) < 20;

  if (allPassed) {
    console.log('🎉 STRESS TEST PASSED!');
    console.log('   Indexer is production-ready!\n');
  } else {
    console.log('⚠️  STRESS TEST: Some criteria not met');
    console.log('   Review results above for details\n');
  }

  console.log('='.repeat(60));
}

// 运行监控
if (require.main === module) {
  monitorStressTest()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Monitoring failed:', error);
      process.exit(1);
    });
}

export { monitorStressTest };
