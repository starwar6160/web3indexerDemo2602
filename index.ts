import { createPublicClient, http, BlockNumber } from 'viem';

const ANVIL_RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000'); // 2 seconds

const client = createPublicClient({
  transport: http(ANVIL_RPC_URL),
});

let retryCount = 0;
const MAX_RETRIES = 3;

async function getBlockNumberWithRetry(): Promise<bigint> {
  try {
    console.log(`[${new Date().toISOString()}] Attempting to get block number (Attempt ${retryCount + 1}/${MAX_RETRIES})`);

    const blockNumber = await client.getBlockNumber();

    // Reset retry count on success
    retryCount = 0;

    console.log(`[${new Date().toISOString()}] Current block number: ${blockNumber}`);
    return blockNumber;
  } catch (error) {
    retryCount++;

    if (retryCount >= MAX_RETRIES) {
      console.error(`[${new Date().toISOString()}] Failed to get block number after ${MAX_RETRIES} attempts. Error:`, error);
      throw error;
    }

    console.warn(`[${new Date().toISOString()}] RPC connection error (attempt ${retryCount}/${MAX_RETRIES}):`, error);

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 1000));
    return getBlockNumberWithRetry();
  }
}

async function pollBlockNumbers(): Promise<void> {
  try {
    while (true) {
      await getBlockNumberWithRetry();

      // Wait for the next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Polling stopped due to error:`, error);

    // Wait longer before retrying after a failure
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Try to restart polling
    console.log(`[${new Date().toISOString()}] Attempting to restart polling...`);
    pollBlockNumbers();
  }
}

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting Web3 block number indexer...`);
  console.log(`[${new Date().toISOString()}] RPC URL: ${ANVIL_RPC_URL}`);
  console.log(`[${new Date().toISOString()}] Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`[${new Date().toISOString()}] Max retries: ${MAX_RETRIES}`);

  try {
    // Test initial connection
    console.log(`[${new Date().toISOString()}] Testing initial RPC connection...`);
    const initialBlock = await client.getBlockNumber();
    console.log(`[${new Date().toISOString()}] Initial block number: ${initialBlock}`);

    // Start polling
    pollBlockNumbers();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Failed to start indexer:`, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n[${new Date().toISOString()}] Received SIGINT. Shutting down gracefully...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n[${new Date().toISOString()}] Received SIGTERM. Shutting down gracefully...`);
  process.exit(0);
});

main().catch(error => {
  console.error(`[${new Date().toISOString()}] Uncaught error in main:`, error);
  process.exit(1);
});