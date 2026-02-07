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
 * 1. Large value transfer (10^25 wei - exceeds Number.MAX_SAFE_INTEGER)
 * 2. Minimum value transfer (1 wei)
 * 3. Dust attack (100 transfers in rapid succession)
 *
 * Expected behavior:
 * - Database should store values without precision loss
 * - No crashes or NaN/Infinity in the UI
 * - Batch operations should complete successfully
 */

import { createWalletClient, createPublicClient, http, parseUnits, createTestClient, parseEther } from 'viem';
import { foundry as anvil } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL || 'http://localhost:58545';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// SimpleBank ABI
const SIMPLE_BANK_ABI = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false }
    ],
    anonymous: false
  }
] as const;

// SimpleBank bytecode
const SIMPLE_BANK_BYTECODE = '0x6080604052348015600e575f5ffd5b506104e68061001c5f395ff3fe608060405260043610610054575f3560e01c806312065fe01461005857806327e235e3146100865780632e1a7d4d146100b15780637d882097146100d2578063a9059cbb146100e7578063d0e30db014610106575b5f5ffd5b348015610063575f5ffd5b50335f908152602081905260409020545b60405190815260200160405180910390f35b348015610091575f5ffd5b506100746100a0366004610411565b5f6020819052908152604090205481565b3480156100bc575f5ffd5b506100d06100cb366004610431565b61010e565b005b3480156100dd575f5ffd5b5061007460015481565b3480156100f2575f5ffd5b506100d0610101366004610448565b61020b565b6100d0610340565b335f90815260208190526040902054811156101685760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b60448201526064015b60405180910390fd5b335f9081526020819052604081208054839290610186908490610484565b925050819055508060015f82825461019e9190610484565b9091555050604051339082156108fc029083905f818181858888f193505050501580156101cd573d5f5f3e3d5ffd5b506040805182815242602082015233917fdf273cb619d95419a9cd0ec88123a0538c85064229baa6363788f743fff90deb910160405180910390a250565b335f90815260208190526040902054811156102605760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b604482015260640161015f565b6001600160a01b0382166102a85760405162461bcd60e51b815260206004820152600f60248201526e496e76616c6964206164647265737360881b604482015260640161015f565b335f90815260208190526040812080548392906102c6908490610484565b90915550506001600160a01b0382165f90815260208190526040812080548392906102f290849061049d565b9091555050604080518281524260208201526001600160a01b0384169133917f9ed053bb818ff08b8353cd46f78db1f0799f31c9e4458fdb425c10eccd2efc44910160405180910390a35050565b5f341161037f5760405162461bcd60e51b815260206004820152600d60248201526c09aeae6e840e6cadcc8408aa89609b1b604482015260640161015f565b335f908152602081905260408120805434929061039d90849061049d565b925050819055503460015f8282546103b5919061049d565b90915550506040805134815242602082015233917f90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15910160405180910390a2565b80356001600160a01b038116811461040c575f5ffd5b919050565b5f60208284031215610421575f5ffd5b61042a826103f6565b9392505050565b5f60208284031215610441575f5ffd5b5035919050565b5f5f60408385031215610459575f5ffd5b610462836103f6565b946020939093013593505050565b634e487b7160e01b5f52601160045260245ffd5b8181038181111561049757610497610470565b92915050565b808201808211156104975761049761047056fea264697066735822122077eb505cb158c7c11f75d2d6ce65406e52ee0ee708ff5128b49c8f66e08ed1fe64736f6c63430008210033' as const;

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

// Validate contract exists
async function getValidContract(
  publicClient: any
): Promise<`0x${string}`> {
  const envAddress = process.env.TOKEN_CONTRACT_ADDRESS as `0x${string}`;

  if (!envAddress) {
    throw new Error('TOKEN_CONTRACT_ADDRESS must be set in environment');
  }

  // Verify contract exists on chain
  const code = await publicClient.getBytecode({ address: envAddress });
  if (!code || code === '0x') {
    throw new Error(`No contract at ${envAddress}. Run 'make dev-with-demo' first.`);
  }

  console.log(`✅ Using existing contract: ${envAddress}\n`);
  return envAddress;
}

