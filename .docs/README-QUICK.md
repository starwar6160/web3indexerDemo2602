# 🚀 Web3 Indexer Demo - 快速开始指南

## 📋 项目概述

这是一个专业的 Web3 区块链索引器演示项目，使用以下技术栈：
- **区块链**: Anvil (本地以太坊开发链)
- **数据库**: PostgreSQL
- **语言**: TypeScript
- **ORM**: Kysely (类型安全的 SQL 查询构建器)
- **验证**: Zod (运行时类型验证)
- **客户端**: Viem (TypeScript 以太坊客户端)

## 🎯 核心功能

✅ 每2秒轮询一次新区块
✅ 增量同步（从最后一个已知区块继续）
✅ 批量处理（每批10个区块）
✅ Zod 数据验证（防止脏数据）
✅ 自动初始化数据库表
✅ 完善的测试工具

---

## 🚀 快速开始

### 1. 启动服务
```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps
```

你应该看到4个服务正在运行：
- `web3-indexer-anvil` - 本地区块链
- `web3-indexer-db` - PostgreSQL 数据库
- `web3-indexer-app` - 索引器应用
- `web3-indexer-workspace` - 开发环境容器

### 2. 进入开发容器
```bash
# Windows
workspace.bat bash

# Linux/Mac
./workspace.sh bash
```

### 3. 运行测试
```bash
# 快速测试（3笔交易）
npm run container:quick

# 实时监控
npm run container:monitor

# 交互式菜单
npm run container:interactive
```

---

## 📊 测试脚本说明

### 容器内脚本（推荐）

这些脚本在 workspace 容器内运行，不需要 docker 命令：

| 脚本 | 命令 | 功能 |
|------|------|------|
| 快速测试 | `npm run container:quick` | 发送3笔交易并验证同步 |
| 实时监控 | `npm run container:monitor` | 实时显示同步状态（5秒刷新） |
| 交互式 | `npm run container:interactive` | 菜单驱动的测试工具 |

### 宿主机脚本

这些脚本在宿主机运行，使用 docker 命令：

| 脚本 | 命令 | 功能 |
|------|------|------|
| 快速测试 | `npm run test:quick` | 发送3笔交易 |
| 实时监控 | `npm run test:monitor` | 监控同步状态 |
| 交互式 | `npm run test:interactive` | 菜单工具 |

---

## 🔍 常用命令

### 查看数据库状态
```bash
npm run db:status
```

**输出示例**:
```
[CHECK] Checking database status...
[CHECK] ✅ Database connection successful
[CHECK] Total blocks in database: 100
[CHECK] Latest block number: 99
[CHECK] ℹ️  Database contains blocks from 0 to 99
```

### 查看索引器日志
```bash
# 宿主机上运行
docker logs web3-indexer-app --tail 50

# 实时跟踪日志
docker logs -f web3-indexer-app
```

### 查看服务状态
```bash
docker-compose ps
```

### 重启服务
```bash
# 重启索引器
docker-compose restart indexer

# 重启所有服务
docker-compose restart
```

---

## 📂 项目结构

```
web3indexerDemo2602/
├── docker-compose.yml              # Docker 编排配置
├── package.json                    # Node.js 依赖配置
├── tsconfig.json                   # TypeScript 配置
├── index.ts                        # 主索引器程序
├── database/                       # 数据库层
│   ├── config.ts                   # 数据库配置
│   ├── database-types.ts           # Kysely 类型定义
│   ├── block-repository.ts         # 区块数据访问层
│   ├── schemas.ts                  # Zod 验证模式
│   └── init-database.ts            # 数据库初始化
├── scripts/                        # 测试脚本
│   ├── container-quick-test.sh     # 容器内快速测试
│   ├── container-monitor.sh        # 容器内实时监控
│   ├── container-interactive.sh    # 容器内交互式工具
│   └── check-database.ts           # 数据库状态检查
└── docs/                           # 文档
    ├── TESTING-GUIDE.md            # 宿主机测试指南
    ├── CONTAINER-TESTING-GUIDE.md  # 容器内测试指南
    └── README-QUICK.md             # 本文档
```

---

## 🔧 技术架构

### 数据流

```
Anvil (每2秒生成新区块)
    ↓
Indexer (轮询 eth_blockNumber)
    ↓
获取区块数据 (eth_getBlockByNumber)
    ↓
Zod 验证 (数据完整性检查)
    ↓
批量入库 (Kysely + PostgreSQL)
```

### 关键组件

1. **index.ts** - 主索引器
   - 轮询循环
   - 增量同步逻辑
   - 批量处理

2. **schemas.ts** - Zod 验证
   - 区块数据验证
   - 类型推导
   - 错误处理

3. **block-repository.ts** - 数据访问层
   - CRUD 操作
   - 事务管理
   - 查询优化

---

## 🧪 测试场景

### 场景 1: 验证基础同步
```bash
workspace.bat bash
npm run container:quick
```
**预期**: 数据库区块数从 100 → 103

### 场景 2: 实时监控
```bash
workspace.bat bash
npm run container:monitor
```
**预期**: 每隔2秒看到区块数+1

### 场景 3: 交互式测试
```bash
workspace.bat bash
npm run container:interactive
```
**选项**: 发送多笔交易，观察实时同步

---

## 🐛 故障排除

### 问题 1: 容器无法启动
```bash
# 检查端口占用
netstat -ano | findstr "58545"
netstat -ano | findstr "15432"

# 解决方案: 使用更高端口或关闭占用进程
```

### 问题 2: 索引器重启循环
```bash
# 查看日志
docker logs web3-indexer-app --tail 100

# 常见原因: 数据库表不存在
# 解决方案: 手动初始化
workspace.bat bash
npm run db:init
```

### 问题 3: 交易哈希为空
```bash
# 使用容器内脚本而非宿主机脚本
npm run container:quick  # ✅ 正确
npm run test:quick        # ❌ 可能在容器内无法正确解析
```

---

## 📚 详细文档

- **容器内测试指南**: [CONTAINER-TESTING-GUIDE.md](CONTAINER-TESTING-GUIDE.md)
- **宿主机测试指南**: [TESTING-GUIDE.md](TESTING-GUIDE.md)
- **数据库管理**: 参见 scripts/ 目录

---

## 🎓 学习要点

### 1. Kysely ORM
```typescript
// 类型安全的查询
const blocks = await db
  .selectFrom('blocks')
  .selectAll()
  .execute();
```

### 2. Zod 验证
```typescript
// 运行时验证 + 类型推导
const BlockSchema = z.object({
  number: z.bigint(),
  hash: z.string().startsWith('0x'),
});

export type ValidatedBlock = z.infer<typeof BlockSchema>;
```

### 3. Viem 客户端
```typescript
// 获取区块数据
const block = await client.getBlock({
  blockNumber: currentBlock
});
```

---

## 🚀 下一步

### 性能优化
- [ ] 并行获取区块
- [ ] WebSocket 订阅代替轮询
- [ ] 批处理优化
- [ ] 缓存层

### 功能增强
- [ ] 交易索引
- [ ] 合约事件索引
- [ ] 地址余额跟踪
- [ ] Webhook 通知

### 生产就绪
- [ ] 监控告警
- [ ] 健康检查
- [ ] 配置管理
- [ ] 日志聚合

---

## 📞 获取帮助

遇到问题？

1. 查看日志: `docker logs web3-indexer-app --tail 50`
2. 检查数据库: `npm run db:status`
3. 查看文档: `CONTAINER-TESTING-GUIDE.md`

---

**版本**: 1.0.0
**更新**: 2026-02-05
**作者**: Claude Code
