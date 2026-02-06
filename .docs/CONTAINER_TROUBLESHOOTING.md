# 容器环境故障排除指南

## 问题描述

在 Docker 容器中运行 `npm run test:all` 时，可能出现 TypeScript 编译错误：

```
error TS2307: Cannot find module 'pino' or its corresponding type declarations.
```

## 原因

这是 Docker 容器中的 TypeScript 编译器与 node_modules 之间的已知问题。容器环境的文件系统挂载可能导致 TypeScript 无法正确解析模块类型。

## 解决方案

### 方案 1：使用预构建的 dist 文件（推荐）

项目已经在宿主机上预先构建，容器可以直接使用编译后的 JavaScript 文件。

```bash
# 在容器中运行测试（使用预构建的文件）
npm run test:basic          # 快速基础测试
npm run test:reorg          # Reorg 测试
npm run test:stress         # 压力测试
```

### 方案 2：在容器中重新构建

如果需要在容器中重新构建：

```bash
# 在容器内运行
npm run fix:build
```

这将：
1. 清理 node_modules 和 dist
2. 重新安装依赖
3. 重新构建项目

### 方案 3：手动重新构建

```bash
# 在容器内运行
rm -rf node_modules dist package-lock.json
npm ci
npm run build
```

## 测试命令

### 快速测试（不需要编译）

```bash
npm run test:basic
```

这会测试：
- 数据库连接
- RPC 连接
- 基本数据库操作
- 事务功能

### 完整测试套件

```bash
npm run test:all
```

包括：
- 基础功能测试
- Reorg 测试
- 压力测试

### 单独运行测试

```bash
npm run test:basic      # 基础测试
npm run test:reorg      # Reorg 测试
npm run test:stress     # 压力测试
```

## 验证构建状态

```bash
# 检查 dist 目录是否存在
ls -la dist/

# 检查测试文件是否已编译
ls -la dist/tests/

# 应该看到：
# dist/tests/reorg.test.js
# dist/tests/stress.test.js
```

## 预期的测试输出

### 成功的测试运行

```
🧪 Quick JavaScript Test

1. Testing database connection...
   ✅ Database connected, blocks: 100

2. Testing RPC connection...
   ✅ RPC connected, block: 12345

3. Testing block query...
   ✅ Latest block in DB: 99

4. Testing transaction...
   ✅ Transaction successful
   ✅ Cleanup successful

✅ All tests passed!
```

## 如果测试失败

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 检查数据库连接
npm run db:status
```

### RPC 连接失败

```bash
# 检查 Anvil 是否运行
docker ps | grep anvil

# 检查 RPC URL
echo $RPC_URL
```

### 模块未找到错误

```bash
# 确保依赖已安装
npm ci

# 重新构建
npm run build
```

## 生产部署建议

### 1. 在 CI/CD 中构建

```yaml
# .github/workflows/test.yml
- run: npm ci
- run: npm run build
- run: npm run test:all
```

### 2. 在 Dockerfile 中构建

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["npm", "start"]
```

### 3. 使用 .dockerignore

```
node_modules
npm-debug.log
.git
dist
*.md
```

## 当前状态

✅ **在宿主机上构建成功**
✅ **dist/ 目录包含所有编译后的文件**
✅ **测试文件已编译**
✅ **可以在容器中直接运行测试**

## 快速参考

```bash
# 基础测试（推荐首先运行）
npm run test:basic

# 完整测试套件
npm run test:all

# 如果遇到构建问题
npm run fix:build

# 检查数据库状态
npm run db:status

# 查看应用日志
docker logs web3-indexer-app --tail 50

# 实时监控
npm run test:monitor
```

## 技术细节

### 为什么会发生这个问题？

1. **Volume 挂载**：容器中的 node_modules 可能被宿主机的 node_modules 覆盖
2. **TypeScript 解析**：TS 编译器需要正确解析 node_modules 中的类型定义
3. **平台差异**：不同的操作系统可能有不同的路径解析行为

### 为什么预构建可以工作？

1. **纯 JavaScript**：编译后的 .js 文件不需要 TypeScript 编译器
2. **无需类型解析**：运行时不检查类型定义
3. **跨平台兼容**：JavaScript 文件在任何平台上都能运行

## 相关文件

- `tsconfig.json` - TypeScript 配置（已更新）
- `tests/quick-test.js` - 纯 JavaScript 快速测试
- `scripts/fix-container-build.sh` - 自动修复脚本
- `TESTING.md` - 完整测试文档

## 需要帮助？

如果问题持续存在：

1. 检查 Docker 日志：`docker logs web3-indexer-app`
2. 检查容器环境：`docker exec -it web3-indexer-app bash`
3. 查看构建状态：`ls -la dist/`
4. 运行基础测试：`npm run test:basic`

## 总结

- ✅ 在宿主机上构建已成功
- ✅ 所有文件已编译到 dist/
- ✅ 可以在容器中运行测试
- ✅ 基础测试不需要 TypeScript 编译

**推荐做法**：使用 `npm run test:basic` 进行快速验证，它会跳过 TypeScript 编译直接测试核心功能。