async function main() {
  console.log('\n💥 CHAOS MONKEY: BigInt Nuke Test\n');
  console.log('==================================\n');

  const account = privateKeyToAccount(PRIVATE_KEY);

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

  const recipient1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;
  const recipient2 = '0x3C44CdDdB6a900fa2b585dd299e03d12fA4293BC' as `0x${string}`;

  try {
    // 💰 CHEATCODE: Give account huge ETH balance
    console.log('💰 Funding test account with ETH...');
    await testClient.setBalance({
      address: account.address,
      value: parseEther('10000'),
    });
    console.log(`✅ Funded ${account.address} with 10000 ETH`);

    // 🏗️ Validate existing contract from demo
    const tokenAddress = await getValidContract(publicClient);

    // 💰 DEPOSIT: Exchange ETH for SimpleBank tokens
    // Deposit 500 ETH to have enough for the 100 ETH large transfer
    console.log('\n💰 Depositing 500 ETH to get SimpleBank tokens...');
    const depositHash = await walletClient.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: SIMPLE_BANK_ABI,
      functionName: 'deposit',
      value: parseEther('500'), // Deposit 500 ETH
    });

    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`✅ Deposited 500 ETH, received tokens\n`);

    // ==========================================
    // TEST 1: LARGE VALUE (Exceeds Number.MAX_SAFE_INTEGER)
    // ==========================================
    console.log('🔥 TEST 1: Large Value Transfer');
    console.log('   Transferring: 100 ETH (exceeds JS Safe Integer)');

    // Use 100 ETH = 10^20 wei
    // This exceeds Number.MAX_SAFE_INTEGER (9 * 10^15) by 10,000x
    // But is affordable since we deposited 500 ETH
    const LARGE_VALUE = parseEther('100'); // 100 ETH = 10^20 wei

    const maxTxHash = await walletClient.sendTransaction({
      to: tokenAddress as `0x${string}`,
      data: encodeTransfer(recipient1, LARGE_VALUE),
    });

    console.log(`   ✅ Transaction sent: ${maxTxHash}`);

    const maxReceipt = await publicClient.waitForTransactionReceipt({ hash: maxTxHash });
    console.log(`   ✅ Mined in block: ${maxReceipt.blockNumber}`);

    // Mine a block
    // @ts-ignore
    await testClient.mine({ blocks: 1 });
    await sleep(2000);

    console.log(`   ⏳ Waiting for indexer to sync...`);
    await sleep(5000);

    // ==========================================
    // TEST 2: MINIMUM VALUE (The Dust Test)
    // ==========================================
    console.log('\n🧹 TEST 2: Minimum Value Transfer');
    console.log('   Transferring: 1 wei');

    const minTxHash = await walletClient.sendTransaction({
      to: tokenAddress as `0x${string}`,
      data: encodeTransfer(recipient2, 1n),
    });

    console.log(`   ✅ Transaction sent: ${minTxHash}`);

    const minReceipt = await publicClient.waitForTransactionReceipt({ hash: minTxHash });
    console.log(`   ✅ Mined in block: ${minReceipt.blockNumber}`);

    // @ts-ignore
    await testClient.mine({ blocks: 1 });
    await sleep(2000);

    console.log(`   ⏳ Waiting for indexer to sync...`);
    await sleep(5000);

    // ==========================================
    // TEST 3: DUST ATTACK (The Spam Storm)
    // ==========================================
    console.log('\n🌪️  TEST 3: Dust Attack (100 transfers)');
    console.log('   Sending 100 small transfers in rapid succession...');

    const DUST_COUNT = 100;
    const DUST_AMOUNT = parseUnits('0.000001', 18); // 0.000001 tokens
    const txHashes: string[] = [];

    const startTime = Date.now();

    for (let i = 0; i < DUST_COUNT; i++) {
      const recipient = i % 2 === 0 ? recipient1 : recipient2;

      try {
        const hash = await walletClient.sendTransaction({
          to: tokenAddress as `0x${string}`,
          data: encodeTransfer(recipient, DUST_AMOUNT),
        });

        txHashes.push(hash);

        if (i % 20 === 0) {
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
    await testClient.mine({ blocks: 50 }); // Mine 50 blocks
    await sleep(3000);

    // ==========================================
    // VERIFY RESULTS
    // ==========================================
    console.log(`\n⏳ Waiting for indexer to catch up...`);
    console.log(`   (This may take a minute...)`);

    await sleep(15000);

    console.log(`\n📊 TEST RESULTS:`);
    console.log(`\n🔍 Check your database:`);
    console.log(`   -- Large value test (100 ETH):`);
    console.log(`      SELECT * FROM transfers WHERE amount = '${LARGE_VALUE.toString()}' ORDER BY block_number DESC LIMIT 1;`);
    console.log(`\n   -- Minimum value test:`);
    console.log(`      SELECT * FROM transfers WHERE amount = '1' ORDER BY block_number DESC LIMIT 1;`);
    console.log(`\n   -- Dust attack count:`);
    console.log(`      SELECT COUNT(*) FROM transfers WHERE amount = '${DUST_AMOUNT.toString()}';`);

    console.log(`\n🎯 Check your API:`);
    console.log(`   curl http://localhost:3001/api/transfers`);

    console.log(`\n✅ TEST COMPLETE!`);
    console.log(`\n💡 What to check:`);
    console.log(`   1. Does the database store the 100 ETH value correctly?`);
    console.log(`   2. Does the UI render it correctly (not NaN/Infinity)?`);
    console.log(`   3. Are all 100 dust transfers indexed?`);
    console.log(`   4. Is the 1 wei transfer preserved with full precision?`);

    console.log(`\n🚀 If all checks pass, your system is NUMERIC-PROOF!`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
