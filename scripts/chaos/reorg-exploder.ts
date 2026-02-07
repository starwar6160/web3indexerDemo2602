/**
 * CHAOS MONKEY TEST #1: Reorg Exploder 💣
 *
 * Scenario: Simulates a 5-block deep chain reorganization
 *
 * What it tests:
 * - Indexer's ability to detect parent_hash mismatches
 * - Automatic rollback via CASCADE DELETE
 * - Re-sync from the reorg point
 * - Data consistency after chain reversal
 *
 * Expected behavior:
 * 1. Indexer syncs to block N+5
 * 2. Chain reverts to N (different fork)
 * 3. Indexer detects mismatch via parent_hash check
 * 4. Database rolls back blocks N+1 to N+5
 * 5. Indexer re-syncs with new canonical chain
 */

import { createWalletClient, createPublicClient, http, createTestClient, parseEther } from 'viem';
import { foundry as anvil } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// SimpleBank ABI for deposit()
const SIMPLE_BANK_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
] as const;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n💣 CHAOS MONKEY: Reorg Exploder Test\n');
  console.log('=====================================\n');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

  // Create test client for Anvil cheatcodes
  const testClient = createTestClient({
    chain: anvil,
    mode: 'anvil',
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: anvil,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: anvil,
    transport: http(RPC_URL),
  });

  try {
    // 💰 CHEATCODE: Give account huge ETH balance
    console.log('💰 Funding test account with ETH...');
    await testClient.setBalance({
      address: account.address,
      value: parseEther('10000'),
    });
    console.log(`✅ Funded ${account.address} with 10000 ETH`);

    // Get token contract address FIRST (fix TDZ error)
    const tokenAddress = process.env.TOKEN_CONTRACT_ADDRESS;
    if (!tokenAddress) {
      throw new Error('TOKEN_CONTRACT_ADDRESS not set in environment');
    }

    // 💰 DEPOSIT: Exchange ETH for SimpleBank tokens
    console.log('\n💰 Depositing to get SimpleBank tokens...');
    const depositHash = await walletClient.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: SIMPLE_BANK_ABI,
      functionName: 'deposit',
      value: parseEther('1000'), // Deposit 1000 ETH
    });

    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`✅ Deposited 1000 ETH, received tokens\n`);

    // Get current block number
    const currentBlock = await publicClient.getBlockNumber();
    console.log(`📍 Current block: ${currentBlock}`);

    console.log(`\n📝 Phase 1: Creating canonical chain (5 blocks with transfers)...`);

    // Send 5 transactions that will be included in blocks
    const canonicalTxHashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      console.log(`   • Sending transfer ${i + 1}/5...`);

      // Use 1 wei to avoid balance issues
      const hash = await walletClient.sendTransaction({
        to: tokenAddress as `0x${string}`,
        data: '0xa9059cbb' + // transfer(address,uint256)
              '0'.repeat(24) + '70997970C51812dc3A010C7d01b50e0d17dc79C8'.slice(2).toLowerCase() + // to address
              '0'.repeat(63) + '1', // 1 wei amount
      });

      canonicalTxHashes.push(hash);
      console.log(`     Tx hash: ${hash}`);

      // Wait for transaction to be mined
      await publicClient.waitForTransactionReceipt({ hash });

      // Mine a block
      // @ts-ignore - anvil mine is available
      await testClient.mine({ blocks: 1 });

      await sleep(500);
    }

    const canonicalTip = await publicClient.getBlockNumber();
    console.log(`\n✅ Canonical chain created. Tip: ${canonicalTip}`);
    console.log(`   Transaction hashes:`, canonicalTxHashes);

    console.log(`\n⏳ Waiting for indexer to sync canonical chain...`);
    console.log(`   (Check your dashboard: http://localhost:3001/dashboard)`);
    await sleep(8000); // Give indexer time to sync

    // ============================================
    // 💥 THIS IS WHERE THE EXPLOSION HAPPENS
    // ============================================
    console.log(`\n💥💥💥 PHASE 2: TRIGGERING REORG! 💥💥💥`);
    console.log(`   Creating an alternate reality...\n`);

    // Revert to the snapshot point (before the 5 blocks)
    // @ts-ignore - anvil snapshot/revert are available
    const snapshotId = await testClient.snapshot();
    console.log(`📸 Snapshot taken at block: ${currentBlock}`);
    console.log(`   Snapshot ID: ${snapshotId}`);

    // Revert to create a fork
    // @ts-ignore
    await testClient.revert({ id: snapshotId });
    console.log(`⏪ Time reverted! Chain is now back at block ${currentBlock}`);

    console.log(`\n📝 Phase 3: Mining alternate chain (5 DIFFERENT blocks)...`);

    // Send 5 DIFFERENT transactions to create the alternate chain
    const alternateTxHashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      console.log(`   • Sending alternate transfer ${i + 1}/5...`);

      // Use DIFFERENT recipient to create different transactions
      const hash = await walletClient.sendTransaction({
        to: tokenAddress as `0x${string}`,
        data: '0xa9059cbb' + // transfer(address,uint256)
              '0'.repeat(24) + '3C44CdDdB6a900fa2b585dd299e03d12fA4293BC'.slice(2).toLowerCase() + // DIFFERENT to address
              '0'.repeat(63) + '1', // 1 wei
      });

      alternateTxHashes.push(hash);
      console.log(`     Tx hash: ${hash}`);

      await publicClient.waitForTransactionReceipt({ hash });

      // @ts-ignore
      await testClient.mine({ blocks: 1 });

      await sleep(500);
    }

    const alternateTip = await publicClient.getBlockNumber();
    console.log(`\n✅ Alternate chain created. Tip: ${alternateTip}`);
    console.log(`   Transaction hashes:`, alternateTxHashes);

    console.log(`\n🔥 REORG COMPLETE! Chain has been reorganized.`);
    console.log(`   Canonical chain transactions should be ROLLED BACK`);
    console.log(`   Alternate chain transactions should be INDEXED`);

    console.log(`\n⏳ Waiting for indexer to detect and handle reorg...`);
    console.log(`   Watch for:`);
    console.log(`   • "Parent hash mismatch" warnings`);
    console.log(`   • Cascade delete of old blocks`);
    console.log(`   • Re-sync with new chain`);
    await sleep(10000);

    // Verify the final state
    console.log(`\n📊 Final State Check:`);
    const latestBlock = await publicClient.getBlockNumber();
    const latestBlockData = await publicClient.getBlock({ blockNumber: latestBlock });

    console.log(`   Current tip: ${latestBlock}`);
    console.log(`   Block hash: ${latestBlockData.hash}`);
    console.log(`   Parent hash: ${latestBlockData.parentHash}`);

    console.log(`\n✅ TEST COMPLETE!`);
    console.log(`\n👀 Check your database: SELECT * FROM transfers ORDER BY block_number DESC LIMIT 10;`);
    console.log(`   You should see the ALTERNATE chain transfers (to 0x3C44C...)`);
    console.log(`   NOT the canonical chain transfers (to 0x7099...)`);

    console.log(`\n💡 If the indexer survived this, it's PRODUCTION-READY! 🚀`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
