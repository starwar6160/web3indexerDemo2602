"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_config_1 = require("./database/database-config");
const checkpoint_repository_1 = require("./database/checkpoint-repository");
const sync_engine_1 = require("./sync-engine");
const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000'); // 5 seconds
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100'); // 100 blocks per batch
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');
const CONFIRMATION_DEPTH = parseInt(process.env.CONFIRMATION_DEPTH || '0'); // Number of blocks to wait before confirming
let isRunning = true;
async function main() {
    console.log(`[${new Date().toISOString()}] 🚀 Starting Enhanced Web3 Block Indexer`);
    console.log(`[${new Date().toISOString()}] RPC URL: ${RPC_URL}`);
    console.log(`[${new Date().toISOString()}] Poll interval: ${POLL_INTERVAL}ms`);
    console.log(`[${new Date().toISOString()}] Batch size: ${BATCH_SIZE}`);
    console.log(`[${new Date().toISOString()}] Max retries: ${MAX_RETRIES}`);
    console.log(`[${new Date().toISOString()}] Confirmation depth: ${CONFIRMATION_DEPTH}`);
    // Initialize database
    console.log(`[${new Date().toISOString()}] Initializing database...`);
    await (0, database_config_1.createDbConnection)();
    // Initialize checkpoint repository
    const checkpointRepo = new checkpoint_repository_1.CheckpointRepository();
    await checkpointRepo.initialize();
    console.log(`[${new Date().toISOString()}] ✅ Checkpoint system initialized`);
    // Create sync engine
    const syncEngine = new sync_engine_1.SyncEngine({
        rpcUrl: RPC_URL,
        batchSize: BATCH_SIZE,
        maxRetries: MAX_RETRIES,
        retryDelayMs: 1000,
        confirmationDepth: CONFIRMATION_DEPTH,
    });
    // Check for existing checkpoint
    const checkpoint = await checkpointRepo.getLatestCheckpoint();
    if (checkpoint) {
        console.log(`[${new Date().toISOString()}] 📍 Found checkpoint at block ${checkpoint.block_number}`);
    }
    // Initial sync and gap repair
    console.log(`[${new Date().toISOString()}] 🔄 Running initial sync and gap repair...`);
    try {
        // First, repair any gaps
        await syncEngine.repairGaps();
        // Then sync to tip
        await syncEngine.syncToTip();
        // Show statistics
        await syncEngine.getStats();
        // Save checkpoint
        const chainTip = await syncEngine['client'].getBlockNumber();
        const tipBlock = await syncEngine['blockRepository'].getMaxBlockNumber();
        const latestBlock = tipBlock ? await syncEngine['blockRepository'].findById(tipBlock) : null;
        if (latestBlock) {
            await checkpointRepo.saveCheckpoint({
                name: 'latest',
                block_number: latestBlock.number,
                block_hash: latestBlock.hash,
                metadata: {
                    chain_tip: chainTip.toString(),
                    confirmation_depth: CONFIRMATION_DEPTH,
                },
            });
            console.log(`[${new Date().toISOString()}] ✅ Checkpoint saved at block ${latestBlock.number}`);
        }
        // Clean up old checkpoints
        const cleaned = await checkpointRepo.cleanupOldCheckpoints(10);
        if (cleaned > 0) {
            console.log(`[${new Date().toISOString()}] 🧹 Cleaned up ${cleaned} old checkpoints`);
        }
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Initial sync failed:`, error);
        throw error;
    }
    // Start polling loop
    console.log(`[${new Date().toISOString()}] 🔍 Starting continuous monitoring...`);
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    while (isRunning) {
        try {
            await syncEngine.syncToTip();
            // Update checkpoint periodically
            const latestBlock = await syncEngine['blockRepository'].getMaxBlockNumber();
            if (latestBlock) {
                const block = await syncEngine['blockRepository'].findById(latestBlock);
                if (block) {
                    await checkpointRepo.saveCheckpoint({
                        name: 'latest',
                        block_number: block.number,
                        block_hash: block.hash,
                        metadata: {
                            chain_tip: (await syncEngine['client'].getBlockNumber()).toString(),
                        },
                    });
                }
            }
            // Reset error counter on success
            consecutiveErrors = 0;
            // Wait for next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
        catch (error) {
            consecutiveErrors++;
            console.error(`[${new Date().toISOString()}] ❌ Sync error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error);
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error(`[${new Date().toISOString()}] ❌ Too many consecutive errors, shutting down`);
                throw error;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
    }
}
// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log(`\n[${new Date().toISOString()}] Received SIGINT. Shutting down gracefully...`);
    isRunning = false;
    await (0, database_config_1.closeDbConnection)();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log(`\n[${new Date().toISOString()}] Received SIGTERM. Shutting down gracefully...`);
    isRunning = false;
    await (0, database_config_1.closeDbConnection)();
    process.exit(0);
});
main().catch(error => {
    console.error(`[${new Date().toISOString()}] ❌ Fatal error:`, error);
    (0, database_config_1.closeDbConnection)().then(() => process.exit(1));
});
