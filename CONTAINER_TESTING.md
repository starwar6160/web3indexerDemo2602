# 容器环境测试指南

## 概述

在 Docker 容器内部测试 Web3 索引器的快速指南。

## 问题说明

在 Windows + Docker 环境中常见问题：
1. TypeScript 编译问题（容器内 node_modules 类型解析）
2. 模块路径问题（CommonJS vs ES Modules）
3. 构建产物缺失（dist/ 目录不存在）

## 解决方案

### 方案 1：使用容器友好测试（推荐）

```bash
# 在容器内运行
npm run test:basic
# 或
npm run test:db
```

这个测试：
- ✅ 不依赖编译
- ✅ 使用原生 JavaScript
- ✅ 直接测试数据库和 RPC
- ✅ 检查表结构和索引

### 方案 2：在宿主机构建，容器运行

```powershell
# Windows PowerShell
cd C:\zwData\zwCode\web3indexerDemo2602
npm run build
```

然后复制 dist/ 到容器，或者使用 volume 挂载。

### 方案 3：使用 ts-node（容器内）

```bash
# 安装 ts-node（如果未安装）
npm install -g ts-node typescript

# 运行测试
ts-node tests/reorg.test.ts
```

## 当前推荐命令

```bash
# 快速验证功能（无需编译）
npm run test:basic

# 等同命令
npm run test:db
node tests/container-test.js
```

## 测试输出示例

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

## 如果测试失败

### 错误 1: "Cannot find module 'viem'"

```bash
# 解决方案：重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

### 错误 2: "relation 'blocks' does not exist"

```bash
# 解决方案：初始化数据库
npm run db:init
```

### 错误 3: "ECONNREFUSED" (数据库连接)

```bash
# 检查数据库 URL
echo $DATABASE_URL

# 或在容器内检查
env | grep DATABASE_URL

# 确保 PostgreSQL 正在运行
docker ps | grep postgres
```

### 错误 4: "ECONNREFUSED" (RPC 连接)

```bash
# 检查 RPC URL
echo $RPC_URL

# 测试 RPC 连接
curl -X POST $RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## 完整测试流程

### 1. 进入容器

```bash
docker exec -it web3-indexer-app bash
```

### 2. 检查环境

```bash
# Node 版本
node --version  # 应该是 v20.x

# 工作目录
pwd  # 应该是 /app

# 文件列表
ls -la
```

### 3. 运行测试

```bash
# 快速基础测试
npm run test:basic

# 数据库状态
npm run db:status

# 健康检查
curl http://localhost:3001/healthz

# 指标
curl http://localhost:3001/metrics
```

### 4. 查看日志

```bash
# 应用日志（如果在运行）
docker logs web3-indexer-app --tail 50

# 实时日志
docker logs web3-indexer-app -f
```

## Windows 开发工作流

### 在 Windows（宿主机）

```powershell
# 1. 编辑代码
# 使用 VS Code 或其他编辑器

# 2. 构建项目
cd C:\zwData\zwCode\web3indexerDemo2602
npm run build

# 3. 提交代码
git add .
git commit -m "your changes"
```

### 在容器内测试

```bash
# 1. 重新进入容器（如果需要）
docker exec -it web3-indexer-app bash

# 2. 拉取最新代码（如果使用 volume）
git pull

# 3. 重新构建（如果修改了 TypeScript）
npm run build

# 4. 运行测试
npm run test:basic

# 5. 启动应用
npm run dev
```

## 常用调试命令

```bash
# 查看进程
ps aux | grep node

# 查看端口
netstat -tlnp | grep :3000

# 查看环境变量
env | sort

# 查看 node_modules
ls node_modules | grep viem

# 测试数据库连接
psql $DATABASE_URL -c "SELECT COUNT(*) FROM blocks;"

# 测试 RPC
curl $RPC_URL -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## 性能测试

```bash
# 批量插入测试
npm run db:init  # 重新初始化
npm run dev      # 启动索引器
npm run test:monitor  # 监控同步
```

## 故障排除

### 问题：node_modules 权限

```bash
# 修复权限
chown -R node_modules dist
```

### 问题：Volume 挂载问题

```bash
# 检查 volume
docker volume inspect web3_indexer_node_modules

# 重建容器
docker-compose down
docker-compose up -d
```

### 问题：TypeScript 编译错误

```bash
# 跳过编译，直接运行
npm run test:basic  # 使用 JS 版本

# 或在宿主机编译后复制
# Windows:
npm run build
# 然后确保 dist/ 被挂载到容器
```

## 推荐测试顺序

```bash
# 1. 快速验证
npm run test:basic

# 2. 数据库详细检查
npm run db:status

# 3. 健康检查
curl http://localhost:3001/healthz

# 4. 运行应用
npm run dev

# 5. 监控日志
docker logs web3-indexer-app -f
```

## 总结

✅ **推荐使用** `npm run test:basic` - 不依赖编译，快速验证

⚠️ **避免在容器内编译** - 使用预构建的 dist/ 或纯 JS 测试

🔄 **开发流程** - Windows 编辑 → 宿主机构建 → 容器测试

💡 **调试技巧** - 使用 `docker logs -f` 查看实时日志
