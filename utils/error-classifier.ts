/**
 * 错误分类和处理工具
 * 统一错误处理逻辑，提供错误分类和恢复建议
 */

import logger from './logger';

export enum ErrorCategory {
  NETWORK = 'network',           // 网络错误（可重试）
  RPC = 'rpc',                   // RPC 端点错误（可重试）
  VALIDATION = 'validation',     // 数据验证错误（不可重试）
  DATABASE = 'database',         // 数据库错误（可能可重试）
  CRITICAL = 'critical',         // 严重错误（不可恢复）
}

export enum ErrorRecoveryAction {
  RETRY = 'retry',               // 重试
  SKIP = 'skip',                 // 跳过此项
  ABORT = 'abort',               // 中止操作
  SHUTDOWN = 'shutdown',         // 关闭程序
}

export interface ClassifiedError {
  category: ErrorCategory;
  action: ErrorRecoveryAction;
  retriable: boolean;
  message: string;
  originalError: Error;
}

/**
 * 错误分类器
 */
export class ErrorClassifier {
  /**
   * 分类错误
   */
  static classify(error: Error): ClassifiedError {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    // 1. 网络错误
    if (this.isNetworkError(message, stack)) {
      return {
        category: ErrorCategory.NETWORK,
        action: ErrorRecoveryAction.RETRY,
        retriable: true,
        message: 'Network error detected',
        originalError: error,
      };
    }

    // 2. RPC 错误
    if (this.isRpcError(message, stack)) {
      return {
        category: ErrorCategory.RPC,
        action: ErrorRecoveryAction.RETRY,
        retriable: true,
        message: 'RPC endpoint error',
        originalError: error,
      };
    }

    // 3. 数据验证错误
    if (this.isValidationError(message)) {
      return {
        category: ErrorCategory.VALIDATION,
        action: ErrorRecoveryAction.SKIP,
        retriable: false,
        message: 'Data validation failed',
        originalError: error,
      };
    }

    // 4. 数据库错误
    if (this.isDatabaseError(message, stack)) {
      // 某些数据库错误可以重试
      const retriable = this.isRetriableDatabaseError(message);

      return {
        category: ErrorCategory.DATABASE,
        action: retriable ? ErrorRecoveryAction.RETRY : ErrorRecoveryAction.ABORT,
        retriable,
        message: 'Database operation failed',
        originalError: error,
      };
    }

    // 5. 未知/严重错误
    return {
      category: ErrorCategory.CRITICAL,
      action: ErrorRecoveryAction.SHUTDOWN,
      retriable: false,
      message: 'Critical error',
      originalError: error,
    };
  }

  /**
   * 检查是否是网络错误
   */
  private static isNetworkError(message: string, stack: string): boolean {
    const networkKeywords = [
      'network',
      'timeout',
      'econnrefused',
      'enotfound',
      'etimedout',
      'econnreset',
      'econnaborted',
      'fetch failed',
      'socket hang up',
    ];

    return networkKeywords.some(keyword =>
      message.includes(keyword) || stack.includes(keyword)
    );
  }

  /**
   * 检查是否是 RPC 错误
   */
  private static isRpcError(message: string, stack: string): boolean {
    const rpcKeywords = [
      'rate limit',
      '429',
      '503',
      '502',
      '504',
      'rpc',
      'json-rpc',
      'internal server error',
      'service unavailable',
    ];

    return rpcKeywords.some(keyword =>
      message.includes(keyword) || stack.includes(keyword)
    );
  }

  /**
   * 检查是否是验证错误
   */
  private static isValidationError(message: string): boolean {
    const validationKeywords = [
      'validation',
      'invalid',
      'schema',
      'parse',
      'zod',
      'type error',
      'undefined',
      'null',
    ];

    return validationKeywords.some(keyword => message.includes(keyword));
  }

  /**
   * 检查是否是数据库错误
   */
  private static isDatabaseError(message: string, stack: string): boolean {
    const dbKeywords = [
      'database',
      'pg.',
      'postgres',
      'connection',
      'query',
      'duplicate',
      'constraint',
      'deadlock',
      'lock',
    ];

    return dbKeywords.some(keyword =>
      message.includes(keyword) || stack.includes(keyword)
    );
  }

  /**
   * 检查数据库错误是否可重试
   */
  private static isRetriableDatabaseError(message: string): boolean {
    const retriableKeywords = [
      'deadlock',
      'connection',
      'timeout',
      'could not connect',
      'terminated',
    ];

    const nonRetriableKeywords = [
      'duplicate',
      'constraint',
      'syntax',
      'invalid',
    ];

    const isRetriable = retriableKeywords.some(k => message.includes(k));
    const isNonRetriable = nonRetriableKeywords.some(k => message.includes(k));

    return isRetriable && !isNonRetriable;
  }

  /**
   * 格式化错误消息（用于日志）
   */
  static formatError(classified: ClassifiedError, context?: Record<string, any>): string {
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${classified.category.toUpperCase()}] ${classified.message}${contextStr}`;
  }
}

/**
 * 错误处理器
 */
export class ErrorHandler {
  /**
   * 处理错误并返回是否应该继续
   */
  static handleError(
    error: Error,
    context?: Record<string, any>
  ): { shouldContinue: boolean; shouldRetry: boolean; shouldShutdown: boolean } {
    const classified = ErrorClassifier.classify(error);

    // 记录错误
    logger.error({
      error: classified.originalError,
      category: classified.category,
      action: classified.action,
      ...context,
    }, ErrorClassifier.formatError(classified, context));

    // 根据错误类型决定下一步操作
    switch (classified.action) {
      case ErrorRecoveryAction.RETRY:
        return { shouldContinue: false, shouldRetry: true, shouldShutdown: false };

      case ErrorRecoveryAction.SKIP:
        return { shouldContinue: true, shouldRetry: false, shouldShutdown: false };

      case ErrorRecoveryAction.ABORT:
        return { shouldContinue: false, shouldRetry: false, shouldShutdown: false };

      case ErrorRecoveryAction.SHUTDOWN:
        return { shouldContinue: false, shouldRetry: false, shouldShutdown: true };

      default:
        return { shouldContinue: false, shouldRetry: false, shouldShutdown: true };
    }
  }
}

