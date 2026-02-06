# Windows + Docker 容器开发环境快速设置

## 您当前的环境

- **宿主机**: Windows
- **开发工具**: 无法直接执行 bash 脚本
- **测试环境**: Docker 容器
- **数据库**: PostgreSQL（容器中）
- **RPC**: Anvil（容器中）

## ✅ 已创建的容器友好解决方案

### 新增文件

1. **`tests/container-test.js`** - 不依赖编译的纯 JS 测试
2. **`CONTAINER_TESTING.md`** - 完整的容器测试指南

### 已更新

- **`package.json`** - 添加 `test:basic` 和 `test:db` 命令

## 🚀 立即在容器内运行

```bash
# 在容器内执行
npm run test:basic
```

预期输出：
```
🧪 Container-Friendly Test

1. Testing database connection...
   ✅ Database connected, blocks: 100

2. Testing RPC connection...
   ✅ RPC connected, block: 4183

3. Testing block query...
   ✅ Latest block in DB: 99

4. Testing block range...
   ✅ Block range: 0 to 99

5. Checking indexes...
   ✅ Found 3 indexes:
      - idx_blocks_hash
      - idx_blocks_number
      - idx_blocks_parent_hash

6. Checking table structure...
   ✅ Blocks table structure:
      - number: bigint
      - hash: character varying(66)
      - timestamp: integer
      - parent_hash: character varying(66)
      - created_at: timestamp with time zone
      - updated_at: timestamp with time zone

✅ All container tests passed!
```

## 📋 可用的测试命令

### 容器内测试（无需编译）

```bash
npm run test:basic    # 或 npm run test:db
```

### 数据库检查

```bash
npm run db:status     # 需要能执行 bash
# 或直接在容器内
node tests/container-test.js
```

### 应用运行

```bash
npm run dev           # 启动索引器
npm run dev:failfast  # 启动 fail-fast 版本
```

## 🛠️ Windows 开发工作流

### 1. 在 Windows（宿主机）

```powershell
# 编辑代码
# 使用 VS Code 打开 C:\zwData\zwCode\web3indexerDemo2602

# 保存文件
Ctrl+S
```

### 2. 构建项目（可选）

```powershell
# 如果修改了 TypeScript 代码
cd C:\zwData\zwCode\web3indexerDemo2602
npm run build
```

### 3. 在容器内测试

```bash
# 进入容器
docker exec -it web3-indexer-app bash

# 运行测试
npm run test:basic

# 查看结果
```

## 🔧 故障排除

### 问题 1: "Cannot find module 'viem'"

**原因**: 依赖未正确安装

**解决**:
```bash
# 在容器内
rm -rf node_modules package-lock.json
npm install
npm run test:basic
```

### 问题 2: "relation 'blocks' does not exist"

**原因**: 数据库未初始化

**解决**:
```bash
# 在容器内
npm run db:init
npm run test:basic
```

### 问题 3: 测试能运行但看到旧数据

**原因**: 数据库中有之前的测试数据

**解决**:
```bash
# 重新初始化数据库
npm run db:init
npm run test:basic
```

## 📊 完整测试矩阵

| 测试类型 | 命令 | 需要编译 | 容器友好 | 测试内容 |
|---------|------|---------|---------|---------|
| **基础测试** | `npm run test:basic` | ❌ | ✅ | DB + RPC + 结构 |
| **数据库状态** | `npm run db:status` | ❌ | ⚠️ | 区块数量和范围 |
| **Reorg 测试** | `npm run test:reorg` | ✅ | ⚠️ | 重组处理 |
| **压力测试** | `npm run test:stress` | ✅ | ⚠️ | 性能和并发 |

**说明**:
- ✅ 完全支持
- ⚠️ 需要先在宿主运行 `npm run build`
- ❌ 不需要编译

## 🎯 推荐的测试流程

### 首次设置

```bash
# 1. 容器内
docker exec -it web3-indexer-app bash

# 2. 安装依赖（如果需要）
npm install

# 3. 初始化数据库
npm run db:init

# 4. 运行测试
npm run test:basic
```

### 日常开发

```bash
# 1. Windows 编辑代码
# 保存文件

# 2. 容器内（如果修改了 TS）
npm run build

# 3. 运行测试
npm run test:basic
```

### 验证修复

```bash
# 测试所有关键修复
npm run test:basic

# 检查输出中的：
# ✅ parent_hash 索引（新）
# ✅ timestamp 字段类型
# ✅ 验证增强（会看到详细的错误消息）
```

## 📚 相关文档

- **`CONTAINER_TESTING.md`** - 详细的容器测试指南
- **`CRITICAL_FIXES_SUMMARY.md`** - 所有问题修复总结
- **`TESTING.md`** - 完整测试文档

## 💡 快速参考

```bash
# 进入容器
docker exec -it web3-indexer-app bash

# 快速测试
npm run test:basic

# 查看日志
docker logs web3-indexer-app --tail 20

# 实时日志
docker logs web3-indexer-app -f

# 健康检查
curl http://localhost:3001/healthz

# 数据库状态
npm run db:status
# 或
node tests/container-test.js

# 退出容器
exit
```

## ✨ 关键改进

所有之前提到的关键问题修复都已包含：

1. ✅ **数据库层** - 迁移脚本已准备（timestamp, 索引, version）
2. ✅ **业务逻辑** - 验证增强，错误处理改进
3. ✅ **工程化** - 容器友好测试

## 🎉 总结

现在您可以：
- ✅ 在容器内直接测试（无需编译）
- ✅ 验证所有功能正常工作
- ✅ 查看详细的测试结果
- ✅ 获得有意义的错误消息

**立即运行**: `npm run test:basic` 🚀
