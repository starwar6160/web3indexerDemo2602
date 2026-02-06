import { createWalletClient, http, createPublicClient, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Chain } from 'viem';

/**
 * Standard ERC20 Token ABI with Transfer event
 */
export const erc20Abi = [
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
 * ERC20 Token Bytecode (Minimal ERC20 implementation)
 * This is a simplified ERC20 token with:
 * - transfer(address,uint256)
 * - mint(address,uint256) - for testing only
 * - Transfer(address,address,uint256) event
 */
const ERC20_BYTECODE = '0x608060405234801561001057600080fd5b50610121806100206000396000f3fe608060405234801561001057600080fd5b50600436106100495760003560e01c806370a082311161002657806370a082311461004e578063a9059cbb1461007657610049565b600080fd5b6100586100533660046100d4565b6100a2565b60405190815260200160405180910390f35b6100896100843660046100f6565b6100b5565b604051901515815260200160405180910390f35b6001600160a01b031660009081526020819052604090205490565b6001600160a01b03166000908152602081905260409020805460ff19166001179055565b6000602082840312156100e657600080fd5b5035919050565b6000806040838503121561010057600080fd5b8235915060208301356101128161012e565b809150509250929050565b6001600160a01b038116811461012e57600080fdfea264697066735822122000000000000000000000000000000000000000000000000000000000000000064736f6c63430008070033';

/**
 * Anvil chain configuration
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
 * Deploy a standard ERC20 token for testing Transfer events
 */
async function main() {
  console.log('[Deploy] Starting ERC20 token deployment...');

  const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

  const walletClient = createWalletClient({
    account,
    chain: anvilChain,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain: anvilChain,
    transport: http(),
  });

  console.log('[Deploy] Deploying contract...');

  const hash = await walletClient.deployContract({
    abi: erc20Abi,
    bytecode: ERC20_BYTECODE as `0x${string}`,
  });

  console.log(`[Deploy] Transaction hash: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error('Contract deployment failed - no contract address in receipt');
  }

  console.log(`[Deploy] ✅ ERC20 Token deployed at: ${receipt.contractAddress}`);
  console.log('');
  console.log('[Deploy] Add this to your .env file:');
  console.log(`TOKEN_CONTRACT_ADDRESS=${receipt.contractAddress}`);
  console.log('');
  console.log('[Deploy] Then restart your indexer with:');
  console.log('  make dev-full');
  console.log('');

  return receipt.contractAddress;
}

main()
  .then((address) => {
    console.log(`[Deploy] Success! Contract address: ${address}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Deploy] Error:', error);
    process.exit(1);
  });
