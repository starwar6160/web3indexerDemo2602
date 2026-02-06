# 第三、四阶段实施路线图

## 概述

基于当前代码库分析，本文档详细说明了**第三阶段（事件解析）**和**第四阶段（工程化优化）**的具体实施计划。

## 当前状态分析

### ✅ 已完成（第一、二阶段）
- ✅ Reorg 检测和处理
- ✅ 事务隔离
- ✅ 写入验证
- ✅ 重试机制
- ✅ 日志采样
- ✅ 速率限制
- ✅ Trace ID 跟踪

### ⚠️ 待改进（第三、四阶段）

#### 第三阶段：事件解析
1. ❌ 无 transactions 表
2. ❌ 无事件日志解析逻辑
3. ❌ 无合约 ABI 支持
4. ❌ 无大数处理（uint256）
5. ❌ 无复合唯一索引

#### 第四阶段：工程化优化
1. ❌ 无 sync_status 状态跟踪
2. ❌ 无幂等性控制
3. ❌ 无并发控制
4. ❌ 无 mock 交易脚本

## 第三阶段：事件解析核心逻辑

### 目标
实现完整的区块链事件解析和存储功能，支持智能合约事件的监听和解析。

### 3.1 数据库 Schema 扩展

#### transactions 表
```sql
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL UNIQUE,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42),
  amount NUMERIC(78,18),  -- 支持 uint256 和 18 位小数
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  transaction_index INTEGER NOT NULL,
  gas_used BIGINT,
  gas_price NUMERIC(78,18),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 复合唯一约束确保幂等性
  CONSTRAINT uniq_tx_log UNIQUE (block_number, log_index)
);

-- 性能优化索引
CREATE INDEX idx_tx_block ON transactions(block_number);
CREATE INDEX idx_tx_from ON transactions(from_address);
CREATE INDEX idx_tx_hash ON transactions(tx_hash);
```

### 3.2 TypeScript 类型定义

```typescript
// database-types.ts 扩展
export interface Database {
  blocks: BlockTable;
  transactions: TransactionTable;  // 新增
}

export interface TransactionTable {
  id: Generated<number>;
  tx_hash: string;
  from_address: string;
  to_address: string | null;
  amount: string;  // NUMERIC 类型
  block_number: bigint;
  log_index: number;
  transaction_index: number;
  gas_used: bigint | null;
  gas_price: string | null;
  created_at: ColumnType<Date, string | undefined, Date>;
  updated_at: ColumnType<Date, string | undefined, Date>;
}
```

### 3.3 Zod 验证 Schema

```typescript
// schemas.ts 扩展
export const TransactionSchema = z.object({
  tx_hash: z.string().startsWith('0x'),
  from_address: z.string().startsWith('0x'),
  to_address: z.string().startsWith('0x').nullable(),
  amount: z.string(),  // 大数作为字符串处理
  block_number: z.bigint(),
  log_index: z.number(),
  transaction_index: z.number(),
  gas_used: z.bigint().optional(),
  gas_price: z.string().optional(),
});

export type ValidatedTransaction = z.infer<typeof TransactionSchema>;
```

### 3.4 事件日志解析器

```typescript
// utils/event-parser.ts
import { Log, Transaction } from 'viem';
import { Contract } from 'viem';
import { Contractabi } from './abis';

export interface ParsedEvent {
  txHash: string;
  from: string;
  amount: string;
  blockNumber: bigint;
  logIndex: number;
}

export class EventParser {
  private contract: Contract;

  constructor(abi: any[]) {
    this.contract = { abi };
  }

  /**
   * 解析事件日志
   */
  parseLogs(logs: Log[]): ParsedEvent[] {
    return logs
      .filter(log => this.isRelevantLog(log))
      .map(log => this.parseLog(log))
      .filter((log): log is ParsedEvent => log !== null);
  }

  /**
   * 检查是否是相关的事件
   */
  private isRelevantLog(log: Log): boolean {
    // 检查 topics 是否匹配事件签名
    return log.topics[0] === this.eventSignature;
  }

  /**
   * 解析单个日志
   */
  private parseLog(log: Log): ParsedEvent | null {
    try {
      // 使用 viem 的解码功能
      const decoded = this.decodeEventLog(log);

      return {
        txHash: log.transactionHash,
        from: decoded.args.from as string,
        amount: decoded.args.amount.toString(),
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      };
    } catch (error) {
      console.error('Failed to parse log:', error);
      return null;
    }
  }

  private get eventSignature(): string {
    // Keccak256("Sent(address,uint256)")
    return '0x...';
  }
}
```

### 3.5 Transaction Repository

