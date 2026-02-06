#!/usr/bin/env ts-node

/**
 * Auto-Deploy SimpleBank Demo Data
 */

import { createWalletClient, http, createPublicClient, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Chain } from 'viem';
import * as fs from 'fs';
import * as path from 'path';

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

const simpleBankAbi = [
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

// SimpleBank bytecode - compiled from contracts/SimpleBank.sol
const SIMPLE_BANK_BYTECODE = '0x6080604052348015600e575f5ffd5b506104e68061001c5f395ff3fe608060405260043610610054575f3560e01c806312065fe01461005857806327e235e3146100865780632e1a7d4d146100b15780637d882097146100d2578063a9059cbb146100e7578063d0e30db014610106575b5f5ffd5b348015610063575f5ffd5b50335f908152602081905260409020545b60405190815260200160405180910390f35b348015610091575f5ffd5b506100746100a0366004610411565b5f6020819052908152604090205481565b3480156100bc575f5ffd5b506100d06100cb366004610431565b61010e565b005b3480156100dd575f5ffd5b5061007460015481565b3480156100f2575f5ffd5b506100d0610101366004610448565b61020b565b6100d0610340565b335f908152602081905260409020548111156101685760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b60448201526064015b60405180910390fd5b335f9081526020819052604081208054839290610186908490610484565b925050819055508060015f82825461019e9190610484565b9091555050604051339082156108fc029083905f818181858888f193505050501580156101cd573d5f5f3e3d5ffd5b506040805182815242602082015233917fdf273cb619d95419a9cd0ec88123a0538c85064229baa6363788f743fff90deb910160405180910390a250565b335f908152602081905260409020548111156102605760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b604482015260640161015f565b6001600160a01b0382166102a85760405162461bcd60e51b815260206004820152600f60248201526e496e76616c6964206164647265737360881b604482015260640161015f565b335f90815260208190526040812080548392906102c6908490610484565b90915550506001600160a01b0382165f90815260208190526040812080548392906102f290849061049d565b9091555050604080518281524260208201526001600160a01b0384169133917f9ed053bb818ff08b8353cd46f78db1f0799f31c9e4458fdb425c10eccd2efc44910160405180910390a35050565b5f341161037f5760405162461bcd60e51b815260206004820152600d60248201526c09aeae6e840e6cadcc8408aa89609b1b604482015260640161015f565b335f908152602081905260408120805434929061039d90849061049d565b925050819055503460015f8282546103b5919061049d565b90915550506040805134815242602082015233917f90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15910160405180910390a2565b80356001600160a01b038116811461040c575f5ffd5b919050565b5f60208284031215610421575f5ffd5b61042a826103f6565b9392505050565b5f60208284031215610441575f5ffd5b5035919050565b5f5f60408385031215610459575f5ffd5b610462836103f6565b946020939093013593505050565b634e487b7160e01b5f52601160045260245ffd5b8181038181111561049757610497610470565b92915050565b808201808211156104975761049761047056fea264697066735822122077eb505cb158c7c11f75d2d6ce65406e52ee0ee708ff5128b49c8f66e08ed1fe64736f6c63430008210033' as const;

const ANVIL_PKS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c82803f146c8e4d3667efb7463',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc8333b8eff4b6b7011844f383',
] as const;

const ACCOUNTS = ANVIL_PKS.map(pk => privateKeyToAccount(pk));

async function main() {
  console.log('\n🎨 Auto-Deploying SimpleBank Demo Data...\n');

  const publicClient = createPublicClient({
    chain: anvilChain,
    transport: http(),
  });

  const deployerWallet = createWalletClient({
    account: ACCOUNTS[0],
    chain: anvilChain,
    transport: http(),
  });

  console.log('1️⃣  Deploying SimpleBank contract...');
  try {
    const deployHash = await deployerWallet.deployContract({
      abi: simpleBankAbi,
      bytecode: SIMPLE_BANK_BYTECODE,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

    if (!receipt.contractAddress) {
      throw new Error('Contract deployment failed');
    }

    const contractAddress = receipt.contractAddress;
    console.log(`   ✅ Contract deployed: ${contractAddress}\n`);

    console.log('2️⃣  Pre-funding accounts...');
    const fundedAccounts: typeof ACCOUNTS = [];
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const account = ACCOUNTS[i];
      const walletClient = createWalletClient({
        account,
        chain: anvilChain,
        transport: http(),
      });
      try {
        const depositHash = await walletClient.writeContract({
          address: contractAddress,
          abi: simpleBankAbi,
          functionName: 'deposit',
          value: parseEther('100'),
        });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
        process.stdout.write(`.`);
        fundedAccounts.push(account);
      } catch {
        process.stdout.write(`x`);
      }
    }
    console.log(` ✅ Funded ${fundedAccounts.length} accounts\n`);

    if (fundedAccounts.length < 2) {
      console.log('❌ Not enough funded accounts to generate transfers');
      process.exit(1);
    }

    console.log('3️⃣  Generating transfers...');
    let txCount = 0;

    for (let i = 0; i < 20; i++) {
      const fromAccount = fundedAccounts[Math.floor(Math.random() * fundedAccounts.length)];
      const toAccount = fundedAccounts[Math.floor(Math.random() * fundedAccounts.length)];

      if (fromAccount.address === toAccount.address) continue;

      const walletClient = createWalletClient({
        account: fromAccount,
        chain: anvilChain,
        transport: http(),
      });

      const randomAmount = Math.floor(Math.random() * 100) + 1; // 1-100 ETH
      const amount = parseEther(randomAmount.toString());

      try {
        // Transfer (accounts already have balance from pre-funding)
        const txHash = await walletClient.writeContract({
          address: contractAddress,
          abi: simpleBankAbi,
          functionName: 'transfer',
          args: [toAccount.address, amount],
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });
        txCount++;

        if (txCount % 5 === 0) {
          console.log(`   • Generated ${txCount} transfers...`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        if (message.includes('Insufficient')) {
          console.log(`   ⚠️  Transfer ${i + 1}: insufficient balance`);
        }
      }
    }

    console.log(`   ✅ Generated ${txCount} transfers\n`);

    console.log('3️⃣  Saving configuration...');
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    envContent = envContent
      .split('\n')
      .filter(line => !line.startsWith('TOKEN_CONTRACT_ADDRESS='))
      .join('\n');

    envContent += `\nTOKEN_CONTRACT_ADDRESS=${contractAddress}\n`;
    fs.writeFileSync(envPath, envContent);
    console.log(`   ✅ Updated .env with TOKEN_CONTRACT_ADDRESS=${contractAddress}\n`);

    console.log('🎉 Demo data generation complete!\n');
    console.log('📊 Summary:');
    console.log(`   • Contract: ${contractAddress}`);
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

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
