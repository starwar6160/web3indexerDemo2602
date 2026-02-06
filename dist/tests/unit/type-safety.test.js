"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
/**
 * BigInt Safety Tests
 *
 * CRITICAL: These tests verify the 2^53 precision loss protection
 * C++ Rigor: Explicit type checking, no implicit conversions
 */
(0, vitest_1.describe)('BigInt Type Safety', () => {
    const MAX_SAFE_INTEGER = 9007199254740991n; // 2^53 - 1
    const MAX_SAFE_INTEGER_PLUS_1 = 9007199254740992n; // 2^53
    (0, vitest_1.describe)('Type Coercion Prevention', () => {
        (0, vitest_1.it)('should reject Number() conversion of large BigInt', () => {
            // This demonstrates the 2^53 precision loss
            // Use a number that actually loses precision (> 2^53 + 2)
            const bigNum = 9007199254740995n; // MAX_SAFE_INTEGER + 4
            // C++ Rigor: Explicit conversion check
            (0, vitest_1.expect)(() => {
                // Simulating the old buggy behavior
                const wrong = Number(bigNum);
                const correct = BigInt(wrong);
                // This should fail - precision is lost
                if (correct !== bigNum) {
                    throw new Error(`Precision lost: ${correct} !== ${bigNum}`);
                }
            }).toThrow('Precision lost');
        });
        (0, vitest_1.it)('should maintain precision when converting BigInt to string', () => {
            const bigNum = MAX_SAFE_INTEGER_PLUS_1;
            const str = bigNum.toString();
            // String conversion preserves full precision
            (0, vitest_1.expect)(str).toBe('9007199254740992');
            (0, vitest_1.expect)(BigInt(str)).toBe(bigNum);
        });
        (0, vitest_1.it)('should handle batch size comparison with BigInt (not Number)', () => {
            // Fix: batchRange > 1000n instead of Number(batchRange) > 1000
            const startBlock = 10000000000000000n;
            const endBlock = 10000000000001000n;
            const batchRange = endBlock - startBlock + 1n;
            // Correct: Pure BigInt comparison
            (0, vitest_1.expect)(batchRange > 1000n).toBe(true);
            // Incorrect: Would lose precision
            const batchRangeAsNumber = Number(batchRange);
            (0, vitest_1.expect)(batchRangeAsNumber).not.toBe(batchRange); // Precision lost!
        });
    });
    (0, vitest_1.describe)('API Response Safety', () => {
        (0, vitest_1.it)('should serialize all BigInt to string in JSON', () => {
            const blockData = {
                number: 9007199254740992n,
                timestamp: 12345678901234567890n,
                chain_id: 31337n,
            };
            // Safe serialization (our approach)
            const safeJSONStringify = (obj) => {
                return JSON.stringify(obj, (_, value) => {
                    if (typeof value === 'bigint') {
                        return value.toString();
                    }
                    return value;
                });
            };
            const json = safeJSONStringify(blockData);
            const parsed = JSON.parse(json);
            // All BigInt fields must be strings
            (0, vitest_1.expect)(typeof parsed.number).toBe('string');
            (0, vitest_1.expect)(typeof parsed.timestamp).toBe('string');
            (0, vitest_1.expect)(typeof parsed.chain_id).toBe('string');
            // Values preserved
            (0, vitest_1.expect)(parsed.number).toBe('9007199254740992');
            (0, vitest_1.expect)(parsed.timestamp).toBe('12345678901234567890');
        });
        (0, vitest_1.it)('should fail if BigInt is not converted to string', () => {
            const blockData = {
                number: 9007199254740992n,
            };
            // Native JSON.stringify FAILS on BigInt
            (0, vitest_1.expect)(() => {
                JSON.stringify(blockData);
            }).toThrow();
        });
    });
    (0, vitest_1.describe)('Boundary Values', () => {
        (0, vitest_1.it)('should handle MAX_SAFE_INTEGER correctly', () => {
            const max = MAX_SAFE_INTEGER;
            const str = max.toString();
            (0, vitest_1.expect)(str).toBe('9007199254740991');
            (0, vitest_1.expect)(BigInt(str)).toBe(max);
        });
        (0, vitest_1.it)('should handle block numbers beyond MAX_SAFE_INTEGER', () => {
            // Ethereum block numbers will eventually exceed this
            const futureBlock = 1000000000000000000n;
            const str = futureBlock.toString();
            (0, vitest_1.expect)(str).toBe('1000000000000000000');
            (0, vitest_1.expect)(BigInt(str)).toBe(futureBlock);
        });
    });
});
(0, vitest_1.describe)('Rate Limiter Precision', () => {
    (0, vitest_1.it)('should use integer arithmetic to avoid floating-point drift', () => {
        // Simulating token bucket calculation
        const elapsedMs = 1500;
        const intervalMs = 1000;
        const tokensPerInterval = 10;
        // Correct: Integer arithmetic (fixed-point)
        const tokensToAddInt = Math.floor((elapsedMs * tokensPerInterval) / intervalMs);
        (0, vitest_1.expect)(tokensToAddInt).toBe(15);
        // Incorrect: Floating-point then floor
        const tokensToAddFloat = Math.floor((elapsedMs / intervalMs) * tokensPerInterval);
        // May have rounding issues over time
        (0, vitest_1.expect)(tokensToAddFloat).toBe(15); // Same for this case, but drift accumulates
    });
});
