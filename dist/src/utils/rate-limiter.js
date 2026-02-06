"use strict";
/**
 * Token bucket rate limiter for RPC calls
 * Prevents overwhelming the RPC endpoint
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenBucketRateLimiter = void 0;
exports.withRateLimit = withRateLimit;
class TokenBucketRateLimiter {
    constructor(options) {
        // P0 Fix: Validate tokensPerInterval to prevent division by zero and infinite loops
        if (options.tokensPerInterval <= 0) {
            throw new Error(`Invalid tokensPerInterval: ${options.tokensPerInterval}. ` +
                `Must be > 0 to prevent infinite loops and stack overflow.`);
        }
        if (options.intervalMs <= 0) {
            throw new Error(`Invalid intervalMs: ${options.intervalMs}. Must be > 0.`);
        }
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
    refill() {
        const now = Date.now();
        const elapsedMs = now - this.lastRefillTimestamp;
        if (elapsedMs < 1) {
            return; // Not enough time elapsed
        }
        // Calculate tokens to add
        const tokensToAdd = (elapsedMs / this.options.intervalMs) * this.options.tokensPerInterval;
        // P1 Fix: Use Math.floor to prevent floating point precision drift
        // Long-running processes could accumulate errors without truncation
        this.tokens = Math.floor(Math.min(this.options.maxBurstTokens, this.tokens + tokensToAdd));
        this.lastRefillTimestamp = now;
    }
    /**
     * Try to consume a token
     */
    tryConsume(tokens = 1) {
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
     * Consume token with automatic wait (P0 Fix: loop-based, no recursion)
     */
    async consume(tokens = 1, maxRetries = 100) {
        // P0 Fix: Convert tail recursion to loop to prevent stack overflow
        // Scenario: tokensPerInterval=0 or clock skew causes infinite waitTimeMs
        let retries = 0;
        while (retries < maxRetries) {
            const result = this.tryConsume(tokens);
            if (result.allowed) {
                return; // Success
            }
            if (result.waitTimeMs <= 0) {
                // P0 Fix: Detect invalid state (should not happen with validation)
                throw new Error(`Rate limiter invalid state: waitTimeMs=${result.waitTimeMs}, ` +
                    `tokens=${this.tokens}. Check configuration.`);
            }
            // Wait and retry (loop instead of recursion)
            await new Promise(resolve => setTimeout(resolve, result.waitTimeMs));
            retries++;
        }
        // P0 Fix: Prevent infinite loop detection
        throw new Error(`Rate limiter exceeded max retries (${maxRetries}). ` +
            `Possible configuration error or system time issue.`);
    }
    /**
     * Get current token count
     */
    getTokens() {
        this.refill();
        return this.tokens;
    }
    /**
     * Reset the rate limiter (for testing)
     */
    reset() {
        this.tokens = this.options.maxBurstTokens;
        this.lastRefillTimestamp = Date.now();
    }
}
exports.TokenBucketRateLimiter = TokenBucketRateLimiter;
/**
 * Create a rate-limited wrapper for async functions
 */
function withRateLimit(fn, rateLimiter, tokens = 1) {
    return (async (...args) => {
        await rateLimiter.consume(tokens);
        return fn(...args);
    });
}
