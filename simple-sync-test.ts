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

  // Index from block 23850 to latest
  const fromBlock = 23850n;
  const toBlock = 23890n;

  console.log(`\n📋 Indexing from block ${fromBlock} to ${toBlock}...`);

  try {
    const count = await indexer.indexEvents(fromBlock, toBlock);
    console.log(`\n✅ Successfully indexed ${count} Transfer events!`);
  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  }
}

manualSync().catch(console.error);
