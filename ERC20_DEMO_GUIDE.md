# 🎨 ERC20 Transfer Event Demo - 完全自给自足的演示

## 📖 概述

这是一个**完全独立的、生产级的 ERC20 Transfer 事件索引演示**。

### 🎯 这个 Demo 做什么？

1. ✅ **部署真实的 ERC20 Token 合约**到本地 Anvil 区块链
2. ✅ **生成实际的 Transfer 交易**（不是 mock 数据）
3. ✅ **同步区块并解析 Transfer 事件**
4. ✅ **验证数据出现在数据库和 API 中**
5. ✅ **演示完整的端到端流程**（合约 → 事件 → 索引 → API → 仪表板）

### 🚀 为什么这个方法更好？

| 方法 | 优点 | 缺点 |
|:---|:---|:---|
| **✅ 本地 Demo（推荐）** | • 完全可控<br>• 100% 可复现<br>• 无外部依赖<br>• 快速（几秒）<br>• 离线可用 | • 需要运行 Anvil |
| **❌ 使用测试网** | • 真实的网络环境 | • 需要 RPC 密钥<br>• 可能很慢<br>• 网络不稳定<br>• 不确定有数据 |
| **❌ 使用主网** | • 真实数据 | • 需要 API 密钥<br>• 速率限制<br>• 成本高（如果是付费 API） |

---

## 🛠️ 前置要求

```bash
# 1. Docker 和 Docker Compose（用于 PostgreSQL）
docker --version
docker-compose --version

# 2. Node.js 和 npm
node --version
npm --version

# 3. 项目依赖
npm install
```

---

## 🚀 快速开始

### 方式 1: 一键运行（推荐）

```bash
# 启动所有服务（PostgreSQL + Anvil）
make up

# 运行 ERC20 Transfer Event Demo
make test-erc20-demo
```

**预期输出**：
```
🚀 Starting ERC20 Transfer Event Integration Demo...

1️⃣  Initializing database...
   ✅ Database ready

2️⃣  Setting up blockchain clients...
   ✅ Clients connected to Anvil

3️⃣  Deploying ERC20 Token contract...
   ✅ Contract deployed: 0x1234...5678

4️⃣  Generating Transfer transactions...
   • Transfer 100 TST to Account 2...
   ✅ Tx 1: 0xabcd...
   • Transfer 200 TST to Account 3...
   ✅ Tx 2: 0xefgh...
   • Transfer 50 TST from Account 2 to Account 3...
   ✅ Tx 3: 0xijkl...

5️⃣  Syncing blocks with Transfer events...
   ✅ Sync complete

🎉 Demo setup complete!

✓ ERC20 Transfer Event Integration Demo
  ✓ should have indexed blocks (32ms)
    📊 Blocks indexed: 15
  ✓ should have indexed Transfer events (12ms)
    📊 Transfers indexed: 3

   Transfer details:
   1. 0xf39F... → 0x7099...: 100000000000000000000 tokens
      Block: 10, Tx: 0xabcd...
   2. 0xf39F... → 0x5de4...: 200000000000000000000 tokens
      Block: 11, Tx: 0xefgh...
   3. 0x7099... → 0x5de4...: 50000000000000000000 tokens
      Block: 13, Tx: 0xijkl...

  ✓ should have correct token address in transfers
  ✓ should preserve BigInt precision for amounts
  ✓ should have atomic block+transfer writes
  ✓ should support API queries
  ✓ should match expected transfer data

✅ ERC20 Demo complete
```

---

### 方式 2: 手动步骤（用于调试）

#### 步骤 1: 启动 Anvil

```bash
# 终端 1
anvil --host-port 58545
```

您应该看到：
```
Available Accounts
==================
(0) 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
(1) 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a (10000 ETH)

Listening on 127.0.0.1:58545
```

#### 步骤 2: 启动 PostgreSQL

```bash
# 终端 2
docker-compose up -d db
```

#### 步骤 3: 初始化数据库

```bash
make db-init
```

#### 步骤 4: 运行 Demo

```bash
npm test -- tests/integration/erc20-transfer-demo.test.ts
```

---

## 🔍 验证结果

### 1. 检查数据库

```bash
# 连接到 PostgreSQL
docker exec -it web3indexer-postgres-1 psql -U postgres -d web3_indexer

# 查询 transfers 表
SELECT block_number, from_address, to_address, amount, token_address
FROM transfers
ORDER BY block_number DESC
LIMIT 5;
```

**预期输出**：
```
 block_number |        from_address         |         to_address          |       amount       |    token_address
--------------+----------------------------+----------------------------+--------------------+-----------------------
           13 | 0x70997970c51812dc3a010... | 0x5de4111afa1a4b94908f... | 50000000000000000000 | 0x39020d...
           11 | 0xf39fd6e51aad88f6f4ce... | 0x5de4111afa1a4b94908f... | 200000000000000000000 | 0x39020d...
           10 | 0xf39fd6e51aad88f6f4ce... | 0x70997970c51812dc3a010... | 100000000000000000000 | 0x39020d...
(3 rows)
```

### 2. 测试 API 端点

```bash
# 启动 API 服务器
make api

# 在另一个终端测试
curl http://localhost:3001/api/transfers?limit=10 | jq
```

**预期输出**：
```json
{
  "data": [
    {
      "id": 1,
      "block_number": "13",
      "transaction_hash": "0x123...",
      "from_address": "0x70997970c51812dc3a010...",
      "to_address": "0x5de4111afa1a4b94908f...",
      "amount": "50000000000000000000",
      "token_address": "0x39020d..."
    }
    // ... 更多 transfers
  ],
  "meta": {
    "count": 3,
    "tokenFilter": null
  }
}
```

