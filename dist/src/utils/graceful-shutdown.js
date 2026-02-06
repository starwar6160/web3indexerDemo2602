"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupGracefulShutdown = setupGracefulShutdown;
exports.registerShutdownHandler = registerShutdownHandler;
exports.isShuttingDown = isShuttingDown;
const logger_1 = __importDefault(require("./logger"));
class GracefulShutdownManager {
    constructor() {
        this.handlers = [];
        this.isShuttingDown = false;
    }
    /**
     * Register a shutdown handler with priority
     */
    register(handler) {
        this.handlers.push(handler);
        // Sort by priority (lower number = higher priority = shutdown first)
        this.handlers.sort((a, b) => a.priority - b.priority);
        logger_1.default.debug({ name: handler.name, priority: handler.priority }, 'Registered shutdown handler');
    }
    /**
     * Execute graceful shutdown in sequence
     */
    async shutdown(signal) {
        if (this.isShuttingDown) {
            logger_1.default.warn('Shutdown already in progress, ignoring duplicate signal');
            return;
        }
        this.isShuttingDown = true;
        logger_1.default.info({ signal, handlersCount: this.handlers.length }, '🛑 Starting graceful shutdown sequence...');
        let successCount = 0;
        let failedCount = 0;
        for (const handler of this.handlers) {
            const startTime = Date.now();
            try {
                logger_1.default.info({ handler: handler.name, priority: handler.priority }, `[SHUTDOWN] 🔄 ${handler.name} - Stopping...`);
                await handler.shutdown();
                const duration = Date.now() - startTime;
                logger_1.default.info({ handler: handler.name, duration: `${duration}ms` }, `[SHUTDOWN] ✅ ${handler.name} - Stopped successfully`);
                successCount++;
            }
            catch (error) {
                const duration = Date.now() - startTime;
                logger_1.default.error({ handler: handler.name, error, duration: `${duration}ms` }, `[SHUTDOWN] ❌ ${handler.name} - Failed to stop gracefully`);
                failedCount++;
                // Continue with other handlers despite failure
            }
        }
        logger_1.default.info({
            total: this.handlers.length,
            success: successCount,
            failed: failedCount,
            signal,
        }, '🏁 Graceful shutdown complete');
        if (failedCount > 0) {
            logger_1.default.warn({ failedHandlers: failedCount }, 'Some handlers failed to shutdown gracefully');
        }
    }
    /**
     * Check if shutdown is in progress
     */
    isShutdownInProgress() {
        return this.isShuttingDown;
    }
}
// Global singleton instance
const shutdownManager = new GracefulShutdownManager();
/**
 * Setup signal handlers for graceful shutdown
 */
function setupGracefulShutdown() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
    signals.forEach((signal) => {
        process.on(signal, () => {
            logger_1.default.info({ signal }, `Received ${signal} signal`);
            shutdownManager.shutdown(signal).then(() => {
                process.exit(signal === 'SIGTERM' ? 0 : 0);
            });
        });
    });
    logger_1.default.info({ signals }, '✅ Graceful shutdown handlers registered');
}
/**
 * Register a shutdown handler
 */
function registerShutdownHandler(handler) {
    shutdownManager.register(handler);
}
/**
 * Check if shutdown is in progress
 */
function isShuttingDown() {
    return shutdownManager.isShutdownInProgress();
}
exports.default = shutdownManager;
