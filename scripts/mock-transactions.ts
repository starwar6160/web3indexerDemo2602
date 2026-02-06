import { createWalletClient, http, parseEther, type Address, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import type { Chain } from 'viem';

/**
 * SimpleBank ABI - Phase 3: 事件解析
 */
export const simpleBankAbi = [
  {
    "type": "function",
    "name": "deposit",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [{ "name": "amount", "type": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getBalance",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Deposit",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false },
      { "name": "timestamp", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawal",
    "inputs": [
      { "name": "to", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false },
      { "name": "timestamp", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true },
      { "name": "to", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false },
      { "name": "timestamp", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  }
] as const;

/**
 * 本地 Anvil 链配置
 */
const anvilChain: Chain = {
  id: 31337,
  name: 'Anvil',
  network: 'anvil',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
    public: { http: ['http://localhost:8545'] },
  },
};

/**
 * 模拟交易生成器
 * Phase 3: 用于测试事件索引
 * 
 * 用法:
 * ```ts
 * const mock = new MockTransactionGenerator('http://localhost:8545');
 * await mock.deployContract();
 * await mock.startGenerating(5000); // 每5秒生成一笔交易
 * ```
 */
export class MockTransactionGenerator {
  private client: ReturnType<typeof createWalletClient>;
  private publicClient: ReturnType<typeof createPublicClient>;
  private accounts: ReturnType<typeof privateKeyToAccount>[];
  private contractAddress?: Address;
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;

  constructor(
    rpcUrl: string = 'http://localhost:8545',
    privateKeys: string[] = [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    ]
  ) {
    this.client = createWalletClient({
      chain: anvilChain,
      transport: http(rpcUrl),
    });

    this.publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(rpcUrl),
    });

    this.accounts = privateKeys.map((pk) => privateKeyToAccount(pk as `0x${string}`));
  }

  /**
   * 部署 SimpleBank 合约
   */
  async deployContract(): Promise<Address> {
    console.log('[Mock] Deploying SimpleBank contract...');

    const hash = await this.client.deployContract({
      abi: simpleBankAbi,
      bytecode: '0x608060405234801561001057600080fd5b5061019c806100206000396000f3fe60806040526004361061003f5760003560e01c80632e1a7d4d14610044578063b6b55f251461005a578063d0e30db014610064578063f8b2cb4f1461006e575b600080fd5b61005761005436600461012d565b50565b005b610062610080565b005b6100576100c5565b61008961005436600461012d565b6040516001600160a01b03909116815260200160405180910390f35b6000805460019081016100b6919061014a565b50600080356001600160a01b031681526020810191909152604090205490565b346001600160a01b0316600080356001600160a01b031681526020810191909152604090205490346040516101089190610164565b60405180910390a350565b80356001600160a01b038116811461012857600080fd5b919050565b60006020828403121561013f57600080fd5b61014882610111565b9392505050565b6000821982111561017657634e487b7160e01b600052601160045260246000fd5b500190565b600081830360408201121561018d57600080fd5b610197610111565b9291505056fea2646970667358221220c0c8b8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f0e8f64736f6c63430008070033',
      account: this.accounts[0],
      chain: anvilChain,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    if (!receipt.contractAddress) {
      throw new Error('Contract deployment failed - no contract address in receipt');
    }
    
    this.contractAddress = receipt.contractAddress;

    console.log(`[Mock] Contract deployed at: ${this.contractAddress}`);
    return this.contractAddress;
  }

  /**
   * 生成随机存款交易
   */
  async generateDeposit(): Promise<void> {
    if (!this.contractAddress) {
      throw new Error('Contract not deployed');
    }

    const randomAccount = this.accounts[Math.floor(Math.random() * this.accounts.length)];
    const amount = parseEther((Math.random() * 0.1 + 0.01).toFixed(4)); // 0.01 - 0.11 ETH

    try {
      const hash = await this.client.writeContract({
        address: this.contractAddress,
        abi: simpleBankAbi,
        functionName: 'deposit',
        value: amount,
        account: randomAccount,
        chain: anvilChain,
      });

      console.log(`[Mock] Deposit: ${randomAccount.address} -> ${amount} ETH (tx: ${hash})`);
    } catch (error) {
      console.error('[Mock] Deposit failed:', error);
    }
  }

  /**
   * 开始定期生成交易
   */
  startGenerating(intervalMs: number = 5000): void {
    if (this.isRunning) {
      console.log('[Mock] Already generating transactions');
      return;
    }

    this.isRunning = true;
    console.log(`[Mock] Starting transaction generation every ${intervalMs}ms`);

    this.intervalId = setInterval(() => {
      this.generateDeposit().catch((err) => {
        console.error('[Mock] Failed to generate deposit:', err);
      });
    }, intervalMs);
  }

  /**
   * 停止生成交易
   */
  stopGenerating(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('[Mock] Transaction generation stopped');
  }

  /**
   * 获取合约地址
   */
  getContractAddress(): Address | undefined {
    return this.contractAddress;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const interval = parseInt(process.env.MOCK_INTERVAL || '5000', 10);

  const mock = new MockTransactionGenerator(rpcUrl);

  mock.deployContract()
    .then(() => {
      mock.startGenerating(interval);
      console.log('[Mock] Press Ctrl+C to stop');
    })
    .catch((err) => {
      console.error('[Mock] Failed to start:', err);
      process.exit(1);
    });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Mock] Shutting down...');
    mock.stopGenerating();
    process.exit(0);
  });
}
