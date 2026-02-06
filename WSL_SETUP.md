# 🖥️ WSL 网络访问指南

## 问题

WSL 2 中运行的服务无法通过 `localhost` 从 Windows 浏览器直接访问。

## 快速解决方案

### 方案 1：使用 WSL IP 地址（推荐）

**步骤 1**: 在 WSL 中获取 IP 地址
```bash
hostname -I
# 输出示例: 172.27.94.215
```

**步骤 2**: 在 Windows 浏览器中使用 WSL IP
```
http://172.27.94.215:3001/dashboard
http://172.27.94.215:3001/docs
```

### 方案 2：使用 Windows 端口转发（无需修改 IP）

**在 PowerShell (管理员) 中运行**:
```powershell
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=172.27.94.215
```

然后可以通过 localhost 访问：
```
http://localhost:3001/dashboard
http://localhost:3001/docs
```

**删除端口转发**:
```powershell
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0
```

**查看所有端口转发**:
```powershell
netsh interface portproxy show all
```

### 方案 3：使用仪表板内置的 WSL 配置

如果 API 调用失败，仪表板会自动显示 WSL 配置面板：

1. 打开 `http://localhost:3001/dashboard` (或 WSL IP)
2. 如果看到 "WSL Network Configuration" 面板
3. 点击 "Auto-Detect" 按钮自动检测
4. 或手动输入 WSL IP (运行 `hostname -I` 获取)
5. 点击 "Save & Reload"

配置会保存在浏览器 localStorage 中，下次访问自动使用。

## 开发建议

### 在 package.json 中添加脚本

```json
{
  "scripts": {
    "dev:ip": "echo \"WSL IP: $(hostname -I | awk '{print $1}')\" && npm run start:api",
    "get-ip": "hostname -I | awk '{print $1}'"
  }
}
```

### 在 Makefile 中添加帮助

```makefile
.PHONY: ip
ip:
	@echo "WSL IP: $$(hostname -I | awk '{print $$1}')"
	@echo "Dashboard: http://$$(hostname -I | awk '{print $$1}'):3001/dashboard"
	@echo "API Docs:  http://$$(hostname -I | awk '{print $$1}'):3001/docs"
```

使用：
```bash
make ip
# 输出:
# WSL IP: 172.27.94.215
# Dashboard: http://172.27.94.215:3001/dashboard
# API Docs:  http://172.27.94.215:3001/docs
```

## 永久解决方案

### 使用 WSL 配置文件

创建 `%USERPROFILE%/.wslconfig`:
```ini
[wsl2]
localhostForwarding=true
```

然后重启 WSL：
```powershell
wsl --shutdown
wsl
```

### 使用 hosts 文件

编辑 `C:\Windows\System32\drivers\etc\hosts` (管理员权限):
```
172.27.94.215  wsl.local
```

然后可以通过 `http://wsl.local:3001/dashboard` 访问。

## 验证连接

### 从 WSL 内部
```bash
curl http://localhost:3001/health
# 应该返回: {"status":"ok","timestamp":"..."}
```

### 从 Windows
```powershell
# 使用 WSL IP
curl http://172.27.94.215:3001/health

# 或使用端口转发（如果已设置）
curl http://localhost:3001/health
```

## 故障排查

### 问题 1: Connection Refused
**原因**: 服务未启动或防火墙阻止
**解决**:
```bash
# 检查服务是否运行
curl http://localhost:3001/health

# 检查端口占用
netstat -tuln | grep 3001
```

### 问题 2: WSL IP 变化
**原因**: WSL2 IP 每次重启后可能变化
**解决**: 使用端口转发方案，或更新仪表板配置

### 问题 3: CORS 错误
**原因**: API 未配置 CORS
**解决**: 已在 `src/api/server.ts` 中配置，确保 `enableCors: true`

## 最佳实践

1. **开发时**: 使用 WSL IP 地址直接访问
2. **演示时**: 设置端口转发，使用 localhost
3. **生产时**: 使用 0.0.0.0 监听所有接口

## 修改 API 监听地址

如果需要 API 监听所有接口（不仅仅是 localhost）:

编辑 `src/api/server.ts`:
```typescript
export async function startApiServer(config: Partial<ApiServerConfig> = {}): Promise<void> {
  const { app, config: finalConfig } = createApiServer(config);

  return new Promise((resolve, reject) => {
    const server = app.listen(finalConfig.port, '0.0.0.0', () => {  // ← 改这里
      logger.info(
        {
          port: finalConfig.port,
          host: '0.0.0.0',  // ← 监听所有接口
        },
        '🚀 API server started'
      );
      resolve();
    });

    server.on('error', (err) => {
      logger.error({ error: err }, 'API server failed to start');
      reject(err);
    });
  });
}
```

## 快速参考

```bash
# 获取 WSL IP
hostname -I | awk '{print $1}'

# 测试 API 连接
curl http://$(hostname -I | awk '{print $1}'):3001/health

# 在 Windows PowerShell 中设置端口转发
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=<WSL_IP>

# 删除端口转发
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0
```
