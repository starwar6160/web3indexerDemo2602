#!/usr/bin/env ts-node

/**
 * Auto-Deploy ERC20 Demo Data
 *
 * **Purpose**: Automatically deploy ERC20 contract and generate Transfer transactions
 * on startup, so the indexer has real event data to sync immediately.
 *
 * **Usage**: Called automatically by `make dev-with-demo` or `npm run start:with-demo`
 *
 * **Flow**:
 * 1. Deploy ERC20 token contract to Anvil
 * 2. Generate 10-20 Transfer transactions
 * 3. Mine blocks to include transactions
 * 4. Save contract address to .env for indexer
 * 5. Exit so indexer can start syncing
 */

import { createWalletClient, http, createPublicClient, parseUnits, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Chain } from 'viem';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Local Anvil chain configuration
 */
const anvilChain: Chain = {
  id: 31337,
  name: 'Anvil',
  network: 'anvil',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: ['http://localhost:58545'] },
    public: { http: ['http://localhost:58545'] },
  },
};

/**
 * Minimal ERC20 Token ABI
 */
const erc20Abi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'mint',
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
      { name: 'value', type: 'uint256', indexed: false }
    ],
    anonymous: false
  }
] as const;

/**
 * Simple ERC20 Token Bytecode
 */
const ERC20_BYTECODE = '0x608060405234801561001057600080fd5b50610121806100206000396000f3fe608060405234801561001057600080fd5b50600436106100495760003560e01c806370a082311161002657806370a082311461004e578063a9059cbb1461007657610049565b600080fd5b6100586100533660046100d4565b6100a2565b60405190815260200160405180910390f35b6100896100843660046100f6565b6100b5565b604051901515815260200160405180910390f35b6001600160a01b031660009081526020819052604090205490565b6001600160a01b03166000908152602081905260409020805460ff19166001179055565b6000602082840312156100e657600080fd5b5035919050565b6000806040838503121561010057600080fd5b8235915060208301356101128161012e565b809150509250929050565b6001600160a01b038116811461012e57600080fdfea264697066735822122000000000000000000000000000000000000000000000000000000000000000064736f6c63430008070033' as `0x${string}`;

/**
 * Test accounts (Anvil default)
 * Private keys must be exactly 32 bytes (64 hex chars + 0x prefix)
 */
const ACCOUNT_1 = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const ACCOUNT_2 = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ACCOUNT_3 = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const ACCOUNT_4 = privateKeyToAccount('0x70997970c51812dc3a010c7d01b50e0d17dc79c82803f146c8e4d3667efb74631');
const ACCOUNT_5 = privateKeyToAccount('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc8333b8eff4b6b7011844f383');

const ACCOUNTS = [ACCOUNT_1, ACCOUNT_2, ACCOUNT_3, ACCOUNT_4, ACCOUNT_5];

/**
 * Main deployment function
 */
async function main() {
  console.log('\n🎨 Auto-Deploying ERC20 Demo Data...\n');

  // Setup clients
  const publicClient = createPublicClient({
    chain: anvilChain,
    transport: http(),
  });

  const deployerWallet = createWalletClient({
    account: ACCOUNTS[0],
    chain: anvilChain,
    transport: http(),
  });

  // Step 1: Deploy ERC20 Token
  console.log('1️⃣  Deploying ERC20 Token contract...');
  try {
    const deployHash = await deployerWallet.deployContract({
      abi: erc20Abi,
      bytecode: ERC20_BYTECODE,
      args: ['Demo Token', 'DEMO', 18, parseUnits('1000000000', 18)], // 1B tokens
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

    if (!receipt.contractAddress) {
      throw new Error('Contract deployment failed');
    }

    const tokenAddress = receipt.contractAddress;
    console.log(`   ✅ Contract deployed: ${tokenAddress}\n`);

    // Step 2: Generate Transfer transactions
    console.log('2️⃣  Generating Transfer transactions...');

    const transfers: Array<{ from: string; to: string; amount: string; tx: string }> = [];
    let txCount = 0;

    // Generate 20 random transfers
    for (let i = 0; i < 20; i++) {
      const fromAccount = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];
      const toAccount = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];

      // Skip if same account
      if (fromAccount.address === toAccount.address) continue;

      const walletClient = createWalletClient({
        account: fromAccount,
        chain: anvilChain,
        transport: http(),
      });

      // Random amount between 1 and 1000 tokens
      const randomAmount = Math.floor(Math.random() * 1000) + 1;
      const amount = parseUnits(randomAmount.toString(), 18);

      try {
        const txHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [toAccount.address, amount],
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        transfers.push({
          from: fromAccount.address,
          to: toAccount.address,
          amount: amount.toString(),
          tx: txHash,
        });

        txCount++;

        if (txCount % 5 === 0) {
          console.log(`   • Generated ${txCount} transfers...`);
        }
      } catch (error) {
        // Mint tokens to account if they don't have enough
        const mintHash = await deployerWallet.writeContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'mint',
          args: [fromAccount.address, parseUnits('10000', 18)],
        });

        await publicClient.waitForTransactionReceipt({ hash: mintHash });

        // Retry transfer
        const txHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [toAccount.address, amount],
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });

        transfers.push({
          from: fromAccount.address,
          to: toAccount.address,
          amount: amount.toString(),
          tx: txHash,
        });

        txCount++;
      }
    }

    console.log(`   ✅ Generated ${txCount} transfers\n`);

    // Step 3: Save to .env
    console.log('3️⃣  Saving configuration...');
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    // Remove existing TOKEN_CONTRACT_ADDRESS line if exists
    envContent = envContent
      .split('\n')
      .filter(line => !line.startsWith('TOKEN_CONTRACT_ADDRESS='))
      .join('\n');

    // Add new TOKEN_CONTRACT_ADDRESS
    envContent += `\nTOKEN_CONTRACT_ADDRESS=${tokenAddress}\n`;

    fs.writeFileSync(envPath, envContent);
    console.log(`   ✅ Updated .env with TOKEN_CONTRACT_ADDRESS=${tokenAddress}\n`);

    // Step 4: Summary
    console.log('🎉 Demo data generation complete!\n');
    console.log('📊 Summary:');
    console.log(`   • Contract: ${tokenAddress}`);
    console.log(`   • Transfers: ${txCount}`);
    console.log(`   • Blocks mined: ~${txCount + 2}`);
    console.log('');
    console.log('✅ Indexer will now sync these blocks with Transfer events');
    console.log('✅ Dashboard will show "Recent Transfers" with real data\n');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
