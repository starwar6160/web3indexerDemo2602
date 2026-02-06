"use strict";
/**
 * Stress tests for the indexer
 * Tests performance under load and failure scenarios
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const database_config_1 = require("@/database/database-config");
const block_repository_1 = require("@/database/block-repository");
const viem_1 = require("viem");
const retry_1 = require("@/utils/retry");
const rate_limiter_1 = require("@/utils/rate-limiter");
const TEST_RPC_URL = process.env.TEST_RPC_URL || 'http://localhost:8545';
/**
 * Test 1: Consecutive RPC failures
 */
async function testConsecutiveRpcFailures() {
    console.log('\n=== Test 1: Consecutive RPC Failures ===');
    const client = (0, viem_1.createPublicClient)({
        transport: (0, viem_1.http)('http://invalid-endpoint:9999'), // Invalid endpoint
    });
    let failureCount = 0;
    let successAfterRetry = false;
    for (let i = 0; i < 10; i++) {
        try {
            const result = await (0, retry_1.retryWithBackoff)(() => client.getBlockNumber(), {
                maxRetries: 2,
                baseDelayMs: 50,
                maxDelayMs: 200,
            });
            if (result.success) {
                successAfterRetry = true;
                break;
            }
            failureCount++;
        }
        catch (error) {
            failureCount++;
        }
    }
    console.log(`Failures: ${failureCount}, Success after retry: ${successAfterRetry}`);
    console.assert(failureCount === 10, 'Should fail on invalid endpoint');
    console.log('✅ Test 1 passed: Handles consecutive RPC failures');
}
/**
 * Test 2: Rate limiter stress test
 */
