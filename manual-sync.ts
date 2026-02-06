import { createEventIndexer } from './src/indexer/event-indexer';
import { config } from 'dotenv';

// Load environment variables
config();

const CONTRACT_ADDRESS = process.env.TOKEN_CONTRACT_ADDRESS as `0x${string}`;
const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';

async function manualSync() {
  console.log('🔄 Manual sync test');
  console.log('RPC URL:', RPC_URL);
  console.log('Contract Address:', CONTRACT_ADDRESS);

  const indexer = createEventIndexer(RPC_URL, CONTRACT_ADDRESS);

  // Get current block number
  const currentBlock = await (await fetch(RPC_URL, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }),
  }).then(r => r.json())).result;

  console.log('Current block:', currentBlock);

  // Index from block 23850 to current
  const fromBlock = 23850n;
  const toBlock = BigInt(parseInt(currentBlock, 16));

  console.log(`\n📋 Indexing from block ${fromBlock} to ${toBlock}...`);

  try {
    const count = await indexer.indexEvents(fromBlock, toBlock);
    console.log(`\n✅ Successfully indexed ${count} Transfer events!`);

    // Query database to verify
    const response = await fetch('http://localhost:3000/api/transfers');
    const transfers = await response.json();
    console.log(`\n💾 Database now contains ${transfers.length} transfers`);
  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  }
}

manualSync().catch(console.error);
