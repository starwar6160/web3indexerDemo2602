import pino from 'pino';
import { randomUUID } from 'crypto';

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Log sampler for high-frequency operations
 * Prevents log flooding by sampling logs based on rate
 */
class LogSampler {
  private lastLogTime = 0;
  private minIntervalMs: number;
  private suppressedCount = 0;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  shouldLog(): boolean {
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

  getSuppressedCount(): number {
    return this.suppressedCount;
  }

  reset(): void {
    this.lastLogTime = 0;
    this.suppressedCount = 0;
  }
}

/**
 * Create a logger with trace context
 */
export function createLogger(module: string) {
  return pino({
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
      level: (label: string) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: () => {
      const traceId = getTraceId();
      // 🎨 Fix S1: Handle undefined traceId explicitly
      // Problem: undefined traceId gets serialized as string "undefined" by some serializers
      // Solution: Omit the property entirely if undefined
      const mixinData: { module: string; traceId?: string } = {
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
let currentTraceId: string | undefined;

export function setTraceId(traceId: string): void {
  currentTraceId = traceId;
}

export function getTraceId(): string | undefined {
  return currentTraceId;
}

export function generateTraceId(): string {
  return randomUUID();
}

export async function withTraceId<T>(fn: () => Promise<T>): Promise<T> {
  const prevTraceId = currentTraceId;
  const traceId = generateTraceId();
  setTraceId(traceId);
  try {
    return await fn();
  } finally {
    currentTraceId = prevTraceId;
  }
}

// Default logger
export const logger = createLogger('indexer');

// Pre-configured samplers for different log frequencies
export const logSamplers = {
  // For per-block logs (high frequency)
  perBlock: new LogSampler(1000), // Log at most once per second
  // For batch logs (medium frequency)
  perBatch: new LogSampler(500), // Log at most every 500ms
  // For RPC logs (potentially high frequency)
  perRpc: new LogSampler(100), // Log at most every 100ms
};

export default logger;
