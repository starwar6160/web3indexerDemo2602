# Web3 Indexer 监控命令大全

## 🎯 当前状态说明

**重要提示：** Anvil 默认只在收到交易时才出块。如果你看到区块号为0是正常的，因为：
- Anvil 在没有交易时会保持区块号不变
- 索引器运行正常（每2秒轮询一次RPC）
- 为了看到区块增长，需要发送一些交易

## 🔍 核心监控命令

### 1. 整体状态查看
```bash
# Windows
status.bat

# Linux/Mac
bash status.sh
```

### 2. Anvil 专用监控命令

#### 基础状态
```bash
# 查看Anvil容器状态
docker ps --filter "name=web3-indexer-anvil"

# 查看Anvil日志
docker logs web3-indexer-anvil

# 查看最近20行日志
docker logs --tail 20 web3-indexer-anvil

# 实时查看日志
docker logs -f web3-indexer-anvil
```

#### RPC 连接测试
```bash
# 测试RPC是否响应
curl -s http://localhost:58545 | wc -c

# 获取区块号
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://localhost:58545
```

#### 手动触发交易（看到区块增长）
```bash
# 使用curl发送一个简单的转账交易（需要准备私钥）
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

### 3. 索引器专用监控命令

#### 进程检查
```bash
# 查看Node.js进程
tasklist | findstr node

# 查看具体ts-node进程
tasklist | findstr "ts-node index.ts"

# 检查端口占用
netstat -ano | findstr "3000"  # 如果你的索引器运行在其他端口
```

#### 日志查看
```bash
# 查看索引器进程输出（在运行的终端窗口中）
# 使用logs.sh脚本
bash logs.sh indexer

# 查看npm日志
npm logs web3-indexer-demo

# 如果需要查看所有Node.js相关日志
findstr /i "ts-node index" C:\Users\%USERNAME%\AppData\Roaming\npm-cache\_logs\*.log
```

### 4. PostgreSQL 数据库监控

#### 基础状态
```bash
# 查看PostgreSQL容器状态
docker ps --filter "name=web3-indexer-db"

# 查看PostgreSQL日志
docker logs web3-indexer-db

# 查看最近20行日志
docker logs --tail 20 web3-indexer-db

# 实时查看日志
docker logs -f web3-indexer-db
```

#### 连接测试
```bash
# 测试数据库连接
docker exec web3-indexer-db psql -U postgres -d web3_indexer -c "SELECT version();"

# 检查数据库状态
docker exec web3-indexer-db pg_isready -U postgres

# 查看数据库大小
docker exec web3-indexer-db psql -U postgres -d web3_indexer -c "SELECT pg_database_size('web3_indexer');"
```

### 5. 网络连接监控

#### 检查端口映射
```bash
# 查看所有端口映射
docker port web3-indexer-anvil
docker port web3-indexer-db

# 检查端口是否被占用
netstat -ano | findstr "58545"  # Anvil端口
netstat -ano | findstr "15432"  # PostgreSQL端口
```

#### 网络连通性测试
```bash
# 测试Anvil RPC连通性
ping localhost
telnet localhost 58545
curl -v http://localhost:58545

# 测试PostgreSQL连通性
telnet localhost 15432
docker exec web3-indexer-db telnet localhost 5432
```

## 🚨 故障排除命令

### 重启服务
```bash
# 重启区块链节点 (Anvil)
docker-compose restart blockchain-node

# 重启PostgreSQL
docker-compose restart postgres

# 重启所有服务
docker-compose down && docker-compose up -d
```

### 深度诊断
```bash
# 查看容器详细信息
docker inspect web3-indexer-anvil
docker inspect web3-indexer-db

# 查看Docker网络
docker network ls
docker network inspect web3indexerdemo2602_default

# 查看容器资源使用
docker stats web3-indexer-anvil
docker stats web3-indexer-db
```

### 清理和重置
```bash
# 停止并删除容器（保留卷）
docker-compose down

# 完全清理（包括卷）
docker-compose down -v

# 清理Docker缓存
docker system prune -f
```

## 📊 实用脚本

### 创建自动化监控脚本
```bash
# 创建持续监控脚本（Windows）
echo @echo off > monitor.bat
echo :loop >> monitor.bat
echo status.bat >> monitor.bat
echo timeout /t 30 >> monitor.bat
echo goto loop >> monitor.bat
```

### 性能监控
```bash
# 监控CPU和内存使用
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep web3-indexer-
```

## 💡 最佳实践

1. **定期检查**: 使用 `status.bat` 定期检查整体状态
2. **日志管理**: 使用 `logs.sh` 查看特定服务日志
3. **网络测试**: 定期测试RPC和数据库连接
4. **资源监控**: 关注CPU和内存使用情况
5. **备份**: 定期备份数据库卷

---

**提示**: 在调试时，建议使用 `docker logs -f` 实时查看日志，这样可以立即看到问题。