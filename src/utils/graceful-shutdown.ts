/**
 * Graceful Shutdown Manager - C++ RAII Style Resource Management
 *
 * Implements sequenced shutdown with proper resource cleanup order:
 * 1. Stop Ingress (API/Health Server)
 * 2. Stop Processing (Sync Loop)
 * 3. Drain Resources (Database Pool, RPC Connections)
 *
 * This ensures:
 * - No new requests are accepted during shutdown
 * - In-flight operations complete gracefully
 * - Database connections are properly closed
 * - No data corruption from abrupt termination
 */

import logger from './logger';

export interface ShutdownHandler {
  name: string;
  priority: number; // Lower number = earlier shutdown (1 = first, 10 = last)
  shutdown: () => Promise<void>;
}

class GracefulShutdownManager {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  /**
   * Register a shutdown handler with priority
   */
  register(handler: ShutdownHandler): void {
    this.handlers.push(handler);
    // Sort by priority (lower number = higher priority = shutdown first)
    this.handlers.sort((a, b) => a.priority - b.priority);
    logger.debug(
      { name: handler.name, priority: handler.priority },
      'Registered shutdown handler'
    );
  }

  /**
   * Execute graceful shutdown in sequence
   */
  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring duplicate signal');
      return;
    }

    this.isShuttingDown = true;
    logger.info(
      { signal, handlersCount: this.handlers.length },
      '🛑 Starting graceful shutdown sequence...'
    );

    let successCount = 0;
    let failedCount = 0;

    for (const handler of this.handlers) {
      const startTime = Date.now();
      try {
        logger.info(
          { handler: handler.name, priority: handler.priority },
          `[SHUTDOWN] 🔄 ${handler.name} - Stopping...`
        );

        await handler.shutdown();

        const duration = Date.now() - startTime;
        logger.info(
          { handler: handler.name, duration: `${duration}ms` },
          `[SHUTDOWN] ✅ ${handler.name} - Stopped successfully`
        );
        successCount++;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(
          { handler: handler.name, error, duration: `${duration}ms` },
          `[SHUTDOWN] ❌ ${handler.name} - Failed to stop gracefully`
        );
        failedCount++;
        // Continue with other handlers despite failure
      }
    }

    logger.info(
      {
        total: this.handlers.length,
        success: successCount,
        failed: failedCount,
        signal,
      },
      '🏁 Graceful shutdown complete'
    );

    if (failedCount > 0) {
      logger.warn(
        { failedHandlers: failedCount },
        'Some handlers failed to shutdown gracefully'
      );
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }
}

// Global singleton instance
const shutdownManager = new GracefulShutdownManager();

/**
 * Setup signal handlers for graceful shutdown
 */
export function setupGracefulShutdown(): void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

  signals.forEach((signal) => {
    process.on(signal as NodeJS.Signals, () => {
      logger.info({ signal }, `Received ${signal} signal`);
      shutdownManager.shutdown(signal).then(() => {
        process.exit(signal === 'SIGTERM' ? 0 : 0);
      });
    });
  });

  logger.info(
    { signals },
    '✅ Graceful shutdown handlers registered'
  );
}

/**
 * Register a shutdown handler
 */
export function registerShutdownHandler(handler: ShutdownHandler): void {
  shutdownManager.register(handler);
}

/**
 * Check if shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return shutdownManager.isShutdownInProgress();
}

export default shutdownManager;
