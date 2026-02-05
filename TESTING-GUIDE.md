# 🧪 测试脚本使用指南

## 📋 可用测试脚本

### 1. 快速测试 (推荐)
```bash
# 在 Windows 上
workspace.bat npm run test:quick

# 在 Linux/Mac 上
./workspace.sh npm run test:quick
```

**功能**: 发送3笔测试交易并查看同步结果
- 显示初始数据库状态
- 发送3笔交易到 Anvil
- 等待5秒让索引器同步
- 显示同步后的数据库状态
- 显示索引器最新日志

---

### 2. 完整测试
```bash
workspace.bat npm run test:sync
```

**功能**: 发送5笔交易并实时监控索引器日志
- 连续发送5笔交易
- 实时显示索引器日志
- 自动显示同步进度

---

### 3. 实时监控
```bash
workspace.bat npm run test:monitor
```

**功能**: 实时显示同步状态（每5秒刷新）
- 显示链上最新区块
- 显示数据库区块数量
- 计算同步进度
- 显示索引器最新日志

---

### 4. 交互式测试
```bash
workspace.bat npm run test:interactive
```

**功能**: 提供菜单选择不同的测试操作
- 查看服务状态
- 查看数据库状态
- 发送单笔测试交易
- 实时监控索引器日志
- 实时监控同步状态
- 运行完整测试
- 清空数据库重新开始

---

## 🚀 快速开始

### 第一次使用
```bash
# 1. 进入 workspace 容器
workspace.bat bash

# 2. 运行快速测试
npm run test:quick

# 3. 查看实时监控
npm run test:monitor
```

### 日常开发流程
```bash
# 1. 启动实时监控
workspace.bat npm run test:monitor

# 2. 在另一个终端发送测试交易
# (在监控终端中可以看到区块实时同步)

# 3. 使用交互式菜单进行各种测试
workspace.bat npm run test:interactive
```

---

## 📊 输出示例

### 快速测试输出
```
🧪 快速测试: 发送3笔交易并查看同步结果
==============================================

📊 初始状态:
[CHECK] Total blocks in database: 100
[CHECK] Latest block number: 99

💰 发送3笔测试交易...
  交易 1: 0x123...
  交易 2: 0x456...
  交易 3: 0x789...

⏳ 等待5秒让索引器同步...

📊 同步后状态:
[CHECK] Total blocks in database: 103
[CHECK] Latest block number: 102

🔍 索引器最新日志:
[Repository] ✅ Saved 10/10 blocks (0 invalid)
[2026-02-05T...] ✅ Batch sync completed: 3 blocks saved

✅ 测试完成!
```

### 实时监控输出
```
🔍 实时监控区块同步状态
==========================

⏰ 2026-02-05 16:45:30

📊 区块同步状态:
   链上最新区块: 168
   数据库区块数: 165
   数据库最大区块: 167

📈 同步进度:
   ⏳ 落后 1 个区块

🔄 索引器最新日志:
[Repository] ✅ Saved 2/2 blocks (0 invalid)
[2026-02-05T...] Fetched block 167

⏳ 5秒后刷新...
```

---

## 💡 测试技巧

### 1. 验证 Zod 数据验证
```bash
# 发送一笔交易
workspace.bat bash -c "curl -s -X POST -H \"Content-Type: application/json\" --data '{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\",\"to\":\"0x70997970C51812dc3A010C7d01b50e0d17dc79C8\",\"value\":\"0x10\",\"gas\":\"0x5208\"}],\"id\":1}' http://localhost:58545"

# 查看日志中的验证信息
docker logs web3-indexer-app | grep "Repository"
```

### 2. 测试增量同步
```bash
# 1. 清空数据库
workspace.test:interactive
# 选择 7) 清空数据库

# 2. 发送多笔交易
workspace.bat npm run test:sync

# 3. 验证增量同步
docker logs web3-indexer-app --tail 50
```

### 3. 压力测试
```bash
# 进入容器
workspace.bat bash

# 循环发送100笔交易
for i in {1..100}; do
  curl -s -X POST -H "Content-Type: application/json" \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\",\"to\":\"0x70997970C51812dc3A010C7d01b50e0d17dc79C8\",\"value\":\"0x10\",\"gas\":\"0x5208\"}],\"id\":$i}" \
    http://localhost:58545 > /dev/null
  echo "发送交易 $i/100"
  sleep 0.1
done

# 查看同步状态
npm run db:status
```

---

## 🐛 故障排除

### 问题 1: 脚本没有执行权限
```bash
# 在 Windows 上不需要担心，workspace.bat 会处理

# 在 Linux/Mac 上
chmod +x scripts/*.sh
```

### 问题 2: 无法连接到 Anvil
```bash
# 检查服务状态
docker-compose ps

# 检查 Anvil 日志
docker logs web3-indexer-anvil

# 重启服务
docker-compose restart anvil
```

### 问题 3: 索引器没有同步数据
```bash
# 查看索引器日志
docker logs web3-indexer-app --tail 50

# 检查数据库连接
npm run db:status

# 重启索引器
docker-compose restart indexer
```

---

## 📚 相关命令

### 直接查看数据库
```bash
# 进入容器
workspace.bat bash

# 连接数据库
psql -U postgres -d web3_indexer

# 在 psql 中
SELECT * FROM blocks ORDER BY number DESC LIMIT 10;
SELECT COUNT(*) FROM blocks;
SELECT MAX(number) FROM blocks;
```

### 手动发送交易
```bash
curl -s -X POST -H "Content-Type: application/json" \
  --data '{
    "jsonrpc":"2.0",
    "method":"eth_sendTransaction",
    "params":[{
      "from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "to":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "value":"0x10",
      "gas":"0x5208"
    }],
    "id":1
  }' \
  http://localhost:58545
```

---

## 🎯 测试目标

### 基础功能测试
- ✅ 数据库连接正常
- ✅ RPC 连接正常
- ✅ 区块数据同步
- ✅ Zod 验证工作

### 性能测试
- ✅ 批量处理性能
- ✅ 增量同步准确性
- ✅ 内存使用稳定性

### 可靠性测试
- ✅ 网络中断恢复
- ✅ 重试机制工作
- ✅ 数据完整性

---

**提示**: 所有脚本都可以通过 `workspace.bat` 或 `workspace.sh` 在管理容器中运行，确保环境一致性！