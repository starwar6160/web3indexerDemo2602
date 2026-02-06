# 🚀 快速开始指南

## 问题解决

**问题**: `make dev` 后，3001 端口没有监听

**原因**: `make dev` 只启动索引器同步进程，不启动 API 服务器

**解决方案**: ✅ 已修复！

---

## 新的使用方法

### 方案 1: 使用 `make dev-full`（推荐）

**一键启动完整的开发环境**（索引器 + API 服务器）：

```bash
make dev-full
```

**启动后您会看到**：
```
🚀 Starting full development environment (Indexer + API)...
Indexer running on: Logs to console
API Dashboard: http://localhost:3001/dashboard
```

**然后在浏览器打开**：
- 仪表板：`http://localhost:3001/dashboard`
- API 文档：`http://localhost:3001/docs`
- 健康检查：`http://localhost:3001/health`

### 方案 2: 分别启动（调试时）

**终端 1 - 启动索引器**：
```bash
make dev
```

**终端 2 - 启动 API 服务器**：
```bash
make api
```

---

## WSL 用户

如果您在 WSL 中运行，需要使用 WSL IP 地址访问：

```bash
make ip
```

**输出示例**：
```
🌐 Network Access Information

WSL IP Address:  172.27.94.215

Access URLs:
  Dashboard: http://172.27.94.215:3001/dashboard
  API Docs:  http://172.27.94.215:3001/docs
  Health:    http://172.27.94.215:3001/health
```

**在 Windows 浏览器中复制粘贴上述 URL 即可！**

---

## 完整开发流程

```bash
# 1. 首次设置（30 秒）
make setup

# 2. 启动完整环境
make dev-full

# 3. 查看访问信息（WSL 用户）
make ip

# 4. 在浏览器打开仪表板
# http://localhost:3001/dashboard (或 WSL IP)

# 5. 运行测试
make test-integrity

# 6. 停止服务（Ctrl+C）
```

---

## Makefile 命令速查

| 命令 | 功能 |
|------|------|
| `make help` | 显示所有命令 |
| `make setup` | 一键安装+启动+初始化 |
| `make dev-full` | **启动索引器+API**（推荐） |
| `make dev` | 仅启动索引器 |
| `make api` | 仅启动 API 服务器 |
| `make ip` | 显示 WSL IP 和访问 URL |
| `make test` | 运行所有测试 |
| `make doctor` | 系统健康检查 |

---

## 验证服务运行

### 检查索引器
```bash
# 应该看到日志输出：
# ✅ Database connection verified
# 🚀 Starting production-ready Web3 block indexer...
```

### 检查 API 服务器
```bash
curl http://localhost:3001/health
# 应该返回：
# {"status":"ok","timestamp":"..."}
```

### 检查仪表板 ✅ 已修复
在浏览器打开：`http://localhost:3001/dashboard`

**应该看到**：
- ⚡ Web3 Indexer 标题
- 实时同步状态（绿色/黄色/红色指示灯）
- Network Tip, Indexed Height, Sync Lag 等指标
- Recent Blocks 和 Recent Transfers 表格

**修复验证**（2026-02-06）：
- ✅ 修复了 "Cannot GET /dashboard/" 错误
- ✅ 使用专用路由替代静态中间件
- ✅ 仪表板现在可以正常访问
- ✅ 所有 API 端点正常工作（BigInt 安全）

---

## 故障排查

### 问题 1: 端口被占用
```bash
# 查看端口占用
netstat -tuln | grep 3001

# 杀死占用进程
pkill -f "ts-node src/api/server"
```

### 问题 2: 数据库连接失败
```bash
# 检查数据库运行
make doctor

# 重新初始化
make db-init
```

### 问题 3: WSL 无法访问
```bash
# 查看访问信息
make ip

# 使用显示的 WSL IP 而不是 localhost
# 例如：http://172.27.94.215:3001/dashboard
```

---

## 常见使用场景

### 场景 1: 日常开发
```bash
make dev-full  # 启动所有服务
# 开始开发...
```

### 场景 2: 只看仪表板
```bash
make api  # 只启动 API（更快）
# 浏览器打开 http://localhost:3001/dashboard
```

### 场景 3: 面试演示
```bash
# WSL 用户
make ip  # 获取 URL
make dev-full  # 启动服务
# 复制显示的 URL 到浏览器
```

### 场景 4: 调试 API
```bash
# 终端 1
make api

# 终端 2
curl http://localhost:3001/api/status | jq
```

---

## 文档参考

- `FEATURES.md` - 所有功能详细说明
- `DEMO_GUIDE.md` - 面试演示脚本
- `WSL_SETUP.md` - WSL 网络配置指南
- `README.md` - 项目概述

---

**现在您可以愉快地使用 Web3 Indexer 了！** 🎉
