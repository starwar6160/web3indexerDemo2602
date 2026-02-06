import { createPublicClient, http } from 'viem';
import { simpleBankAbi } from './src/abis/simple-bank';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const CONTRACT_ADDRESS = (process.env.SIMPLE_BANK_CONTRACT_ADDRESS || '0x5fbdb2315678afecb367f032d93f642f64180aa3') as `0x${string}`;

async function testTransferEvents() {
  console.log('🔍 Testing Transfer events from SimpleBank contract');
  console.log('RPC URL:', RPC_URL);
  console.log('Contract Address:', CONTRACT_ADDRESS);

  const client = createPublicClient({
    transport: http(RPC_URL),
  });

  // Get latest block
  const latestBlock = await client.getBlockNumber();
  console.log('Latest block:', latestBlock.toString());

  // Query Transfer events
  console.log('\n📋 Querying Transfer events...');
  const logs = await client.getLogs({
    address: CONTRACT_ADDRESS,
    event: {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'amount', type: 'uint256', indexed: false },
        { name: 'timestamp', type: 'uint256', indexed: false },
      ],
    },
    fromBlock: 0n,
    toBlock: latestBlock,
  });

  console.log(`✅ Found ${logs.length} Transfer events!`);

  if (logs.length > 0) {
    console.log('\nFirst 3 Transfer events:');
    logs.slice(0, 3).forEach((log, i) => {
      console.log(`\n${i + 1}. Block ${log.blockNumber}:`);
      console.log('   TX Hash:', log.transactionHash);
      console.log('   From:', log.args.from);
      console.log('   To:', log.args.to);
      console.log('   Amount:', log.args.amount?.toString());
    });
  }
}

testTransferEvents().catch(console.error);
