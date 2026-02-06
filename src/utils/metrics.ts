/**
 * Prometheus Metrics 收集器
 *
 * SpaceX哲学: "炸也要带telemetry炸"
 *
 * 所有关键指标必须被量化：
 * - 吞吐量（blocks/sec）
 * - 延迟（sync_lag）
 * - 错误率（rpc_errors, reorg_count）
 * - 资源使用（db_pool_size）
 */

/**
 * Counter 类型：只增不减（累计值）
 * 用于: 请求总数、错误总数、处理的blocks总数
 */
interface MetricCounter {
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

/**
 * Gauge 类型：可增可减（当前值）
 * 用于: 同步延迟、连接池大小、队列长度
 */
interface MetricGauge {
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

/**
 * Histogram 类型：分布统计
 * 用于: 请求延迟、批处理时间
 */
interface MetricHistogram {
  name: string;
  help: string;
  value: number; // 观察值
  buckets: number[]; // [0.1, 0.5, 1, 5, 10] 秒
  labels: Record<string, string>;
}

/**
 * Prometheus Metrics Registry
 */
export class MetricsRegistry {
  private counters: Map<string, MetricCounter> = new Map();
  private gauges: Map<string, MetricGauge> = new Map();

  /**
   * 记录一个Counter事件
   */
  incCounter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    const existing = this.counters.get(key);

    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { name, value, labels, help: `${name} counter` });
    }
  }

  /**
   * 设置一个Gauge值
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, { name, value, labels, help: `${name} gauge` });
  }

  /**
   * 导出Prometheus文本格式
   *
   * 示例输出:
   * ```
   * indexer_blocks_processed_total{instance_id="pod-1"} 12345
   * indexer_sync_lag_blocks 12
   * indexer_rpc_errors_total{rpc_endpoint="alchemy"} 5
   * ```
   */
  exportPrometheusFormat(): string {
    const lines: string[] = [];

    // Export counters
    for (const counter of this.counters.values()) {
      const labelsStr = this.formatLabels(counter.labels);
      lines.push(
        `# HELP ${counter.name} ${counter.help}`,
        `# TYPE ${counter.name} counter`,
        `${counter.name}${labelsStr} ${counter.value}`
      );
    }

    // Export gauges
    for (const gauge of this.gauges.values()) {
      const labelsStr = this.formatLabels(gauge.labels);
      lines.push(
        `# HELP ${gauge.name} ${gauge.help}`,
        `# TYPE ${gauge.name} gauge`,
        `${gauge.name}${labelsStr} ${gauge.value}`
      );
    }

    return lines.join('\n') + '\n';
  }

  private makeKey(name: string, labels: Record<string, string>): string {
    return `${name}:${JSON.stringify(labels)}`;
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';

    const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${formatted}}`;
  }
}

/**
 * 全局metrics实例
 */
export let metrics: MetricsRegistry;

/**
 * 初始化metrics收集器
 */
export function initMetrics(): void {
  metrics = new MetricsRegistry();
}

/**
 * 业务层Metrics Helper（让业务代码更简洁）
 */
export class IndexerMetrics {
  constructor(
    private registry: MetricsRegistry,
    private instanceId: string
  ) {}

  /**
   * 记录区块处理
   */
  recordBlockProcessed(): void {
    this.registry.incCounter('indexer_blocks_processed_total', 1, { instance_id: this.instanceId });
  }

  /**
   * 记录RPC错误
   */
  recordRpcError(rpcEndpoint: string, errorType: string): void {
    this.registry.incCounter('indexer_rpc_errors_total', 1, {
      instance_id: this.instanceId,
      rpc_endpoint: rpcEndpoint,
      error_type: errorType,
    });
  }

  /**
   * 记录Reorg检测
   */
  recordReorgDetected(depth: number): void {
    this.registry.incCounter('indexer_reorg_detected_total', 1, {
      instance_id: this.instanceId,
      depth_bucket: this.getDepthBucket(depth),
    });
  }

  /**
   * 更新同步延迟（关键指标）
   */
  updateSyncLag(lagBlocks: number): void {
    this.registry.setGauge('indexer_sync_lag_blocks', lagBlocks, { instance_id: this.instanceId });
  }

  /**
   * 记录数据库操作延迟
   */
  recordDbLatency(operation: string, durationMs: number): void {
    this.registry.setGauge('indexer_db_latency_ms', durationMs, {
      instance_id: this.instanceId,
      operation,
    });
  }

  private getDepthBucket(depth: number): string {
    if (depth <= 2) return '0-2';
    if (depth <= 6) return '3-6';
    if (depth <= 12) return '7-12';
    return '13+';
  }
}

/**
 * 全局业务metrics实例
 */
export let indexerMetrics: IndexerMetrics;

/**
 * 初始化业务metrics
 */
export function initIndexerMetrics(instanceId: string): void {
  initMetrics();
  indexerMetrics = new IndexerMetrics(metrics, instanceId);
}
