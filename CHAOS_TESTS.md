# 🐵 Chaos Monkey Tests - Quick Start

## 快速运行

### 1. 列出所有混沌测试
```bash
npm run chaos:list
```

### 2. 运行所有测试
```bash
npm run chaos
```

### 3. 运行单个测试
```bash
npm run chaos:reorg      # 测试链重组
npm run chaos:toxic      # 测试 RPC 故障
npm run chaos:bigint     # 测试数值边界
npm run chaos:db         # 测试数据库崩溃
```

## 📝 测试说明

### 💣 Reorg Exploder (链重组炸弹)
- **危险等级**: 🟠 高
- **测试内容**: 模拟 5 层深的链重组
- **预期行为**: 索引器自动回滚并重新同步

### ☠️ Toxic RPC (RPC 毒药)
- **危险等级**: 🟡 中
- **测试内容**: 注入延迟、错误和损坏的响应
- **交互**: 按 `s` 开关混沌, `i` 查看统计, `q` 退出
- **预期行为**: 索引器不崩溃,自动重试

### 💥 BigInt Nuke (数值核弹)
- **危险等级**: 🟢 低
- **测试内容**: 最大/最小值、1000笔粉尘攻击
- **预期行为**: 精度无损失,UI 正常显示

### 💀 Database Killer (数据库杀手)
- **危险等级**: 🔴 极高
- **测试内容**: 在同步过程中杀死数据库
- **预期行为**: 从 checkpoint 自动恢复

## 🎯 成功标准

通过所有 4 个测试 = 你的索引器是 **生产级** 的!

## ⚠️ 重要提示

1. 仅在测试环境运行
2. 确保索引器正在运行
3. Dashboard: http://localhost:3001/dashboard
4. 查看数据库: `docker exec web3-indexer-db psql -U postgres -d web3_indexer`

详细文档: [scripts/chaos/README.md](scripts/chaos/README.md)
