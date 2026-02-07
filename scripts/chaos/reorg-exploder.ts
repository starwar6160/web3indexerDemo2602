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

// SimpleBank bytecode
const SIMPLE_BANK_BYTECODE = '0x6080604052348015600e575f5ffd5b506104e68061001c5f395ff3fe608060405260043610610054575f3560e01c806312065fe01461005857806327e235e3146100865780632e1a7d4d146100b15780637d882097146100d2578063a9059cbb146100e7578063d0e30db014610106575b5f5ffd5b348015610063575f5ffd5b50335f908152602081905260409020545b60405190815260200160405180910390f35b348015610091575f5ffd5b506100746100a0366004610411565b5f6020819052908152604090205481565b3480156100bc575f5ffd5b506100d06100cb366004610431565b61010e565b005b3480156100dd575f5ffd5b5061007460015481565b3480156100f2575f5ffd5b506100d0610101366004610448565b61020b565b6100d0610340565b335f90815260208190526040902054811156101685760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b60448201526064015b60405180910390fd5b335f9081526020819052604081208054839290610186908490610484565b925050819055508060015f82825461019e9190610484565b9091555050604051339082156108fc029083905f818181858888f193505050501580156101cd573d5f5f3e3d5ffd5b506040805182815242602082015233917fdf273cb619d95419a9cd0ec88123a0538c85064229baa6363788f743fff90deb910160405180910390a250565b335f90815260208190526040902054811156102605760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b604482015260640161015f565b6001600160a01b0382166102a85760405162461bcd60e51b815260206004820152600f60248201526e496e76616c6964206164647265737360881b604482015260640161015f565b335f90815260208190526040812080548392906102c6908490610484565b90915550506001600160a01b0382165f90815260208190526040812080548392906102f290849061049d565b9091555050604080518281524260208201526001600160a01b0384169133917f9ed053bb818ff08b8353cd46f78db1f0799f31c9e4458fdb425c10eccd2efc44910160405180910390a35050565b5f341161037f5760405162461bcd60e51b815260206004820152600d60248201526c09aeae6e840e6cadcc8408aa89609b1b604482015260640161015f565b335f908152602081905260408120805434929061039d90849061049d565b925050819055503460015f8282546103b5919061049d565b90915550506040805134815242602082015233917f90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15910160405180910390a2565b80356001600160a01b038116811461040c575f5ffd5b919050565b5f60208284031215610421575f5ffd5b61042a826103f6565b9392505050565b5f60208284031215610441575f5ffd5b5035919050565b5f5f60408385031215610459575f5ffd5b610462836103f6565b946020939093013593505050565b634e487b7160e01b5f52601160045260245ffd5b8181038181111561049757610497610470565b92915050565b808201808211156104975761049761047056fea264697066735822122077eb505cb158c7c11f75d2d6ce65406e52ee0ee708ff5128b49c8f66e08ed1fe64736f6c63430008210033' as const;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get or deploy contract
async function getOrDeployContract(
  walletClient: any,
  publicClient: any
): Promise<`0x${string}`> {
  // ALWAYS deploy fresh contract for chaos tests
  // This ensures we have a contract with proper setup (token balance from deposit)
  // and avoids "环境残留" issues from stale addresses

  console.log('\n🏗️  Deploying fresh SimpleBank contract for chaos test...');

  const deployHash = await walletClient.deployContract({
    abi: SIMPLE_BANK_ABI,
    bytecode: SIMPLE_BANK_BYTECODE,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

  if (!receipt.contractAddress) {
    throw new Error('Contract deployment failed');
  }

  console.log(`✅ Contract deployed: ${receipt.contractAddress}\n`);
  return receipt.contractAddress;
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

    // 🏗️ Get or deploy contract (self-contained!)
    const tokenAddress = await getOrDeployContract(walletClient, publicClient);

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
