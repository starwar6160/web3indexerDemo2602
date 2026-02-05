import logger from './logger';

/**
 * 致命错误处理器
 * 用于处理 unhandledRejection 和 uncaughtException
 *
 * 这些错误表示程序存在严重bug，必须立即终止
 */
export function handleFatalError(error: Error, type: 'unhandledRejection' | 'uncaughtException'): never {
  logger.fatal({
    errorType: type,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  }, `💀 FATAL: ${type} - This is a bug, terminating immediately`);

  // 给日志系统一点时间刷新
  logger.flush();

  // 立即终止，不要让程序继续运行
  process.exit(1);
}

/**
 * 设置全局错误处理器
 */
export function setupGlobalErrorHandlers(): void {
  // 处理未捕获的 Promise rejection
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({
      error,
      promise: String(promise),
    }, '⚠️  Unhandled Promise Rejection detected');
    handleFatalError(error, 'unhandledRejection');
  });

  // 处理未捕获的异常
  process.on('uncaughtException', (error: Error) => {
    logger.error({
      error,
    }, '⚠️  Uncaught Exception detected');
    handleFatalError(error, 'uncaughtException');
  });

  // 处理警告（Node.js specific）
  process.on('warning', (warning: Error) => {
    logger.warn({
      warning: {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      },
    }, '⚠️  Node.js warning detected');
  });

  logger.info('✅ Global error handlers installed');
}

/**
 * 优雅关闭处理器
 */
export function setupGracefulShutdown(shutdownFn: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '🛑 Received shutdown signal, starting graceful shutdown...');

    try {
      await shutdownFn();
      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, '❌ Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('✅ Graceful shutdown handlers installed');
}
