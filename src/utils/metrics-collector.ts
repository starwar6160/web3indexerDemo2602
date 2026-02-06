import { EventEmitter } from 'events';

/**
 * 指标收集器 - 追踪系统关键指标
 */
export class MetricsCollector extends EventEmitter {
  private metrics = {
    // RPC 指标
    rpcCalls: {
      total: 0,
      success: 0,
      failures: 0,
      totalTime: 0, // 毫秒
      maxLatency: 0,
      minLatency: Infinity,
    },

    // 数据库指标
    database: {
      writes: 0,
      failures: 0,
      totalTime: 0, // 毫秒
      maxLatency: 0,
      minLatency: Infinity,
      blockSize: 0, // 平均批次大小
    },

    // Reorg 指标
    reorgs: {
      detected: 0,
      depthSum: 0, // 累计深度
      maxDepth: 0,
    },

    // 内存指标
    memory: {
      lastUsageMb: 0,
      peakUsageMb: 0,
    },

    // 同步状态
    sync: {
      currentBlock: 0n,
      highestBlock: 0n,
      lag: 0n,
    },
  };

  private startTime = Date.now();
  private resetPeriod = 60000; // 每分钟重置一次统计数据
  private lastReset = Date.now();

  /**
   * 记录 RPC 调用
   */
  recordRpcCall(success: boolean, latency: number): void {
    this.metrics.rpcCalls.total++;
    if (success) {
      this.metrics.rpcCalls.success++;
      this.metrics.rpcCalls.totalTime += latency;
      this.metrics.rpcCalls.maxLatency = Math.max(this.metrics.rpcCalls.maxLatency, latency);
      this.metrics.rpcCalls.minLatency = Math.min(this.metrics.rpcCalls.minLatency, latency);
    } else {
      this.metrics.rpcCalls.failures++;
    }

    // 检查是否需要重置统计
    this.maybeResetMetrics();
  }

  /**
   * 记录数据库写入
   */
  recordDbWrite(success: boolean, latency: number, blockSize: number): void {
    this.metrics.database.writes++;
    if (success) {
      this.metrics.database.totalTime += latency;
      this.metrics.database.maxLatency = Math.max(this.metrics.database.maxLatency, latency);
      this.metrics.database.minLatency = Math.min(this.metrics.database.minLatency, latency);
      // 更新平均批次大小（移动平均）
      this.metrics.database.blockSize =
        (this.metrics.database.blockSize * 0.9 + blockSize * 0.1);
    } else {
      this.metrics.database.failures++;
    }

    this.maybeResetMetrics();
  }

  /**
   * 记录 Reorg 事件
   */
  recordReorg(depth: number): void {
    this.metrics.reorgs.detected++;
    this.metrics.reorgs.depthSum += depth;
    this.metrics.reorgs.maxDepth = Math.max(this.metrics.reorgs.maxDepth, depth);

    this.emit('reorg', { depth, timestamp: Date.now() });
  }

  /**
   * 更新内存使用
   */
  updateMemoryUsage(): void {
    const usage = process.memoryUsage();
    const usedMb = usage.heapUsed / 1024 / 1024;

    this.metrics.memory.lastUsageMb = usedMb;
    this.metrics.memory.peakUsageMb = Math.max(this.metrics.memory.peakUsageMb, usedMb);
  }

  /**
   * 更新同步状态
   */
  updateSyncState(currentBlock: bigint, highestBlock: bigint): void {
    this.metrics.sync.currentBlock = currentBlock;
    this.metrics.sync.highestBlock = highestBlock;
    this.metrics.sync.lag = highestBlock - currentBlock;
  }

  /**
   * 获取所有指标
   */
  getMetrics() {
    this.updateMemoryUsage();

    const uptime = Date.now() - this.startTime;
    const resetWindow = Date.now() - this.lastReset;

    return {
      uptime: `${Math.floor(uptime / 1000)}s`,
      resetWindow: `${Math.floor(resetWindow / 1000)}s`,

      // RPC 指标
      rpc: {
        total: this.metrics.rpcCalls.total,
        success: this.metrics.rpcCalls.success,
        failures: this.metrics.rpcCalls.failures,
        errorRate: this.metrics.rpcCalls.total > 0
          ? this.metrics.rpcCalls.failures / this.metrics.rpcCalls.total
          : 0,
        avgLatency: this.metrics.rpcCalls.success > 0
          ? Math.round(this.metrics.rpcCalls.totalTime / this.metrics.rpcCalls.success)
          : 0,
        maxLatency: this.metrics.rpcCalls.maxLatency,
        minLatency: this.metrics.rpcCalls.minLatency === Infinity ? 0 : this.metrics.rpcCalls.minLatency,
      },

      // 数据库指标
      database: {
        writes: this.metrics.database.writes,
        failures: this.metrics.database.failures,
        errorRate: this.metrics.database.writes > 0
          ? this.metrics.database.failures / this.metrics.database.writes
          : 0,
        avgLatency: this.metrics.database.writes > 0
          ? Math.round(this.metrics.database.totalTime / this.metrics.database.writes)
          : 0,
        maxLatency: this.metrics.database.maxLatency,
        minLatency: this.metrics.database.minLatency === Infinity ? 0 : this.metrics.database.minLatency,
        avgBatchSize: Math.round(this.metrics.database.blockSize * 10) / 10,
      },

      // Reorg 指标
      reorgs: {
        detected: this.metrics.reorgs.detected,
        avgDepth: this.metrics.reorgs.detected > 0
          ? this.metrics.reorgs.depthSum / this.metrics.reorgs.detected
          : 0,
        maxDepth: this.metrics.reorgs.maxDepth,
      },

      // 内存指标
      memory: {
        currentMb: Math.round(this.metrics.memory.lastUsageMb * 100) / 100,
        peakMb: Math.round(this.metrics.memory.peakUsageMb * 100) / 100,
      },

      // 同步状态
      sync: {
        currentBlock: this.metrics.sync.currentBlock.toString(),
        highestBlock: this.metrics.sync.highestBlock.toString(),
        lag: this.metrics.sync.lag.toString(),
      },
    };
  }

