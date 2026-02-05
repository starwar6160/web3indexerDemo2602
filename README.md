# Web3 Indexer Demo

这是一个完整的 Web3 后端索引器演示项目，包含 Docker 容器化的本地开发链、数据库和 TypeScript 索引器。

## 🏗️ 项目结构

```
web3indexerDemo2602/
├── docker-compose.yml      # Docker 服务配置
├── package.json           # Node.js 项目配置
├── tsconfig.json          # TypeScript 配置
├── index.ts              # 主索引器代码
├── status.bat            # Windows 状态监控脚本
├── status.sh             # Linux/Mac 状态监控脚本
├── logs.sh               # 日志查看脚本
└── README.md             # 项目说明文档
```

## 🚀 快速开始

### 1. 启动服务
```bash
docker-compose up -d
```

### 2. 启动索引器
```bash
npm run dev
```

## 📊 服务监控

### Windows 系统
```bash
status.bat
```

### Linux/Mac 系统
```bash
bash status.sh
```

### 查看日志
```bash
# 查看 Anvil 日志
bash logs.sh anvil

# 查看 PostgreSQL 日志
bash logs.sh postgres

# 查看索引器日志
bash logs.sh indexer

# 实时跟进日志
bash logs.sh follow anvil
bash logs.sh follow postgres
```

## 🌐 服务访问

- **Anvil RPC**: http://localhost:58545
- **PostgreSQL**: localhost:15432 (用户: postgres, 密码: password)
- **容器名称**:
  - Anvil: `web3-indexer-anvil`
  - PostgreSQL: `web3-indexer-db`

## 🛠️ 常用命令

### Docker 管理
```bash
# 查看运行状态
docker ps --filter "name=web3-indexer-"

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 进入容器
docker exec -it web3-indexer-anvil bash
docker exec -it web3-indexer-db bash
```

### 服务管理
```bash
# 构建 TypeScript
npm run build

# 生产运行
npm start

# 开发运行
npm run dev
```

## 🔧 配置说明

### 端口配置
- Anvil: 容器端口 8545 → 宿主机端口 58545
- PostgreSQL: 容器端口 5432 → 宿主机端口 15432

### 环境变量
- `ANVIL_ACCOUNTS`: 10 个预分配账户
- `ANVIL_BALANCE`: 每个账户 10000 ETH
- `POSTGRES_DB`: 数据库名称
- `POSTGRES_USER`: 用户名
- `POSTGRES_PASSWORD`: 密码

## 📋 服务状态

✅ **Docker 容器**: 固定名称 `web3-indexer-anvil` 和 `web3-indexer-db`
✅ **网络绑定**: Anvil 绑定到 `0.0.0.0:8545`
✅ **端口映射**: 使用 Hyper-V 兼容的端口
✅ **自动重启**: 服务异常时自动重启
✅ **状态监控**: 提供详细的监控脚本

## 🔍 故障排除

### 常见问题

1. **端口冲突**: 如果端口被占用，修改 `docker-compose.yml` 中的端口映射
2. **连接失败**: 检查服务是否正常运行，使用 `status.bat` 查看状态
3. **容器异常**: 使用 `docker-compose logs` 查看详细日志

### 日志查看
```bash
# 查看 Anvil 完整日志
docker logs web3-indexer-anvil

# 查看 PostgreSQL 完整日志
docker logs web3-indexer-db

# 实时查看日志
docker-compose logs -f anvil
docker-compose logs -f postgres
```

## 🎯 下一步

1. **数据库集成**: 连接 PostgreSQL 数据库存储索引数据
2. **事件监听**: 监听区块链事件而非轮询区块号
3. **API 服务**: 添加 REST API 接口
4. **生产部署**: 配置生产环境的 Docker Compose

---

**提示**: 在 Windows 上请使用 `status.bat`，在 Linux/Mac 上使用 `status.sh`