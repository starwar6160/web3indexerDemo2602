"use strict";
/**
 * 结构化日志工具（符合SpaceX哲学）
 *
 * 规则：
 * 1. 所有日志必须是JSON格式（可机器解析）
 * 2. 每条日志必须包含：timestamp, level, message, context
 * 3. 错误日志必须包含：error stacktrace, instance_id
 * 4. 不允许使用 console.log / console.error（除边界层fatal函数）
 *
 * 为什么不用console.log？
 * - console.log = 纯文本 = 无法聚合查询
 * - JSON日志 = ELK/Loki即时查询 = "炸也要带telemetry炸"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.StructuredLogger = void 0;
exports.initLogger = initLogger;
class StructuredLogger {
    constructor(instanceId) {
        this.instanceId = instanceId;
    }
    log(level, message, context, error) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            instance_id: this.instanceId,
        };
        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }
        // 输出单行JSON（便于日志聚合系统解析）
        console.log(JSON.stringify(entry));
    }
    debug(message, context) {
        this.log('DEBUG', message, context);
    }
    info(message, context) {
        this.log('INFO', message, context);
    }
    warn(message, context, error) {
        this.log('WARN', message, context, error);
    }
    error(message, context, error) {
        this.log('ERROR', message, context, error);
    }
    /**
     * 记录区块同步操作（带metrics）
     */
    logBlockSync(blockNumber, duration, context) {
        this.info('Block synced', {
            block_number: blockNumber.toString(),
            duration_ms: duration,
            ...context,
        });
    }
    /**
     * 记录RPC操作（带重试信息）
     */
    logRpcRequest(method, params, duration, attempt) {
        this.debug('RPC request completed', {
            rpc_method: method,
            params: JSON.stringify(params),
            duration_ms: duration,
            attempt,
        });
    }
    /**
     * 记录Reorg检测（关键事件）
     */
    logReorgDetected(blockNumber, expectedHash, actualHash) {
        this.error('Reorg detected', {
            block_number: blockNumber.toString(),
            expected_hash: expectedHash,
            actual_hash: actualHash,
        });
    }
    /**
     * 记录数据库操作（带性能指标）
     */
    logDbOperation(operation, table, duration, rowsAffected) {
        this.debug('Database operation', {
            operation,
            table,
            duration_ms: duration,
            rows_affected: rowsAffected,
        });
    }
    /**
     * 记录启动信息（系统指纹）
     */
    logStartup(config) {
        this.info('Indexer starting', {
            ...config,
            node_version: process.version,
            platform: process.platform,
            arch: process.arch,
        });
    }
}
exports.StructuredLogger = StructuredLogger;
/**
 * 初始化logger（必须在main函数的第一行调用）
 */
function initLogger(instanceId) {
    exports.logger = new StructuredLogger(instanceId);
}