  /**
   * 获取 Prometheus 格式的指标
   */
  getPrometheusMetrics(): string {
    const m = this.getMetrics();
    const timestamp = Math.floor(Date.now() / 1000);

    return [
      `# RPC metrics`,
      `rpc_calls_total ${m.rpc.total} ${timestamp}`,
      `rpc_calls_success_total ${m.rpc.success} ${timestamp}`,
      `rpc_calls_failure_total ${m.rpc.failures} ${timestamp}`,
      `rpc_latency_ms ${m.rpc.avgLatency} ${timestamp}`,
      `rpc_latency_max_ms ${m.rpc.maxLatency} ${timestamp}`,
      ``,
      `# Database metrics`,
      `db_writes_total ${m.database.writes} ${timestamp}`,
      `db_write_failures_total ${m.database.failures} ${timestamp}`,
      `db_latency_ms ${m.database.avgLatency} ${timestamp}`,
      `db_batch_size ${m.database.avgBatchSize} ${timestamp}`,
      ``,
      `# Reorg metrics`,
      `reorgs_detected_total ${m.reorgs.detected} ${timestamp}`,
      `reorg_depth_max ${m.reorgs.maxDepth} ${timestamp}`,
      ``,
      `# Memory metrics`,
      `memory_usage_mb ${m.memory.currentMb} ${timestamp}`,
      `memory_peak_mb ${m.memory.peakMb} ${timestamp}`,
      ``,
      `# Sync metrics`,
      `sync_lag_blocks ${m.sync.lag} ${timestamp}`,
    ].join('\n');
  }

  /**
   * 检查告警阈值
   */
  checkAlerts(config: {
    rpcErrorRate: number;
    syncLagBlocks: number;
    dbLatencyMs: number;
  }) {
    const m = this.getMetrics();
    const alerts: string[] = [];

    if (m.rpc.errorRate > config.rpcErrorRate) {
      alerts.push(`RPC error rate ${(m.rpc.errorRate * 100).toFixed(1)}% exceeds threshold ${(config.rpcErrorRate * 100).toFixed(1)}%`);
    }

    const syncLag = parseInt(m.sync.lag);
    if (syncLag > config.syncLagBlocks) {
      alerts.push(`Sync lag ${syncLag} blocks exceeds threshold ${config.syncLagBlocks}`);
    }

    if (m.database.avgLatency > config.dbLatencyMs) {
      alerts.push(`DB latency ${m.database.avgLatency}ms exceeds threshold ${config.dbLatencyMs}ms`);
    }

    return alerts;
  }

  /**
   * 定期重置指标（滑动窗口）
   */
  private maybeResetMetrics(): void {
    const now = Date.now();
    if (now - this.lastReset > this.resetPeriod) {
      // 保存关键指标
      const peakMemory = this.metrics.memory.peakUsageMb;
      const maxReorgDepth = this.metrics.reorgs.maxDepth;

      // 重置计数器
      this.metrics.rpcCalls = {
        total: 0,
        success: 0,
        failures: 0,
        totalTime: 0,
        maxLatency: 0,
        minLatency: Infinity,
      };

      this.metrics.database = {
        writes: 0,
        failures: 0,
        totalTime: 0,
        maxLatency: 0,
        minLatency: Infinity,
        blockSize: this.metrics.database.blockSize, // 保留批次大小
      };

      this.metrics.reorgs = {
        detected: 0,
        depthSum: 0,
        maxDepth: maxReorgDepth, // 保留最大值
      };

      this.metrics.memory.peakUsageMb = peakMemory; // 保留峰值

      this.lastReset = now;
      this.emit('reset', { timestamp: now });
    }
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.metrics = {
      rpcCalls: {
        total: 0,
        success: 0,
        failures: 0,
        totalTime: 0,
        maxLatency: 0,
        minLatency: Infinity,
      },
      database: {
        writes: 0,
        failures: 0,
        totalTime: 0,
        maxLatency: 0,
        minLatency: Infinity,
        blockSize: 0,
      },
      reorgs: {
        detected: 0,
        depthSum: 0,
        maxDepth: 0,
      },
      memory: {
        lastUsageMb: 0,
        peakUsageMb: 0,
      },
      sync: {
        currentBlock: 0n,
        highestBlock: 0n,
        lag: 0n,
      },
    };
    this.startTime = Date.now();
    this.lastReset = Date.now();
  }
}

/**
 * 全局单例
 */
export const metrics = new MetricsCollector();
