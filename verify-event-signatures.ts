import { createPublicClient, http, toEventSig, parseAbiItem } from 'viem';
import { simpleBankAbi } from './src/abis/simple-bank';

const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const CONTRACT_ADDRESS = process.env.TOKEN_CONTRACT_ADDRESS as `0x${string}` || '0x172076e0166d1f9cc711c77adf8488051744980c';

async function verifyEventSignatures() {
  console.log('🔍 Event Signature Verification Tool');
  console.log('=====================================\n');
  console.log('RPC URL:', RPC_URL);
  console.log('Contract:', CONTRACT_ADDRESS);
  console.log('');

  const client = createPublicClient({
    transport: http(RPC_URL),
  });

  // 1. Extract event signatures from ABI
  console.log('📋 Event Signatures in ABI:');
  console.log('----------------------------');

  const abiEvents = simpleBankAbi.filter(item => item.type === 'event');
  abiEvents.forEach(event => {
    const eventSignature = `${event.name}(${event.inputs.map((i: any) => `${i.type}${i.indexed ? ' indexed' : ''}`).join(',')})`;
    const eventHash = toEventSig(parseAbiItem(eventSignature as any));

    console.log(`\n${event.name}:`);
    console.log(`  Signature: ${eventSignature}`);
    console.log(`  Hash:      ${eventHash}`);
  });

  // 2. Get actual logs from chain
  console.log('\n\n🔗 Actual Event Logs on Chain:');
  console.log('--------------------------------');

  const latestBlock = await client.getBlockNumber();
  const logs = await client.getLogs({
    address: CONTRACT_ADDRESS,
    fromBlock: 0n,
    toBlock: latestBlock,
  });

  console.log(`\nFound ${logs.length} total event logs\n`);

  // Group by event signature (topics[0])
  const eventGroups = logs.reduce((acc, log) => {
    const signature = log.topics[0];
    if (!acc[signature]) {
      acc[signature] = [];
    }
    acc[signature].push(log);
    return acc;
  }, {} as Record<string, any[]>);

  console.log('Event Signature Distribution:');
  console.log('------------------------------');

  Object.entries(eventGroups).forEach(([signature, logs]) => {
    console.log(`\n${signature}:`);
    console.log(`  Count: ${logs.length}`);
    console.log(`  First occurrence: Block ${logs[0].blockNumber}`);

    // Try to decode with our ABI
    try {
      const decoded = logs[0];
      // Find matching event in ABI
      const matchingEvent = abiEvents.find((event: any) => {
        const eventSig = toEventSig(parseAbiItem(event));
        return eventSig === signature;
      });

      if (matchingEvent) {
        console.log(`  ✅ Matches ABI event: ${(matchingEvent as any).name}`);
      } else {
        console.log(`  ⚠️  No match found in ABI!`);
      }
    } catch (error) {
      console.log(`  ❌ Decode error: ${error}`);
    }
  });

  // 3. Detailed analysis of Transfer events
  console.log('\n\n🎯 Transfer Event Analysis:');
  console.log('------------------------------');

  const transferSig = toEventSig(parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 amount, uint256 timestamp)'));
  console.log('Looking for Transfer signature:', transferSig);

  const transferLogs = eventGroups[transferSig] || [];
  console.log(`Found ${transferLogs.length} Transfer events\n`);

  if (transferLogs.length > 0) {
    console.log('Sample Transfer events (first 3):');
    transferLogs.slice(0, 3).forEach((log, i) => {
      console.log(`\n${i + 1}. Block ${log.blockNumber}:`);
      console.log(`   TX:  ${log.transactionHash}`);
      console.log(`   Topics: ${log.topics.length}`);
      console.log(`   Data:   ${log.data.substring(0, 50)}...`);

      // Try to decode
      try {
        const decoded = decodeEventLog({
          abi: simpleBankAbi,
          data: log.data,
          topics: log.topics,
        });
        console.log(`   ✅ Decoded:`, decoded.args);
      } catch (error) {
        console.log(`   ❌ Decode failed: ${error}`);
      }
    });
  }

  console.log('\n\n✅ Verification complete!');
}

// Helper function
function decodeEventLog(params: any) {
  const { decodeEventLog } = require('viem');
  return decodeEventLog(params);
}

verifyEventSignatures().catch(console.error);
