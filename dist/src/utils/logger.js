"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logSamplers = exports.logger = void 0;
exports.createLogger = createLogger;
exports.setTraceId = setTraceId;
exports.getTraceId = getTraceId;
exports.generateTraceId = generateTraceId;
exports.withTraceId = withTraceId;
const pino_1 = __importDefault(require("pino"));
const crypto_1 = require("crypto");
const isDevelopment = process.env.NODE_ENV !== 'production';
/**
 * Log sampler for high-frequency operations
 * Prevents log flooding by sampling logs based on rate
 */
class LogSampler {
    constructor(minIntervalMs) {
        this.lastLogTime = 0;
        this.suppressedCount = 0;
        this.minIntervalMs = minIntervalMs;
    }
    shouldLog() {
        const now = Date.now();
        if (now - this.lastLogTime >= this.minIntervalMs) {
            this.lastLogTime = now;
            const suppressed = this.suppressedCount;
            this.suppressedCount = 0;
            return true;
        }
        this.suppressedCount++;
        return false;
    }
    getSuppressedCount() {
        return this.suppressedCount;
    }
    reset() {
        this.lastLogTime = 0;
        this.suppressedCount = 0;
    }
}
/**
 * Create a logger with trace context
 */
function createLogger(module) {
    return (0, pino_1.default)({
        level: process.env.LOG_LEVEL || 'info',
        transport: isDevelopment
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname',
                },
            }
            : undefined,
        formatters: {
            level: (label) => {
                return { level: label };
            },
        },
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
        mixin: () => {
            const traceId = getTraceId();
            // 🎨 Fix S1: Handle undefined traceId explicitly
            // Problem: undefined traceId gets serialized as string "undefined" by some serializers
            // Solution: Omit the property entirely if undefined
            const mixinData = {
                module,
            };
            if (traceId !== undefined) {
                mixinData.traceId = traceId;
            }
            return mixinData;
        },
    });
}
// Trace ID context (using async local storage would be better, but simple global for now)
let currentTraceId;
function setTraceId(traceId) {
    currentTraceId = traceId;
}
function getTraceId() {
    return currentTraceId;
}
function generateTraceId() {
    return (0, crypto_1.randomUUID)();
}
async function withTraceId(fn) {
    const prevTraceId = currentTraceId;
    const traceId = generateTraceId();
    setTraceId(traceId);
    try {
        return await fn();
    }
    finally {
        currentTraceId = prevTraceId;
    }
}
// Default logger
exports.logger = createLogger('indexer');
// Pre-configured samplers for different log frequencies
exports.logSamplers = {
    // For per-block logs (high frequency)
    perBlock: new LogSampler(1000), // Log at most once per second
    // For batch logs (medium frequency)
    perBatch: new LogSampler(500), // Log at most every 500ms
    // For RPC logs (potentially high frequency)
    perRpc: new LogSampler(100), // Log at most every 100ms
};
exports.default = exports.logger;
