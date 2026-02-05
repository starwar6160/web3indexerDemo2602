"use strict";
/**
 * Reorganization handling tests
 * Tests the indexer's ability to detect and handle chain reorganizations
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runReorgTests = runReorgTests;
const block_repository_1 = require("../database/block-repository");
const reorg_handler_1 = require("../utils/reorg-handler");
const database_config_1 = require("../database/database-config");
async function setupTestDatabase() {
    await (0, database_config_1.createDbConnection)();
    const { initDatabase } = await Promise.resolve().then(() => __importStar(require('../database/init-database')));
    await initDatabase();
}
async function cleanupTestDatabase() {
    const db = (0, database_config_1.createDbConnection)();
    await db.deleteFrom('blocks').execute();
    await (0, database_config_1.closeDbConnection)();
}
/**
 * Test 1: Simple reorg detection
 */
async function testSimpleReorgDetection() {
    console.log('\n=== Test 1: Simple Reorg Detection ===');
    await setupTestDatabase();
    const repo = new block_repository_1.BlockRepository();
    try {
        // Insert initial blocks 0-9
        const blocks = [];
        for (let i = 0; i < 10; i++) {
            blocks.push({
                number: BigInt(i),
                hash: `0x${i.toString(16).padStart(64, '0')}`,
                parent_hash: i === 0 ? '0x0' : `0x${(i - 1).toString(16).padStart(64, '0')}`,
                timestamp: Math.floor(Date.now() / 1000),
            });
        }
        await repo.createMany(blocks);
        console.log('✅ Inserted 10 blocks');
        // Try to add block 10 with different parent hash (reorg scenario)
        const reorgResult = await (0, reorg_handler_1.detectReorg)(repo, '0xdifferent', // New hash
        10n, '0x9' // Expected parent hash
        );
        console.log('Reorg detection result:', reorgResult);
        console.assert(!reorgResult.detected, 'Should not detect reorg for new block');
        console.log('✅ Test 1 passed: No false positive reorg detection');
    }
    finally {
        await cleanupTestDatabase();
    }
}
/**
 * Test 2: Reorg with existing block at same height
 */
async function testReorgWithExistingBlock() {
    console.log('\n=== Test 2: Reorg With Existing Block ===');
    await setupTestDatabase();
    const repo = new block_repository_1.BlockRepository();
    try {
        // Insert blocks 0-9
        const blocks = [];
        for (let i = 0; i < 10; i++) {
            blocks.push({
                number: BigInt(i),
                hash: `0xoriginal${i.toString().padStart(60, '0')}`,
                parent_hash: i === 0
                    ? '0x0'
                    : `0xoriginal${(i - 1).toString().padStart(60, '0')}`,
                timestamp: Math.floor(Date.now() / 1000),
            });
        }
        await repo.createMany(blocks);
        console.log('✅ Inserted 10 original blocks');
        // Detect reorg when trying to add different block 10
        const reorgResult = await (0, reorg_handler_1.detectReorg)(repo, '0xnewchain10', // New hash
        10n, '0xoriginal9' // Expected parent (which exists)
        );
        console.log('Reorg detection result:', reorgResult);
        console.assert(!reorgResult.detected, 'Should not detect reorg when parent exists');
        console.log('✅ Test 2 passed: No reorg when parent exists');
    }
    finally {
        await cleanupTestDatabase();
    }
}
/**
 * Test 3: Chain continuity verification
 */
async function testChainContinuity() {
    console.log('\n=== Test 3: Chain Continuity Verification ===');
    await setupTestDatabase();
    const repo = new block_repository_1.BlockRepository();
    try {
        // Insert genesis and block 1
        const genesisBlock = {
            number: 0n,
            hash: '0x0',
            parent_hash: '0x0',
            timestamp: Math.floor(Date.now() / 1000),
        };
        await repo.create(genesisBlock);
        console.log('✅ Inserted genesis block');
        // Verify genesis block (no parent needed)
        await (0, reorg_handler_1.verifyChainContinuity)(repo, 0n, '0x0');
        console.log('✅ Genesis block continuity verified');
        // Try to add block 1 with correct parent
        await (0, reorg_handler_1.verifyChainContinuity)(repo, 1n, '0x0');
        console.log('✅ Block 1 continuity verified');
        // Try to add block 2 with missing parent
        try {
            await (0, reorg_handler_1.verifyChainContinuity)(repo, 2n, '0xmissing');
            console.error('❌ Should have thrown error for missing parent');
        }
        catch (error) {
            console.log('✅ Correctly rejected block with missing parent');
        }
        console.log('✅ Test 3 passed: Chain continuity verification works');
    }
    finally {
        await cleanupTestDatabase();
    }
}
/**
 * Test 4: Reorg rollback
 */
async function testReorgRollback() {
    console.log('\n=== Test 4: Reorg Rollback ===');
    await setupTestDatabase();
    const repo = new block_repository_1.BlockRepository();
    try {
        // Insert blocks 0-19
        const blocks = [];
        for (let i = 0; i < 20; i++) {
            blocks.push({
                number: BigInt(i),
                hash: `0x${i.toString(16).padStart(64, '0')}`,
                parent_hash: i === 0
                    ? '0x0'
                    : `0x${(i - 1).toString(16).padStart(64, '0')}`,
                timestamp: Math.floor(Date.now() / 1000),
            });
        }
        await repo.createMany(blocks);
        console.log('✅ Inserted 20 blocks');
        const countBefore = await repo.getBlockCount();
        console.log(`Blocks before reorg: ${countBefore}`);
        // Handle reorg back to block 15
        const deletedCount = await (0, reorg_handler_1.handleReorg)(repo, 15n);
        console.log(`Deleted ${deletedCount} blocks`);
        const countAfter = await repo.getBlockCount();
        console.log(`Blocks after reorg: ${countAfter}`);
        console.assert(countAfter === 16, 'Should have 16 blocks after rollback');
        console.assert(deletedCount === 4, 'Should have deleted 4 blocks');
        const maxBlock = await repo.getMaxBlockNumber();
        console.assert(maxBlock === 15n, 'Max block should be 15');
        console.log('✅ Test 4 passed: Reorg rollback works correctly');
    }
    finally {
        await cleanupTestDatabase();
    }
}
/**
 * Run all reorg tests
 */
async function runReorgTests() {
    console.log('🧪 Running Reorganization Tests...\n');
    try {
        await testSimpleReorgDetection();
        await testReorgWithExistingBlock();
        await testChainContinuity();
        await testReorgRollback();
        console.log('\n✅ All reorg tests passed!');
    }
    catch (error) {
        console.error('\n❌ Reorg test failed:', error);
        process.exit(1);
    }
}
// Run tests if this file is executed directly
if (require.main === module) {
    runReorgTests();
}
