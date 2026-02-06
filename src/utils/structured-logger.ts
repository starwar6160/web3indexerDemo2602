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

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  instance_id: string;
}

export class StructuredLogger {
  constructor(private instanceId: string) {}

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    const entry: LogEntry = {
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

  debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    this.log('WARN', message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log('ERROR', message, context, error);
  }

  /**
   * 记录区块同步操作（带metrics）
   */
  logBlockSync(blockNumber: bigint, duration: number, context?: LogContext): void {
    this.info('Block synced', {
      block_number: blockNumber.toString(),
      duration_ms: duration,
      ...context,
    });
  }

  /**
   * 记录RPC操作（带重试信息）
   */
  logRpcRequest(method: string, params: unknown, duration: number, attempt?: number): void {
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
  logReorgDetected(blockNumber: bigint, expectedHash: string, actualHash: string): void {
    this.error('Reorg detected', {
      block_number: blockNumber.toString(),
      expected_hash: expectedHash,
      actual_hash: actualHash,
    });
  }

  /**
   * 记录数据库操作（带性能指标）
   */
  logDbOperation(operation: string, table: string, duration: number, rowsAffected?: number): void {
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
  logStartup(config: {
    rpcUrl: string;
    batchSize: number;
    concurrency: number;
    confirmationDepth: number;
  }): void {
    this.info('Indexer starting', {
      ...config,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    });
  }
}

/**
 * 全局logger实例（在main函数中初始化）
 */
export let logger: StructuredLogger;

/**
 * 初始化logger（必须在main函数的第一行调用）
 */
export function initLogger(instanceId: string): void {
  logger = new StructuredLogger(instanceId);
}