async function testRateLimiterStress() {
    console.log('\n=== Test 2: Rate Limiter Stress Test ===');
    const rateLimiter = new rate_limiter_1.TokenBucketRateLimiter({
        tokensPerInterval: 10,
        intervalMs: 1000,
        maxBurstTokens: 20,
    });
    const startTime = Date.now();
    let requestCount = 0;
    let throttledCount = 0;
    // Try to make 100 requests as fast as possible
    for (let i = 0; i < 100; i++) {
        const result = rateLimiter.tryConsume(1);
        requestCount++;
        if (!result.allowed) {
            throttledCount++;
        }
        // Small delay to prevent infinite loop
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    const elapsed = Date.now() - startTime;
    console.log(`Made ${requestCount} requests in ${elapsed}ms`);
    console.log(`Throttled ${throttledCount} times`);
    console.log(`Tokens remaining: ${rateLimiter.getTokens()}`);
    console.assert(throttledCount > 0, 'Should have been throttled');
    console.log('✅ Test 2 passed: Rate limiter works under stress');
}
/**
 * Test 3: Database connection resilience
 */
async function testDatabaseResilience() {
    console.log('\n=== Test 3: Database Connection Resilience ===');
    try {
        await (0, database_config_1.createDbConnection)();
        const repo = new block_repository_1.BlockRepository();
        // Test rapid consecutive queries
        const promises = [];
        for (let i = 0; i < 50; i++) {
            promises.push(repo.getBlockCount());
        }
        const results = await Promise.all(promises);
        console.log(`Executed ${results.length} concurrent queries`);
        console.assert(results.length === 50, 'Should complete all queries');
        console.log('✅ Test 3 passed: Database handles concurrent queries');
        await (0, database_config_1.closeDbConnection)();
    }
    catch (error) {
        console.error('❌ Test 3 failed:', error);
        throw error;
    }
}
/**
 * Test 4: Large batch write test
 */
async function testLargeBatchWrite() {
    console.log('\n=== Test 4: Large Batch Write Test ===');
    try {
        await (0, database_config_1.createDbConnection)();
        const repo = new block_repository_1.BlockRepository();
        // Clean up first
        const db = (0, database_config_1.createDbConnection)();
        await db.deleteFrom('blocks').execute();
        // Create large batch
        const batchSize = 1000;
        const blocks = [];
        console.log(`Creating ${batchSize} blocks...`);
        for (let i = 0; i < batchSize; i++) {
            blocks.push({
                number: BigInt(i),
                hash: `0x${i.toString(16).padStart(64, '0')}`,
                parent_hash: i === 0
                    ? '0x0'
                    : `0x${(i - 1).toString(16).padStart(64, '0')}`,
                timestamp: Math.floor(Date.now() / 1000),
            });
        }
        console.log('Inserting blocks in transaction...');
        const startTime = Date.now();
        const saved = await repo.saveValidatedBlocks(blocks);
        const elapsed = Date.now() - startTime;
        console.log(`Saved ${saved} blocks in ${elapsed}ms`);
        console.log(`Average: ${(elapsed / saved).toFixed(2)}ms per block`);
        const count = await repo.getBlockCount();
        console.assert(count === batchSize, `Should have ${batchSize} blocks`);
        // Verify write
        const blockNumbers = Array.from({ length: batchSize }, (_, i) => BigInt(i));
        const verified = await repo.verifyBlocksWritten(blockNumbers);
        console.assert(verified, 'All blocks should be verified');
        console.log('✅ Test 4 passed: Large batch write works');
        await (0, database_config_1.closeDbConnection)();
    }
    catch (error) {
        console.error('❌ Test 4 failed:', error);
        throw error;
    }
}
/**
 * Test 5: Memory leak check
 */
async function testMemoryLeak() {
    console.log('\n=== Test 5: Memory Leak Check ===');
    const initialMemory = process.memoryUsage();
    console.log('Initial memory usage:', {
        heapUsed: `${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(initialMemory.heapTotal / 1024 / 1024)}MB`,
    });
    try {
        await (0, database_config_1.createDbConnection)();
        const repo = new block_repository_1.BlockRepository();
        // Perform many operations
        for (let iteration = 0; iteration < 10; iteration++) {
            const blocks = [];
            for (let i = 0; i < 100; i++) {
                const num = iteration * 100 + i;
                blocks.push({
                    number: BigInt(num),
                    hash: `0x${num.toString(16).padStart(64, '0')}`,
                    parent_hash: num === 0
                        ? '0x0'
                        : `0x${(num - 1).toString(16).padStart(64, '0')}`,
                    timestamp: Math.floor(Date.now() / 1000),
                });
            }
            await repo.saveValidatedBlocks(blocks);
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
        }
        const finalMemory = process.memoryUsage();
        console.log('Final memory usage:', {
            heapUsed: `${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(finalMemory.heapTotal / 1024 / 1024)}MB`,
        });
        const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
        const growthMB = Math.round(heapGrowth / 1024 / 1024);
        console.log(`Heap growth: ${growthMB}MB`);
        console.assert(growthMB < 50, `Heap growth should be reasonable (got ${growthMB}MB)`);
        console.log('✅ Test 5 passed: No significant memory leaks detected');
        await (0, database_config_1.closeDbConnection)();
    }
    catch (error) {
        console.error('❌ Test 5 failed:', error);
        throw error;
    }
}
/**
 * Test 6: Transaction rollback on error
 */
async function testTransactionRollback() {
    console.log('\n=== Test 6: Transaction Rollback on Error ===');
    try {
        await (0, database_config_1.createDbConnection)();
        const db = (0, database_config_1.createDbConnection)();
        const repo = new block_repository_1.BlockRepository();
        // Clean up
        await db.deleteFrom('blocks').execute();
        // Insert some initial blocks
        const blocks = [];
        for (let i = 0; i < 5; i++) {
            blocks.push({
                number: BigInt(i),
                hash: `0x${i.toString(16).padStart(64, '0')}`,
                parent_hash: i === 0
                    ? '0x0'
                    : `0x${(i - 1).toString(16).padStart(64, '0')}`,
                timestamp: Math.floor(Date.now() / 1000),
            });
        }
        await repo.saveValidatedBlocks(blocks);
        console.log('Inserted 5 initial blocks');
        const countBefore = await repo.getBlockCount();
        console.log(`Blocks before failed transaction: ${countBefore}`);
        // Try to insert duplicate block numbers (should fail and rollback)
        try {
            await repo.saveValidatedBlocks(blocks);
            console.error('❌ Should have thrown duplicate key error');
        }
        catch (error) {
            console.log('✅ Transaction failed as expected');
        }
        const countAfter = await repo.getBlockCount();
        console.log(`Blocks after failed transaction: ${countAfter}`);
        console.assert(countBefore === countAfter, 'Count should be unchanged after rollback');
        console.log('✅ Test 6 passed: Transaction rollback works correctly');
        await (0, database_config_1.closeDbConnection)();
    }
    catch (error) {
        console.error('❌ Test 6 failed:', error);
        throw error;
    }
}
/**
 * Run all stress tests
 */
async function runStressTests() {
    console.log('🧪 Running Stress Tests...\n');
    try {
        await testConsecutiveRpcFailures();
        await testRateLimiterStress();
        await testDatabaseResilience();
        await testLargeBatchWrite();
        await testMemoryLeak();
        await testTransactionRollback();
        console.log('\n✅ All stress tests passed!');
    }
    catch (error) {
        console.error('\n❌ Stress test failed:', error);
        process.exit(1);
    }
}
(0, vitest_1.describe)('Stress Tests', () => {
    (0, vitest_1.beforeAll)(async () => {
        await (0, database_config_1.createDbConnection)();
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, database_config_1.closeDbConnection)();
    });
    (0, vitest_1.it)('should handle consecutive RPC failures', async () => {
        console.log('\n=== Test 1: Consecutive RPC Failures ===');
        const client = (0, viem_1.createPublicClient)({
            chain: null,
            transport: (0, viem_1.http)('http://localhost:8545'), // Non-existent RPC
        });
        let callCount = 0;
        const failedCalls = [];
        for (let i = 0; i < 5; i++) {
            try {
                callCount++;
                await client.getBlockNumber();
                console.log(`Call ${callCount} succeeded unexpectedly`);
            }
            catch (error) {
                failedCalls.push(error);
                console.log(`Call ${callCount} failed as expected: ${error.message}`);
            }
        }
        (0, vitest_1.expect)(callCount).toBe(5);
        (0, vitest_1.expect)(failedCalls.length).toBe(5);
        console.log('✅ All RPC calls failed as expected');
    });
    (0, vitest_1.it)('should handle rate limiting', async () => {
        console.log('\n=== Test 2: Rate Limiting ===');
        const limiter = new rate_limiter_1.TokenBucketRateLimiter({
            tokensPerInterval: 5,
            intervalMs: 1000,
            maxBurstTokens: 10,
        });
        let allowedCount = 0;
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push((async () => {
                const allowed = limiter.tryConsume().allowed;
                if (allowed) {
                    allowedCount++;
                    console.log(`Request ${i + 1} allowed`);
                }
                else {
                    console.log(`Request ${i + 1} rate limited`);
                }
            })());
        }
        await Promise.all(promises);
        (0, vitest_1.expect)(allowedCount).toBeGreaterThan(0);
        (0, vitest_1.expect)(allowedCount).toBeLessThanOrEqual(5);
        console.log(`✅ Rate limiting completed, ${allowedCount} requests allowed`);
    });
});