```typescript
// database/transaction-repository.ts
import { getDb } from './database-config';
import { Transaction, NewTransaction } from './database-types';

export class TransactionRepository {
  private db = getDb();

  /**
   * 保存交易（带幂等性控制）
   */
  async saveTransactions(
    transactions: NewTransaction[]
  ): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;

    for (const tx of transactions) {
      try {
        await this.db
          .insertInto('transactions')
          .values(tx)
          .execute();
        inserted++;
      } catch (error) {
        // 唯一约束冲突 = 已存在，跳过
        if (error.code === '23505') {
          skipped++;
        } else {
          throw error;
        }
      }
    }

    return { inserted, skipped };
  }

  /**
   * 获取指定区块的交易
   */
  async getTransactionsByBlock(blockNumber: bigint): Promise<Transaction[]> {
    return await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('block_number', '=', blockNumber)
      .orderBy('log_index', 'asc')
      .execute();
  }

  /**
   * 获取地址的交易历史
   */
  async getTransactionsByAddress(
    address: string,
    limit: number = 100
  ): Promise<Transaction[]> {
    return await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('from_address', '=', address)
      .orderBy('block_number', 'desc')
      .limit(limit)
      .execute();
  }
}
```

## 第四阶段：工程化优化

### 目标
实现生产级的可靠性、性能和可观测性。

### 4.1 Sync Status Tracking

#### sync_status 表
```sql
CREATE TABLE sync_status (
  chain_id INTEGER PRIMARY KEY,
  last_block BIGINT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status VARCHAR(20) NOT NULL,  -- 'syncing', 'caught_up', 'error'
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_status ON sync_status(chain_id);
```

#### SyncStatus Repository
```typescript
// database/sync-status-repository.ts
export class SyncStatusRepository {
  async updateProgress(
    chainId: number,
    blockNumber: bigint,
    status: 'syncing' | 'caught_up' | 'error'
  ): Promise<void> {
    await this.db
      .insertInto('sync_status')
      .values({
        chain_id: chainId,
        last_block: blockNumber,
        sync_status: status,
        last_synced_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.column('chain_id').doUpdateSet({
        last_block: blockNumber,
        sync_status: status,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      .execute();
  }

  async getStatus(chainId: number): Promise<SyncStatus | null> {
    return await this.db
      .selectFrom('sync_status')
      .selectAll()
      .where('chain_id', '=', chainId)
      .executeTakeFirst();
  }
}
```

### 4.2 并发控制

```typescript
// utils/concurrency-control.ts
import pLimit from 'p-limit';

export class ConcurrencyController {
  private limit: ReturnType<typeof pLimit>;

  constructor(maxConcurrency: number = 5) {
    this.limit = pLimit(maxConcurrency);
  }

  /**
   * 并发执行任务
   */
  async executeAll<T, R>(
    items: T[],
    task: (item: T) => Promise<R>
  ): Promise<R[]> {
    const promises = items.map(item =>
      this.limit(() => task(item))
    );

    return await Promise.all(promises);
  }

  /**
   * 获取当前队列状态
   */
  getQueueStatus() {
    return {
      pending: this.limit.pendingCount,
      active: this.limit.activeCount,
    };
  }
}
```

### 4.3 Mock 交易脚本

```typescript
// scripts/mock-transactions.ts
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { simpleBankAbi } from '../abis/simple-bank';

const account = privateKeyToAccount(process.env.PRIVATE_KEY || '0x...');

const client = createWalletClient({
  account,
  transport: http(process.env.RPC_URL || 'http://localhost:8545'),
});

async function deployContract() {
  console.log('[MOCK] Deploying SimpleBank contract...');

  const hash = await client.deployContract({
    abi: simpleBankAbi,
    bytecode: '0x...', // 合约字节码
    args: [],
  });

  console.log(`[MOCK] Contract deployed: ${hash}`);
  return hash;
}

async function generateRandomTransactions() {
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress) {
    throw new Error('CONTRACT_ADDRESS not set');
  }

  console.log('[MOCK] Starting random transaction generation...');
  console.log(`[MOCK] Contract: ${contractAddress}`);

  let txCount = 0;

  setInterval(async () => {
    try {
      const amount = parseEther((Math.random() * 0.1).toFixed(6));

      const hash = await client.writeContract({
        address: contractAddress as `0x${string}`,
        abi: simpleBankAbi,
        functionName: 'deposit',
        value: amount,
      });

      txCount++;
      console.log(`[MOCK] Tx #${txCount}: ${hash} (${amount} ETH)`);
    } catch (error) {
      console.error('[MOCK] Transaction failed:', error);
    }
  }, 5000); // 每5秒一笔交易
}

// 主函数
async function main() {
  if (!process.env.CONTRACT_ADDRESS) {
    await deployContract();
  } else {
    await generateRandomTransactions();
  }
}

main().catch(console.error);
```

### 4.4 增强的索引器

```typescript
// index-events.ts
import { createPublicClient, http } from 'viem';
import { TransactionRepository } from './database/transaction-repository';
import { SyncStatusRepository } from './database/sync-status-repository';
import { EventParser } from './utils/event-parser';
import { ConcurrencyController } from './utils/concurrency-control';
import { retryWithBackoff } from './utils/retry';
import { TokenBucketRateLimiter } from './utils/rate-limiter';
import logger from './utils/logger';

