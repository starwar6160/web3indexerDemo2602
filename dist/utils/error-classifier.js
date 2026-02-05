"use strict";
/**
 * 错误分类和处理工具
 * 统一错误处理逻辑，提供错误分类和恢复建议
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorHandler = exports.ErrorClassifier = exports.ErrorRecoveryAction = exports.ErrorCategory = void 0;
const logger_1 = __importDefault(require("./logger"));
var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["NETWORK"] = "network";
    ErrorCategory["RPC"] = "rpc";
    ErrorCategory["VALIDATION"] = "validation";
    ErrorCategory["DATABASE"] = "database";
    ErrorCategory["CRITICAL"] = "critical";
})(ErrorCategory || (exports.ErrorCategory = ErrorCategory = {}));
var ErrorRecoveryAction;
(function (ErrorRecoveryAction) {
    ErrorRecoveryAction["RETRY"] = "retry";
    ErrorRecoveryAction["SKIP"] = "skip";
    ErrorRecoveryAction["ABORT"] = "abort";
    ErrorRecoveryAction["SHUTDOWN"] = "shutdown";
})(ErrorRecoveryAction || (exports.ErrorRecoveryAction = ErrorRecoveryAction = {}));
/**
 * 错误分类器
 */
class ErrorClassifier {
    /**
     * 分类错误
     */
    static classify(error) {
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
    static isNetworkError(message, stack) {
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
        return networkKeywords.some(keyword => message.includes(keyword) || stack.includes(keyword));
    }
    /**
     * 检查是否是 RPC 错误
     */
    static isRpcError(message, stack) {
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
        return rpcKeywords.some(keyword => message.includes(keyword) || stack.includes(keyword));
    }
    /**
     * 检查是否是验证错误
     */
    static isValidationError(message) {
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
    static isDatabaseError(message, stack) {
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
        return dbKeywords.some(keyword => message.includes(keyword) || stack.includes(keyword));
    }
    /**
     * 检查数据库错误是否可重试
     */
    static isRetriableDatabaseError(message) {
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
    static formatError(classified, context) {
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';
        return `[${classified.category.toUpperCase()}] ${classified.message}${contextStr}`;
    }
}
exports.ErrorClassifier = ErrorClassifier;
/**
 * 错误处理器
 */
class ErrorHandler {
    /**
     * 处理错误并返回是否应该继续
     */
    static handleError(error, context) {
        const classified = ErrorClassifier.classify(error);
        // 记录错误
        logger_1.default.error({
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
exports.ErrorHandler = ErrorHandler;
