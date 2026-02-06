# 🐳 容器内测试脚本使用指南

## 📋 概述

这些脚本专门为在 **workspace 容器内部**运行而设计，不需要任何 docker 命令。

## 🚀 快速开始

### 进入容器
```bash
# 在 Windows 上
workspace.bat bash

# 在 Linux/Mac 上
./workspace.sh bash
```

## 📦 可用脚本

### 1. 快速测试 (推荐新手)
```bash
npm run container:quick
```

**功能**: 发送3笔测试交易并查看同步结果
- 显示初始数据库状态
- 发送3笔交易到 Anvil
- 等待5秒让索引器同步
- 显示同步后的数据库状态

**输出示例**:
```
🧪 快速测试: 发送3笔交易并查看同步结果
==============================================

📊 初始状态:
[CHECK] Total blocks in database: 100
[CHECK] Latest block number: 99

💰 发送3笔测试交易...
  交易 1: ✅ 0x1234567890abcdef...
  交易 2: ✅ 0x0987654321fedcba...
  交易 3: ✅ 0xabcdef1234567890...

⏳ 等待5秒让索引器同步...

📊 同步后状态:
[CHECK] Total blocks in database: 103
[CHECK] Latest block number: 102

✅ 测试完成!
```

---

### 2. 实时监控
```bash
npm run container:monitor
```

**功能**: 实时显示同步状态（每5秒刷新）
- 显示链上最新区块
- 显示数据库区块数量
- 计算同步进度和状态指示器
- 自动刷新

**状态指示器**:
- ✅ 完全同步 (落后0个区块)
- 🟢 接近同步 (落后1-2个区块)
- 🟡 同步中 (落后3-5个区块)
- 🔴 落后较多 (落后5+个区块)

**输出示例**:
```
🔍 实时监控区块同步状态
==========================

⏰ 2026-02-05 16:45:30

📊 区块同步状态:
   链上最新区块: 168
   数据库区块数: 165
   数据库最大区块: 167

📈 同步进度:
   🟢 接近同步 (落后 1 个区块)

💡 提示: 在宿主机运行 'docker logs web3-indexer-app --tail 20' 查看索引器日志

⏳ 5秒后刷新...
```

---

### 3. 交互式测试 (推荐)
```bash
npm run container:interactive
```

**功能**: 提供菜单选择不同的测试操作
- 查看数据库状态
- 发送单笔测试交易
- 实时监控同步状态
- 快速测试 (3笔交易)
- 清空数据库

**菜单选项**:
```
🎯 Web3 Indexer - 交互式测试工具 (容器版)
==========================================

请选择操作:
1) 📊 查看数据库状态
2) 💰 发送测试交易
3) 📈 实时监控同步状态
4) 🧪 快速测试 (3笔交易)
5) 🗑️  清空数据库
0) 退出

请输入选项 (0-5):
```

---

## 🔧 技术细节

### 关键改进

1. **使用容器网络名称**
   - Anvil RPC: `http://anvil:8545` (容器内部)
   - PostgreSQL: `psql -U postgres -h db -d web3_indexer`

2. **移除所有 docker 命令**
   - 不再使用 `docker exec`
   - 不再使用 `docker logs`
   - 直接访问数据库和 RPC

3. **改进的交易哈希解析**
   - 使用 `0x` 前缀匹配
   - 添加错误处理和提示
   - 使用固定转账金额 `0xde0b6b3a7640000` (1 ETH)

4. **十六进制转换修复**
   - 正确处理 `0x` 前缀
   - 使用 `$((16#${CHAIN_BLOCK#0x}))` 进行转换

---

## 💡 使用技巧

### 1. 第一次测试
```bash
# 1. 进入容器
workspace.bat bash

# 2. 运行快速测试
npm run container:quick

# 3. 查看结果
# 应该看到数据库区块数从 100 增加到 103
```

### 2. 实时监控
```bash
# 在容器中启动监控
workspace.bat bash
npm run container:monitor

# 在另一个终端手动发送交易
workspace.bat bash
# 然后选择: 发送测试交易
npm run container:interactive
```

### 3. 清空数据库重新测试
```bash
workspace.bat bash
npm run container:interactive
# 选择: 5) 清空数据库
```

---

## 🐛 故障排除

### 问题 1: 交易哈希显示为空
**原因**: 之前脚本使用了错误的端口号和地址解析

**解决**: 使用新的 `container:quick` 脚本，它修复了：
- 使用 `http://anvil:8545` 而不是 `http://localhost:58545`
- 改进的 JSON 响应解析
- 使用 `0x` 前缀匹配

### 问题 2: 无法连接到数据库
**错误**: `connection refused` 或 `could not connect to server`

**解决**:
- 确保在 workspace 容器内运行
- 使用 `-h db` 参数连接数据库服务
- 检查 docker-compose 确保数据库服务正在运行

### 问题 3: 区块没有同步
**检查步骤**:
```bash
# 1. 查看数据库状态
npm run db:status

# 2. 查看链上最新区块
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://anvil:8545

# 3. 在宿主机查看索引器日志
docker logs web3-indexer-app --tail 50
```

---

## 📊 测试场景

### 场景 1: 验证基础同步
```bash
npm run container:quick
```
**预期结果**: 数据库区块数增加3个

### 场景 2: 持续监控
```bash
npm run container:monitor
```
**预期结果**: 每隔2秒看到区块数+1（Anvil生成新区块）

### 场景 3: 批量交易测试
```bash
npm run container:interactive
# 选择多次: 2) 发送测试交易
```
**预期结果**: 每次发送后数据库区块数增加

---

## 🎯 与原脚本的区别

| 特性 | 原脚本 (宿主机) | 容器脚本 (容器内) |
|------|----------------|------------------|
| RPC 地址 | `localhost:58545` | `anvil:8545` |
| 数据库连接 | `docker exec` | `psql -h db` |
| 查看日志 | `docker logs` | 提示在宿主机运行 |
| 运行位置 | 宿主机 | workspace 容器内 |
| 网络访问 | 端口映射 | 容器内部网络 |

---

## 📚 相关文档

- **宿主机测试脚本**: 参见 `TESTING-GUIDE.md`
- **项目设置**: 参见 `README.md`
- **数据库管理**: 参见 `DATABASE.md`

---

**提示**: 所有容器内脚本都以 `container:` 前缀，易于识别！
