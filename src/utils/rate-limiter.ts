/**
 * Token bucket rate limiter for RPC calls
 * Prevents overwhelming the RPC endpoint
 */

export interface RateLimiterOptions {
  tokensPerInterval: number;
  intervalMs: number;
  maxBurstTokens?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  waitTimeMs: number;
  tokensRemaining: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTimestamp: number;
  private options: Required<RateLimiterOptions>;

  constructor(options: RateLimiterOptions) {
    this.options = {
      tokensPerInterval: options.tokensPerInterval,
      intervalMs: options.intervalMs,
      maxBurstTokens: options.maxBurstTokens ?? options.tokensPerInterval * 2,
    };

    // Start with full bucket
    this.tokens = this.options.maxBurstTokens;
    this.lastRefillTimestamp = Date.now();
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTimestamp;

    if (elapsedMs < 1) {
      return; // Not enough time elapsed
    }

    // Calculate tokens to add
    const tokensToAdd = (elapsedMs / this.options.intervalMs) * this.options.tokensPerInterval;

    // Update tokens, capped at max burst
    this.tokens = Math.min(this.options.maxBurstTokens, this.tokens + tokensToAdd);
    this.lastRefillTimestamp = now;
  }

  /**
   * Try to consume a token
   */
  public tryConsume(tokens: number = 1): RateLimitResult {
    this.refill();

    if (this.tokens >= tokens) {
      // Allow request
      this.tokens -= tokens;
      return {
        allowed: true,
        waitTimeMs: 0,
        tokensRemaining: this.tokens,
      };
    }

    // Calculate wait time needed
    const tokensNeeded = tokens - this.tokens;
    const waitTimeMs = (tokensNeeded / this.options.tokensPerInterval) * this.options.intervalMs;

    return {
      allowed: false,
      waitTimeMs: Math.ceil(waitTimeMs),
      tokensRemaining: this.tokens,
    };
  }

  /**
   * Consume token with automatic wait
   */
  public async consume(tokens: number = 1): Promise<void> {
    const result = this.tryConsume(tokens);

    if (!result.allowed && result.waitTimeMs > 0) {
      // Wait until we have enough tokens
      await new Promise(resolve => setTimeout(resolve, result.waitTimeMs));
      // Retry after waiting
      return this.consume(tokens);
    }
  }

  /**
   * Get current token count
   */
  public getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Reset the rate limiter (for testing)
   */
  public reset(): void {
    this.tokens = this.options.maxBurstTokens;
    this.lastRefillTimestamp = Date.now();
  }
}

/**
 * Create a rate-limited wrapper for async functions
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  rateLimiter: TokenBucketRateLimiter,
  tokens: number = 1
): T {
  return (async (...args: Parameters<T>) => {
    await rateLimiter.consume(tokens);
    return fn(...args);
  }) as T;
}
