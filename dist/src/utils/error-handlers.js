"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFatalError = handleFatalError;
exports.setupGlobalErrorHandlers = setupGlobalErrorHandlers;
exports.setupGracefulShutdown = setupGracefulShutdown;
const logger_1 = __importDefault(require("./logger"));
/**
 * 致命错误处理器
 * 用于处理 unhandledRejection 和 uncaughtException
 *
 * 这些错误表示程序存在严重bug，必须立即终止
 */
function handleFatalError(error, type) {
    logger_1.default.fatal({
        errorType: type,
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
        },
    }, `💀 FATAL: ${type} - This is a bug, terminating immediately`);
    // 给日志系统一点时间刷新
    logger_1.default.flush();
    // 立即终止，不要让程序继续运行
    process.exit(1);
}
/**
 * 设置全局错误处理器
 */
function setupGlobalErrorHandlers() {
    // 处理未捕获的 Promise rejection
    process.on('unhandledRejection', (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        logger_1.default.error({
            error,
            promise: String(promise),
        }, '⚠️  Unhandled Promise Rejection detected');
        handleFatalError(error, 'unhandledRejection');
    });
    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
        logger_1.default.error({
            error,
        }, '⚠️  Uncaught Exception detected');
        handleFatalError(error, 'uncaughtException');
    });
    // 处理警告（Node.js specific）
    process.on('warning', (warning) => {
        logger_1.default.warn({
            warning: {
                name: warning.name,
                message: warning.message,
                stack: warning.stack,
            },
        }, '⚠️  Node.js warning detected');
    });
    logger_1.default.info('✅ Global error handlers installed');
}
/**
 * 优雅关闭处理器
 */
function setupGracefulShutdown(shutdownFn) {
    const shutdown = async (signal) => {
        logger_1.default.info({ signal }, '🛑 Received shutdown signal, starting graceful shutdown...');
        try {
            await shutdownFn();
            logger_1.default.info('✅ Graceful shutdown completed');
            process.exit(0);
        }
        catch (error) {
            logger_1.default.error({ error }, '❌ Error during graceful shutdown');
            process.exit(1);
        }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    logger_1.default.info('✅ Graceful shutdown handlers installed');
}