const client = createPublicClient({
  transport: http(process.env.RPC_URL!),
});

const txRepo = new TransactionRepository();
const syncRepo = new SyncStatusRepository();
const eventParser = new EventParser(simpleBankAbi);
const concurrency = new ConcurrencyController(5);
const rateLimiter = new TokenBucketRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 1000,
  maxBurstTokens: 20,
});

/**
 * 同步区块和事件
 */
async function syncBlockWithEvents(blockNumber: bigint): Promise<void> {
  // 速率限制
  await rateLimiter.consume(1);

  // 获取区块（带重试）
  const block = await retryWithBackoff(
    () => client.getBlock({ blockNumber, includeTransactions: true }),
    { maxRetries: 3 }
  );

  if (!block.data) {
    throw new Error(`Failed to fetch block ${blockNumber}`);
  }

  // 获取事件日志
  const logs = await retryWithBackoff(
    () => client.getLogs({
      blockNumber,
      address: [process.env.CONTRACT_ADDRESS as `0x${string}`],
    }),
    { maxRetries: 3 }
  );

  if (!logs.data) {
    throw new Error(`Failed to fetch logs for block ${blockNumber}`);
  }

  // 解析事件
  const events = eventParser.parseLogs(logs.data);

  if (events.length > 0) {
    // 保存交易
    const result = await txRepo.saveTransactions(
      events.map(e => ({
        tx_hash: e.txHash,
        from_address: e.from,
        amount: e.amount,
        block_number: e.blockNumber,
        log_index: e.logIndex,
        transaction_index: 0,
      }))
    );

    logger.info({
      blockNumber: blockNumber.toString(),
      inserted: result.inserted,
      skipped: result.skipped,
    }, 'Synced block with events');
  }

  // 更新同步状态
  await syncRepo.updateProgress(
    parseInt(process.env.CHAIN_ID || '1'),
    blockNumber,
    'syncing'
  );
}

/**
 * 主同步循环
 */
async function main() {
  logger.info('🚀 Starting event indexer...');

  while (true) {
    try {
      const latestBlock = await client.getBlockNumber();

      if (!latestBlock.data) {
        throw new Error('Failed to get latest block');
      }

      const syncStatus = await syncRepo.getStatus(
        parseInt(process.env.CHAIN_ID || '1')
      );

      const startBlock = syncStatus
        ? syncStatus.last_block + 1n
        : 0n;

      logger.info({
        startBlock: startBlock.toString(),
        endBlock: latestBlock.data.toString(),
      }, 'Starting sync');

      // 批量同步（带并发控制）
      const batchSize = 100n;
      for (let b = startBlock; b <= latestBlock.data; b += batchSize) {
        const end = Math.min(Number(b + batchSize), Number(latestBlock.data));

        const blockNumbers = Array.from(
          { length: end - Number(b) + 1 },
          (_, i) => BigInt(Number(b) + i)
        );

        await concurrency.executeAll(blockNumbers, syncBlockWithEvents);
      }

      await syncRepo.updateProgress(
        parseInt(process.env.CHAIN_ID || '1'),
        latestBlock.data,
        'caught_up'
      );

      logger.info('✅ Synced to latest block');

      // 等待新区块
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (error) {
      logger.error({ error }, 'Sync error');

      await syncRepo.updateProgress(
        parseInt(process.env.CHAIN_ID || '1'),
        0n,
        'error'
      );

      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

main().catch(console.error);
```

## 实施步骤

### 第一步：数据库 Schema
1. ✅ 创建 transactions 表
2. ✅ 添加复合唯一索引
3. ✅ 创建 sync_status 表
4. ✅ 添加性能优化索引

### 第二步：核心逻辑
1. ✅ 实现 EventParser
2. ✅ 实现 TransactionRepository
3. ✅ 实现 SyncStatusRepository
4. ✅ 实现 ConcurrencyController

### 第三步：集成和测试
1. ✅ 创建 mock-transactions.ts
2. ✅ 实现 index-events.ts
3. ✅ 添加单元测试
4. ✅ 端到端测试

### 第四步：部署和监控
1. ✅ 更新 Docker 配置
2. ✅ 添加 Prometheus 指标
3. ✅ 配置告警规则
4. ✅ 文档更新

## 性能指标

### 目标
- **吞吐量**: 100+ tx/s
- **延迟**: <1s p99
- **并发**: 5-10 个并行请求
- **内存**: <200MB
- **可靠性**: 99.9% uptime

### 监控指标
- 事件解析成功率
- 交易保存延迟
- 同步进度
- 重新同步次数

## 总结

第三、四阶段将把索引器从单纯的区块同步器升级为完整的事件索引系统，支持：
- ✅ 智能合约事件解析
- ✅ 交易历史跟踪
- ✅ 状态同步管理
- ✅ 并发性能优化
- ✅ 生产级可靠性

完成后，系统将具备完整的 DApp 索引能力。
