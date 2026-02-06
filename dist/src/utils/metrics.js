"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexerMetrics = exports.IndexerMetrics = exports.metrics = exports.MetricsRegistry = void 0;
exports.initMetrics = initMetrics;
exports.initIndexerMetrics = initIndexerMetrics;
/**
 * Prometheus Metrics Registry
 */
class MetricsRegistry {
    constructor() {
        this.counters = new Map();
        this.gauges = new Map();
    }
    /**
     * 记录一个Counter事件
     */
    incCounter(name, value = 1, labels = {}) {
        const key = this.makeKey(name, labels);
        const existing = this.counters.get(key);
        if (existing) {
            existing.value += value;
        }
        else {
            this.counters.set(key, { name, value, labels, help: `${name} counter` });
        }
    }
    /**
     * 设置一个Gauge值
     */
    setGauge(name, value, labels = {}) {
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
    exportPrometheusFormat() {
        const lines = [];
        // Export counters
        for (const counter of this.counters.values()) {
            const labelsStr = this.formatLabels(counter.labels);
            lines.push(`# HELP ${counter.name} ${counter.help}`, `# TYPE ${counter.name} counter`, `${counter.name}${labelsStr} ${counter.value}`);
        }
        // Export gauges
        for (const gauge of this.gauges.values()) {
            const labelsStr = this.formatLabels(gauge.labels);
            lines.push(`# HELP ${gauge.name} ${gauge.help}`, `# TYPE ${gauge.name} gauge`, `${gauge.name}${labelsStr} ${gauge.value}`);
        }
        return lines.join('\n') + '\n';
    }
    makeKey(name, labels) {
        return `${name}:${JSON.stringify(labels)}`;
    }
    formatLabels(labels) {
        const entries = Object.entries(labels);
        if (entries.length === 0)
            return '';
        const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(',');
        return `{${formatted}}`;
    }
}
exports.MetricsRegistry = MetricsRegistry;
/**
 * 初始化metrics收集器
 */
function initMetrics() {
    exports.metrics = new MetricsRegistry();
}
/**
 * 业务层Metrics Helper（让业务代码更简洁）
 */
class IndexerMetrics {
    constructor(registry, instanceId) {
        this.registry = registry;
        this.instanceId = instanceId;
    }
    /**
     * 记录区块处理
     */
    recordBlockProcessed() {
        this.registry.incCounter('indexer_blocks_processed_total', 1, { instance_id: this.instanceId });
    }
    /**
     * 记录RPC错误
     */
    recordRpcError(rpcEndpoint, errorType) {
        this.registry.incCounter('indexer_rpc_errors_total', 1, {
            instance_id: this.instanceId,
            rpc_endpoint: rpcEndpoint,
            error_type: errorType,
        });
    }
    /**
     * 记录Reorg检测
     */
    recordReorgDetected(depth) {
        this.registry.incCounter('indexer_reorg_detected_total', 1, {
            instance_id: this.instanceId,
            depth_bucket: this.getDepthBucket(depth),
        });
    }
    /**
     * 更新同步延迟（关键指标）
     */
    updateSyncLag(lagBlocks) {
        this.registry.setGauge('indexer_sync_lag_blocks', lagBlocks, { instance_id: this.instanceId });
    }
    /**
     * 记录数据库操作延迟
     */
    recordDbLatency(operation, durationMs) {
        this.registry.setGauge('indexer_db_latency_ms', durationMs, {
            instance_id: this.instanceId,
            operation,
        });
    }
    getDepthBucket(depth) {
        if (depth <= 2)
            return '0-2';
        if (depth <= 6)
            return '3-6';
        if (depth <= 12)
            return '7-12';
        return '13+';
    }
}
exports.IndexerMetrics = IndexerMetrics;
/**
 * 初始化业务metrics
 */
function initIndexerMetrics(instanceId) {
    initMetrics();
    exports.indexerMetrics = new IndexerMetrics(exports.metrics, instanceId);
}
