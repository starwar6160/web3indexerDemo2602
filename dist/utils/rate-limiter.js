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
        // Update tokens, capped at max burst
        this.tokens = Math.min(this.options.maxBurstTokens, this.tokens + tokensToAdd);
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
     * Consume token with automatic wait
     */
    async consume(tokens = 1) {
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
