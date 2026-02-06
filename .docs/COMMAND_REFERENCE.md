# 🎯 容器环境命令清单

## 🚀 立即执行（在容器内）

```bash
# ========== 一键初始化（第一次使用）==========
npm run init:container

# ========== 或者手动执行（如果脚本失败）==========
rm -rf node_modules package-lock.json dist && npm install && npm run build
```

---

## 📋 完整命令参考

### 🔧 初始化命令
```bash
npm run init:container    # ⭐ 完整初始化（推荐第一次使用）
npm run rebuild           # 快速重建（只编译）
npm run fix:build         # 完全重建（清理 + 安装 + 编译）
```

### 🧪 测试命令
```bash
npm run test:basic        # ⭐ 基础测试（推荐）
npm run test:db           # 同上
npm run test:reorg        # Reorg 测试
npm run test:stress       # 压力测试
npm run test:all          # 所有测试
```

### 🚀 运行命令
```bash
npm run dev               # ⭐ 启动索引器（推荐）
npm run dev:failfast      # 启动 fail-fast 版本
npm start                 # 生产模式
```

### 🔨 构建命令
```bash
npm run build             # 编译 TypeScript
npm run rebuild           # 清理 + 编译
```

### 💾 数据库命令
```bash
npm run db:init           # 初始化数据库
npm run db:status         # 查看数据库状态
npm run db:migrate        # 运行迁移
```

---

## 🎬 使用场景

### 场景 1: 第一次进入容器
```bash
# 步骤 1: 进入容器
docker exec -it web3-indexer-app bash

# 步骤 2: 初始化环境
npm run init:container

# 步骤 3: 测试
npm run test:basic
```

### 场景 2: 日常开发
```bash
# Windows 端
# 1. 编辑代码（VS Code）
# 2. 保存文件（Ctrl+S）

# 容器端
# 3. 重新编译（如果修改了 .ts 文件）
npm run rebuild

# 4. 测试
npm run test:basic
```

### 场景 3: 遇到 "Cannot find module" 错误
```bash
# 解决方案
npm run fix:build

# 或者
npm run init:container
```

### 场景 4: 修改了 TypeScript 代码
```bash
# 快速重新编译
npm run rebuild

# 测试修改
npm run test:basic

# 运行应用
npm run dev
```

---

## ⚡ 常用组合

```bash
# 重建并测试
npm run rebuild && npm run test:basic

# 完全重建并测试
npm run fix:build && npm run test:basic

# 编译并运行
npm run build && npm run dev

# 初始化并立即测试
npm run init:container && npm run test:basic
```

---

## 🔍 验证清单

初始化后，验证以下功能：

```bash
# 1. 测试基础功能
npm run test:basic
# 预期: ✅ All container tests passed

# 2. 检查数据库
npm run db:status
# 预期: 显示区块数量和范围

# 3. 检查健康端点
curl http://localhost:3001/healthz
# 预期: {"status":"healthy",...}

# 4. 启动应用
npm run dev
# 预期: 应用正常运行，开始同步区块
```

---

## 📊 时间估算

| 操作 | 时间 | 频率 |
|------|------|------|
| `npm run init:container` | 1-2 分钟 | 一次性 |
| `npm run rebuild` | 10-15 秒 | 每次修改代码 |
| `npm run test:basic` | 2-3 秒 | 每次测试 |

---

## 🎯 推荐命令

### 最常用（90% 的场景）
```bash
npm run rebuild           # 修改代码后
npm run test:basic        # 测试
npm run dev               # 运行
```

### 初始化（只在第一次）
```bash
npm run init:container
```

### 故障排除（遇到问题时）
```bash
npm run fix:build
```

---

## 💡 提示

### 快捷方式
```bash
# 创建别名（可选）
echo 'alias nb="npm run rebuild"' >> ~/.bashrc
echo 'alias nt="npm run test:basic"' >> ~/.bashrc
echo 'alias nd="npm run dev"' >> ~/.bashrc
source ~/.bashrc

# 使用
nb    # npm run rebuild
nt    # npm run test:basic
nd    # npm run dev
```

### 检查状态
```bash
# 查看环境变量
echo $DATABASE_URL
echo $RPC_URL

# 查看 Node 版本
node --version

# 查看已安装的包
npm list --depth=0
```

---

## ✅ 成功标准

运行 `npm run init:container` 后，您应该看到：

```
✅ Container environment initialized!

Environment Info:
  - Node.js: v20.x.x
  - Platform: linux
  - Architecture: x64

✅ All dependencies verified

🚀 You can now run:
  npm run test:basic
  npm run dev
```

然后运行 `npm run test:basic` 应该看到：

```
✅ All container tests passed!
```

---

## 🆘 获取帮助

```bash
# 查看所有可用命令
npm run

# 查看脚本
cat scripts/init-container-env.sh

# 查看日志
docker logs web3-indexer-app --tail 50

# 实时日志
docker logs web3-indexer-app -f
```

---

**准备好了？现在就在容器内运行**：
```bash
npm run init:container
```
