/**
 * CHAOS MONKEY TEST #3: BigInt Nuke 💥
 *
 * Scenario: Pushes the numeric boundaries of the system
 *
 * What it tests:
 * - Database's ability to handle maximum uint256 values
 * - Precision preservation for tiny amounts (1 wei)
 * - Bulk operations under stress
 * - Frontend rendering of extreme values
 *
 * Chaos injection:
 * 1. Maximum value transfer (2^256 - 1)
 * 2. Minimum value transfer (1 wei)
 * 3. Dust attack (1000 transfers in rapid succession)
 *
 * Expected behavior:
 * - Database should store values without precision loss
 * - No crashes or NaN/Infinity in the UI
 * - Batch operations should complete successfully
 */

import { createWalletClient, createPublicClient, http, parseUnits, maxUint256 } from 'viem';
import { foundry as anvil } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT_ADDRESS;

// ERC20 Transfer signature: transfer(address,uint256)
const TRANSFER_SELECTOR = '0xa9059cbb';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeTransfer(to: string, amount: bigint): `0x${string}` {
  const toEncoded = to.toLowerCase().slice(2).padStart(64, '0');
  const amountEncoded = amount.toString(16).padStart(64, '0');
  return `${TRANSFER_SELECTOR}${toEncoded}${amountEncoded}` as `0x${string}`;
}

async function main() {
  console.log('\n💥 CHAOS MONKEY: BigInt Nuke Test\n');
  console.log('==================================\n');

  if (!TOKEN_CONTRACT) {
    console.error('❌ TOKEN_CONTRACT_ADDRESS not set in .env');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: anvil,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: anvil,
    transport: http(RPC_URL),
  });

  const recipient1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;
  const recipient2 = '0x3C44CdDdB6a900fa2b585dd299e03d12fA4293BC' as `0x${string}`;

  try {
    // ==========================================
    // TEST 1: MAXIMUM VALUE (The Universe Nuke)
    // ==========================================
    console.log('🔥 TEST 1: Maximum Value Transfer');
    console.log('   Transferring: 2^256 - 1 wei (uint256 max)');
    console.log(`   This is ${maxUint256.toString()} wei`);

    const maxTxHash = await walletClient.sendTransaction({
      to: TOKEN_CONTRACT as `0x${string}`,
      data: encodeTransfer(recipient1, maxUint256),
    });

    console.log(`   ✅ Transaction sent: ${maxTxHash}`);

    const maxReceipt = await publicClient.waitForTransactionReceipt({ hash: maxTxHash });
    console.log(`   ✅ Mined in block: ${maxReceipt.blockNumber}`);

    // Mine a block
    // @ts-ignore
    await publicClient.extend({ mine: 1 });
    await sleep(2000);

    console.log(`   ⏳ Waiting for indexer to sync...`);
    await sleep(5000);

    // ==========================================
    // TEST 2: MINIMUM VALUE (The Dust Test)
    // ==========================================
    console.log('\n🧹 TEST 2: Minimum Value Transfer');
    console.log('   Transferring: 1 wei');

    const minTxHash = await walletClient.sendTransaction({
      to: TOKEN_CONTRACT as `0x${string}`,
      data: encodeTransfer(recipient2, 1n),
    });

    console.log(`   ✅ Transaction sent: ${minTxHash}`);

    const minReceipt = await publicClient.waitForTransactionReceipt({ hash: minTxHash });
    console.log(`   ✅ Mined in block: ${minReceipt.blockNumber}`);

    // @ts-ignore
    await publicClient.extend({ mine: 1 });
    await sleep(2000);

    console.log(`   ⏳ Waiting for indexer to sync...`);
    await sleep(5000);

    // ==========================================
    // TEST 3: DUST ATTACK (The Spam Storm)
    // ==========================================
    console.log('\n🌪️  TEST 3: Dust Attack (1000 transfers)');
    console.log('   Sending 1000 small transfers in rapid succession...');

    const DUST_COUNT = 1000;
    const DUST_AMOUNT = parseUnits('0.000001', 18); // 0.000001 tokens
    const txHashes: string[] = [];

    const startTime = Date.now();

    for (let i = 0; i < DUST_COUNT; i++) {
      const recipient = i % 2 === 0 ? recipient1 : recipient2;

      try {
        const hash = await walletClient.sendTransaction({
          to: TOKEN_CONTRACT as `0x${string}`,
          data: encodeTransfer(recipient, DUST_AMOUNT),
        });

        txHashes.push(hash);

        if (i % 100 === 0) {
          console.log(`   • Sent ${i}/${DUST_COUNT} transactions...`);
        }

        // Small delay to avoid nonce issues
        await sleep(50);
      } catch (error: any) {
        console.error(`   ❌ Error sending transaction ${i}:`, error.message);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`   ✅ Sent ${txHashes.length} transactions in ${elapsed}ms`);
    console.log(`   📊 Average: ${(elapsed / txHashes.length).toFixed(0)}ms per tx`);

    // Mine blocks to include all transactions
    console.log(`\n   ⛏️  Mining blocks to include transactions...`);

    // @ts-ignore
    await publicClient.extend({ mine: 100 }); // Mine 100 blocks
    await sleep(3000);

    // ==========================================
    // VERIFY RESULTS
    // ==========================================
    console.log(`\n⏳ Waiting for indexer to catch up...`);
    console.log(`   (This may take a minute...)`);

    await sleep(15000);

    console.log(`\n📊 TEST RESULTS:`);
    console.log(`\n🔍 Check your database:`);
    console.log(`   -- Maximum value test:`);
    console.log(`      SELECT * FROM transfers WHERE amount = '${maxUint256.toString()}' ORDER BY block_number DESC LIMIT 1;`);
    console.log(`\n   -- Minimum value test:`);
    console.log(`      SELECT * FROM transfers WHERE amount = '1' ORDER BY block_number DESC LIMIT 1;`);
    console.log(`\n   -- Dust attack count:`);
    console.log(`      SELECT COUNT(*) FROM transfers WHERE amount = '${DUST_AMOUNT.toString()}';`);

    console.log(`\n🎯 Check your API:`);
    console.log(`   curl http://localhost:3001/api/transfers`);

    console.log(`\n✅ TEST COMPLETE!`);
    console.log(`\n💡 What to check:`);
    console.log(`   1. Does the database store the full 2^256-1 value?`);
    console.log(`   2. Does the UI render it correctly (not NaN/Infinity)?`);
    console.log(`   3. Are all 1000 dust transfers indexed?`);
    console.log(`   4. Is the 1 wei transfer preserved with full precision?`);

    console.log(`\n🚀 If all checks pass, your system is NUMERIC-PROOF!`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