### 3. 查看仪表板

```bash
# 启动完整服务
make dev-full

# 打开浏览器
# http://localhost:3001/dashboard
```

**预期结果**：
- ✅ "Recent Transfers" 表格显示 3 条转账记录
- ✅ Transfer 数据实时更新
- ✅ BigInt 精度保持（大数字显示正确）

---

## 🧪 测试覆盖

Demo 包含以下测试：

1. ✅ **区块索引测试** - 验证 blocks 表有数据
2. ✅ **Transfer 事件测试** - 验证 transfers 表有数据
3. ✅ **合约地址测试** - 验证 token_address 正确
4. ✅ **BigInt 精度测试** - 验证金额无精度丢失
5. ✅ **原子性写入测试** - 验证 block 和 transfer 在同一事务
6. ✅ **API 格式化测试** - 验证 JSON 序列化正确
7. ✅ **数据完整性测试** - 验证转账数据符合预期

---

## 🔧 故障排查

### 问题 1: Anvil 未运行

**错误**: `Error: Cannot connect to RPC`

**解决**:
```bash
# 检查 Anvil 是否运行
curl http://localhost:58545

# 启动 Anvil
anvil --host-port 58545
```

### 问题 2: PostgreSQL 未运行

**错误**: `Connection refused`

**解决**:
```bash
# 检查 Docker 服务
docker ps | grep postgres

# 启动数据库
docker-compose up -d
```

### 问题 3: 合约部署失败

**错误**: `TransactionExecutionError`

**解决**:
```bash
# 检查 Anvil 账户余额
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://localhost:58545

# 应该显示 10000 ETH
```

### 问题 4: Transfer 事件未索引

**错误**: `Expected transfers.length > 0, got 0`

**解决**:
```bash
# 检查 sync-engine 配置
grep -A 10 "tokenContract" src/index-enhanced.ts

# 确保 TOKEN_CONTRACT_ADDRESS 被设置
echo "TOKEN_CONTRACT_ADDRESS=0x..." >> .env
```

---

## 📚 技术细节

### 合约字节码

Demo 使用的 ERC20 Token 是一个**最小化实现**，包含：

- ✅ `transfer(address,uint256)` - 标准转账函数
- ✅ `mint(address,uint256)` - 用于测试的铸造函数
- ✅ `Transfer(address,address,uint256)` - ERC20 标准事件

### 事件解析流程

```typescript
// 1. 获取日志
const logs = await client.getLogs({
  address: tokenContract,
  event: erc20TransferAbi[0],
  fromBlock: startBlock,
  toBlock: endBlock,
});

// 2. 解码事件
const decoded = decodeEventLog({
  abi: erc20Abi,
  data: log.data,
  topics: log.topics,
});

// 3. 存储到数据库（BigInt 安全）
await db.insertInto('transfers').values({
  block_number: log.blockNumber,
  from_address: decoded.args.from,
  to_address: decoded.args.to,
  amount: decoded.args.value.toString(), // ← BigInt → string
  token_address: tokenContract,
});
```

### 原子性事务

```typescript
// 在同一事务中写入 blocks + transfers
await db.transaction().execute(async (trx) => {
  // 1. 写入 block
  await trx.insertInto('blocks').values(blocks).execute();

  // 2. 写入 transfers
  await transfersRepo.saveWithTrx(trx, transfers);
});
// ↑ 全部成功或全部失败
```

---

## 🎯 面试演示建议

### 演示脚本

```bash
# 1. 启动服务
make up

# 2. 运行 Demo（观众可以看到实时输出）
make test-erc20-demo

# 3. 解释关键点
echo "📌 关键技术点：
echo "  • 真实的区块链合约部署"
echo "  • 实际的 Transfer 事件解析"
echo "  • BigInt 精度安全（amount 作为字符串存储）"
echo "  • 原子性事务（block + transfer 同步写入）"
echo "  • 级联删除（reorg 时自动清理）"

# 4. 展示仪表板
make dev-full
# 浏览器打开 http://localhost:3001/dashboard

# 5. 测试 API
curl http://localhost:3001/api/transfers | jq
```

### 关键卖点

1. **生产级代码** - 不是 mock，是真实的区块链交互
2. **完整性** - 从合约部署到 API 响应的完整流程
3. **数据安全** - BigInt 精度保护，防止金融数据丢失
4. **可扩展性** - 可以轻松添加更多 ERC20 合约
5. **专业性** - 事务、错误处理、日志记录一应俱全

---

## 🚀 下一步

Demo 成功运行后，您可以：

1. **添加更多 ERC20 合约**
   ```typescript
   const tokenAddresses = [
     tokenContract,           // Demo token
     '0x...', // USDC
     '0x...', // DAI
   ];
   ```

2. **实时监控仪表板**
   ```bash
   make dev-full
   # 仪表板会显示实时 Transfer 数据
   ```

3. **编写自定义测试**
   - 测试大额转账
   - 测试批量转账
   - 测试 reorg 场景

---

## 📖 相关文档

- `ERC20_IMPLEMENTATION.md` - 完整实现指南
- `src/sync-engine.ts` - Transfer 事件解析逻辑
- `src/api/server.ts` - API 端点实现
- `MILESTONE.md` - 项目里程碑总结

---

## 🎊 总结

这个 Demo 是一个**完全自给自足的、生产级的 Web3 索引器演示**：

- ✅ 无需外部 API 密钥
- ✅ 无需测试网配置
- ✅ 100% 可复现
- ✅ 真实的区块链交互
- ✅ 完整的数据流验证
- ✅ 面试演示就绪

**只需几分钟，您就可以展示一个完整的工业级 Web3 索引器！** 🚀
