# 🚀 容器环境快速启动命令

## ⚡ 立即执行（一次性初始化）

```bash
# 在容器内执行这个命令
npm run init:container
```

**或者手动执行**：
```bash
rm -rf node_modules package-lock.json dist && npm install && npm run build
```

---

## 📋 日常开发命令

### 初始化（第一次进入容器时）
```bash
npm run init:container
```

### 日常开发循环
```bash
# 1. Windows 编辑保存文件

# 2. 容器内（如果修改了 .ts 文件）
npm run rebuild

# 3. 运行测试
npm run test:basic

# 4. 启动应用
npm run dev
```

---

## 🎯 完整命令列表

### 初始化相关
```bash
npm run init:container    # 完整初始化（推荐第一次使用）
npm run rebuild           # 快速重建（只编译，不重装依赖）
npm run fix:build         # 清理并完全重建
```

### 测试相关
```bash
npm run test:basic        # 基础测试（无需编译）
npm run test:db           # 同上
npm run test:reorg        # Reorg 测试（需要先 build）
npm run test:stress       # 压力测试（需要先 build）
npm run test:all          # 运行所有测试
```

### 开发相关
```bash
npm run dev               # 启动生产版本索引器
npm run dev:failfast      # 启动 fail-fast 版本
npm run build             # 编译 TypeScript
```

### 数据库相关
```bash
npm run db:init           # 初始化数据库
npm run db:status         # 查看数据库状态
npm run db:migrate        # 运行迁移
```

---

## 🔧 故障排除

### 问题：Cannot find module 'viem'
```bash
# 解决方案
npm run init:container
```

### 问题：编译失败
```bash
# 清理并重建
npm run fix:build
```

### 问题：测试失败
```bash
# 1. 重新构建
npm run rebuild

# 2. 检查数据库
npm run db:status

# 3. 重新初始化
npm run init:container
```

---

## 📊 验证安装成功

运行 `npm run init:container` 后应该看到：

```
🔧 Initializing container environment...
==========================================
📦 Step 1/4: Cleaning old build artifacts...
✅ Cleanup complete

📦 Step 2/4: Installing dependencies...
✅ Dependencies installed

🔨 Step 3/4: Building project...
✅ Build complete

🔍 Step 4/4: Verifying installation...
✅ All dependencies verified

==========================================
✅ Container environment initialized!

Environment Info:
  - Node.js: v20.x.x
  - npm: 10.x.x
  - Platform: linux
  - Architecture: x64

📦 Key Dependencies:
  - viem: 1.x.x
  - pg: 8.x.x
  - kysely: 0.x.x

🚀 You can now run:
  npm run test:basic     # Run basic tests
  npm run dev            # Start indexer
```

---

## 💡 最佳实践

### 推荐工作流

1. **第一次进入容器**
   ```bash
   docker exec -it web3-indexer-app bash
   npm run init:container
   ```

2. **日常开发**
   - Windows: VS Code 编辑 `.ts` 文件
   - 容器: `npm run rebuild`（如果修改了代码）
   - 容器: `npm run test:basic`（测试）
   - 容器: `npm run dev`（运行）

3. **遇到问题时**
   ```bash
   npm run fix:build  # 完全重建
   ```

### 速度对比

| 命令 | 时间 | 用途 |
|------|------|------|
| `npm run rebuild` | ~10s | 修改代码后快速编译 |
| `npm run init:container` | ~1-2min | 第一次初始化 |
| `npm run fix:build` | ~2-3min | 遇到问题时完全重建 |

---

## 🎯 快速命令参考

```bash
# 必备命令
npm run init:container    # 一次性初始化
npm run test:basic        # 测试
npm run dev               # 运行

# 常用组合
npm run rebuild && npm run test:basic    # 重建并测试
npm run build && npm run dev              # 编译并运行

# 故障排除
npm run fix:build         # 完全重建
```

---

## ✅ 成功标志

初始化成功后，以下命令都应该正常工作：

```bash
npm run test:basic     # ✅ 应该显示测试通过
npm run db:status      # ✅ 应该显示数据库信息
npm run dev            # ✅ 应该能启动索引器
```

---

**准备好了？立即运行**：
```bash
npm run init:container
```
