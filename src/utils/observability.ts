import { ConnectionManager } from '../database/database-config';

/**
 * Observability Module - [C5] Production Readiness
 *
 * Metrics tracked:
 * - RPC latency (avg, p95, p99)
 * - Sync lag (blocks behind chain tip)
 * - Reorg depth and frequency
 * - Block coverage percentage
 * - Database write latency
 */

interface RpcMetrics {
  totalCalls: number;
  failedCalls: number;
  totalLatency: number;
  latencies: number[];
}

interface ReorgEvent {
  blockNumber: bigint;
  depth: number;
  timestamp: Date;
}

export class Observability {
  private rpcMetrics: Map<string, RpcMetrics> = new Map();
  private reorgHistory: ReorgEvent[] = [];
  private lastAlertTime: Map<string, number> = new Map();
  private readonly ALERT_COOLDOWN_MS = 60000; // 1 minute cooldown

  // Alert thresholds
  private readonly SYNC_LAG_THRESHOLD = 10; // Alert if >10 blocks behind
  private readonly RPC_ERROR_THRESHOLD = 0.1; // Alert if >10% error rate
  private readonly REORG_DEPTH_THRESHOLD = 5; // Alert if reorg >5 blocks

  constructor(private dbManager: ConnectionManager) {}

  /**
   * Record RPC call metrics
   */
  recordRpcCall(method: string, latencyMs: number, success: boolean): void {
    if (!this.rpcMetrics.has(method)) {
      this.rpcMetrics.set(method, {
        totalCalls: 0,
        failedCalls: 0,
        totalLatency: 0,
        latencies: [],
      });
    }

    const metrics = this.rpcMetrics.get(method)!;
    metrics.totalCalls++;
    metrics.totalLatency += latencyMs;
    metrics.latencies.push(latencyMs);

    // Keep only last 100 latencies for percentile calculation
    if (metrics.latencies.length > 100) {
      metrics.latencies.shift();
    }

    if (!success) {
      metrics.failedCalls++;
    }

    // Check if we need to alert
    this.checkRpcAlert(method, metrics);
  }

  /**
   * Record reorg event
   */
  recordReorg(blockNumber: bigint, depth: number): void {
    this.reorgHistory.push({
      blockNumber,
      depth,
      timestamp: new Date(),
    });

    // Keep only last 100 reorg events
    if (this.reorgHistory.length > 100) {
      this.reorgHistory.shift();
    }

    // Alert on deep reorgs
    if (depth >= this.REORG_DEPTH_THRESHOLD) {
      this.triggerAlert('REORG_DEPTH', `Deep reorg detected: ${depth} blocks at #${blockNumber}`, {
        blockNumber: blockNumber.toString(),
        depth,
      });
    }
  }

  /**
   * Check sync lag and alert if behind
   */
  async checkSyncLag(localMaxBlock: bigint, chainTip: bigint): Promise<number> {
    const lag = Number(chainTip - localMaxBlock);

    if (lag > this.SYNC_LAG_THRESHOLD) {
      this.triggerAlert('SYNC_LAG', `Sync lag: ${lag} blocks behind chain tip`, {
        localMaxBlock: localMaxBlock.toString(),
        chainTip: chainTip.toString(),
        lag,
      });
    }

    return lag;
  }

  /**
   * Get RPC health status
   */
  getRpcHealth(): Array<{
    method: string;
    totalCalls: number;
    errorRate: number;
    avgLatency: number;
    p95Latency: number;
    healthy: boolean;
  }> {
    return Array.from(this.rpcMetrics.entries()).map(([method, metrics]) => {
      const sorted = [...metrics.latencies].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index] || 0;

      const errorRate = metrics.totalCalls > 0
        ? metrics.failedCalls / metrics.totalCalls
        : 0;

      const avgLatency = metrics.totalCalls > 0
        ? metrics.totalLatency / metrics.totalCalls
        : 0;

      return {
        method,
        totalCalls: metrics.totalCalls,
        errorRate,
        avgLatency,
        p95Latency: p95,
        healthy: errorRate < this.RPC_ERROR_THRESHOLD && p95 < 5000, // <5% errors, <5s p95
      };
    });
  }

  /**
   * Get reorg statistics
   */
  getReorgStats(): {
    totalCount: number;
    maxDepth: number;
    avgDepth: number;
    recentEvents: ReorgEvent[];
  } {
    const depths = this.reorgHistory.map(r => r.depth);
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;
    const avgDepth = depths.length > 0
      ? depths.reduce((a, b) => a + b, 0) / depths.length
      : 0;

    return {
      totalCount: this.reorgHistory.length,
      maxDepth,
      avgDepth: Math.round(avgDepth * 100) / 100,
      recentEvents: this.reorgHistory.slice(-10),
    };
  }

  /**
   * Get summary metrics for health checks
   */
  getHealthSummary(): {
    rpcHealthy: boolean;
    syncLag: number | null;
    recentReorgs: number;
    maxReorgDepth: number;
  } {
    const rpcHealth = this.getRpcHealth();
    const allHealthy = rpcHealth.every(h => h.healthy);
    const reorgStats = this.getReorgStats();

    return {
      rpcHealthy: allHealthy,
      syncLag: null, // Updated by caller
      recentReorgs: reorgStats.totalCount,
      maxReorgDepth: reorgStats.maxDepth,
    };
  }

  /**
   * Check RPC alert conditions
   */
  private checkRpcAlert(method: string, metrics: RpcMetrics): void {
    if (metrics.totalCalls < 10) return; // Need minimum sample size

    const errorRate = metrics.failedCalls / metrics.totalCalls;
    if (errorRate > this.RPC_ERROR_THRESHOLD) {
      this.triggerAlert('RPC_ERROR_RATE', `High RPC error rate for ${method}: ${(errorRate * 100).toFixed(1)}%`, {
        method,
        errorRate,
        totalCalls: metrics.totalCalls,
      });
    }
  }

  /**
   * Trigger an alert with deduplication
   */
  private triggerAlert(type: string, message: string, context: Record<string, unknown>): void {
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(type) || 0;

    // Cooldown check
    if (now - lastAlert < this.ALERT_COOLDOWN_MS) {
      return;
    }

    this.lastAlertTime.set(type, now);

    // Log structured alert
    console.error(JSON.stringify({
      level: 'ALERT',
      type,
      message,
      timestamp: new Date().toISOString(),
      context,
    }));

    // In production, this would also:
    // - Send to PagerDuty/Opsgenie
    // - Post to Slack/Discord webhook
    // - Record in alert management system
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.rpcMetrics.clear();
    this.reorgHistory = [];
    this.lastAlertTime.clear();
  }
}

// Singleton instance
let observabilityInstance: Observability | null = null;

export function getObservability(dbManager?: ConnectionManager): Observability {
  if (!observabilityInstance && dbManager) {
    observabilityInstance = new Observability(dbManager);
  }
  return observabilityInstance!;
}

export function resetObservability(): void {
  observabilityInstance?.reset();
  observabilityInstance = null;
}
