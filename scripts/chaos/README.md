# 🐵 Chaos Monkey Test Suite

> "测试系统在正常情况下能正常运行不算本事。让它在极端混乱中依然能稳定工作,那才叫真正的工程能力。"

## 📖 什么是混沌工程?

混沌工程(Chaos Engineering)是一种主动在系统中注入故障的测试方法,用于验证系统的**韧性**和**自愈能力**。

在 Web3 领域,这意味着模拟:
- 链重组(Reorg)
- RPC 节点故障
- 极端数值
- 数据库崩溃

## 🧪 测试套件

### 1️⃣ Reorg Exploder 💣
**模拟链重组**

测试索引器在区块链发生重组时的反应:
- 创建 5 个块的"标准链"
- 触发重组,生成 5 个不同的"竞争链"
- 验证索引器能否:
  - 检测到 `parent_hash` 不匹配
  - 自动回滚数据库(CASCADE DELETE)
  - 重新同步正确的链

**运行:**
```bash
npx ts-node scripts/chaos/reorg-exploder.ts
```

**预期结果:**
- 旧链的转账数据被删除
- 新链的转账数据被索引
- 无数据不一致

---

### 2️⃣ Toxic RPC Proxy ☠️
**模拟 RPC 节点故障**

模拟 Infura/Alchemy 等公共节点的不稳定性:
- 30% 请求延迟 0-10 秒
- 20% 请求返回 429/500 错误
- 10% 连接被强制关闭
- 5% 响应数据被损坏

**运行:**
```bash
npx ts-node scripts/chaos/toxic-rpc-proxy.ts
```

然后修改 `.env`:
```env
RPC_URL=http://localhost:8546
```

**交互控制:**
- 按 `s` - 切换混沌模式开启/关闭
- 按 `i` - 查看统计信息
- 按 `q` - 退出

**预期结果:**
- 索引器不崩溃
- 请求自动重试
- 错误后能恢复

---

### 3️⃣ BigInt Nuke 💥
**测试数值边界**

挑战系统的数值处理能力:
- 最大值转账: `2^256 - 1` wei
- 最小值转账: `1` wei
- 粉尘攻击: 1000 笔小额转账

**运行:**
```bash
npx ts-node scripts/chaos/bigint-nuke.ts
```

**预期结果:**
- 数据库正确存储最大/最小值
- UI 渲染正常(无 NaN/Infinity)
- 所有 1000 笔转账都被索引
- 精度无损失

---

### 4️⃣ Database Killer 💀
**数据库崩溃恢复**

测试断点续传机制:
- 在索引器同步过程中强制停止数据库
- 等待 10 秒
- 重启数据库
- 验证索引器能否自动恢复

**运行:**
```bash
npx ts-node scripts/chaos/db-killer.ts
```

**预期结果:**
- 索引器从最后的 checkpoint 恢复
- 无数据空洞
- 无孤儿记录

---

## 🚀 快速开始

### 运行所有测试
```bash
npx ts-node scripts/chaos/run-chaos-tests.ts
```

### 运行单个测试
```bash
npx ts-node scripts/chaos/run-chaos-tests.ts reorg
npx ts-node scripts/chaos/run-chaos-tests.ts toxic-rpc
npx ts-node scripts/chaos/run-chaos-tests.ts bigint
npx ts-node scripts/chaos/run-chaos-tests.ts db-killer
```

### 列出所有测试
```bash
npx ts-node scripts/chaos/run-chaos-tests.ts --list
```

---

## 📊 测试报告示例

### 成功的输出
```
📊 FINAL RESULTS
============================================================

✅ reorg                PASSED
✅ toxic-rpc            PASSED
✅ bigint               PASSED
✅ db-killer            PASSED

4/4 tests passed (100%)

🎉 ALL TESTS PASSED! Your indexer is PRODUCTION-READY! 🚀
```

### 失败的输出
```
⚠️  Some tests failed. Review the logs above.
```

---

## 🎯 通过标准

如果你的索引器能通过所有 4 个混沌测试,说明它具备:

✅ **共识层韧性** - 能处理链重组
✅ **网络层容错** - 能处理 RPC 故障
✅ **数据层完整** - 能处理极端数值
✅ **基础设施可靠性** - 能从崩溃中恢复

**恭喜!你现在拥有了生产级的 Web3 索引器! 🎉**

---

## 🛡️ 安全建议

1. **不要在生产环境运行!** 这些测试会故意破坏系统。
2. **使用独立的测试网络** - Anvil/Hardhat 本地节点。
3. **备份数据** - 虽然是测试,但好习惯很重要。
4. **监控资源** - DB Killer 测试会消耗较多资源。

---

## 🔍 故障排查

### Reorg 测试失败
- 检查 `parent_hash` 验证逻辑是否正确实现
- 确认 CASCADE DELETE 约束已生效

### Toxic RPC 测试失败
- 检查重试逻辑是否有指数退避
- 确认错误处理不会导致进程退出

### BigInt 测试失败
- 检查数据库字段类型是否使用 `VARCHAR` 存储
- 确认前端渲染逻辑处理了大数值

### DB Killer 测试失败
- 检查 checkpoint 是否正确保存
- 确认数据库重连逻辑存在

---

## 📚 延伸阅读

- [Chaos Engineering](https://principlesofchaos.org/)
- [Viem Anvil API](https://viem.sh/docs/chains/anvil)
- [PostgreSQL CASCADE DELETE](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FOREIGN-KEYS)

---

## 🎓 学习价值

通过运行这些测试,你将学会:

1. **如何设计容错系统** - 假设一切都会出错
2. **如何验证数据完整性** - 在各种极端情况下
3. **如何实现自愈机制** - 自动恢复而非人工介入
4. **如何进行混沌测试** - 主动发现系统弱点

**这才是真正的"工程能力"! 🚀**
