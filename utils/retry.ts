/**
 * Exponential backoff with jitter for retry operations
 * Prevents thundering herd problem and improves resilience
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, higher = more randomness
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  jitterFactor: 0.5,
};

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter: +/- jitterFactor * delay
  const jitter = cappedDelay * options.jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, Math.floor(cappedDelay + jitter));
}

/**
 * Retry function with exponential backoff and jitter
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  customOptions?: Partial<RetryOptions>
): Promise<RetryResult<T>> {
  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const data = await operation();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on the last attempt
      if (attempt === options.maxRetries) {
        break;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, options);
      totalDelayMs += delay;

      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: options.maxRetries + 1,
    totalDelayMs,
  };
}

/**
 * Retry with specific error filtering
 */
export async function retryWithBackoffSelective<T>(
  operation: () => Promise<T>,
  isRetriable: (error: Error) => boolean,
  customOptions?: Partial<RetryOptions>
): Promise<RetryResult<T>> {
  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const data = await operation();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retriable
      if (!isRetriable(lastError) || attempt === options.maxRetries) {
        break;
      }

      const delay = calculateDelay(attempt, options);
      totalDelayMs += delay;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: options.maxRetries + 1,
    totalDelayMs,
  };
}
