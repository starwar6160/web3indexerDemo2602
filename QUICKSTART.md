# Quick Start Guide

## 🚀 One-Command Setup (After Clone)

```bash
# 1. Install dependencies
npm install

# 2. Start development services (PostgreSQL + Anvil)
docker-compose up -d

# 3. Initialize database
npm run db:init

# 4. Setup environment configuration
cp .env.example .env

# 5. Start indexer + API
make dev-with-demo
```

## 📝 Configuration

### Minimal `.env` Configuration

The `.env.example` file contains all required configuration:

```bash
# Database (PostgreSQL)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/web3_indexer

# RPC Node (Anvil/Local Chain)
RPC_URL=http://localhost:58545

# ERC20 Token Contract (SimpleBank)
TOKEN_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000

# API Server
API_PORT=3001
```

After deploying a demo contract, update `TOKEN_CONTRACT_ADDRESS` in `.env`.

## 🌐 Access the Dashboard

**From WSL/Linux:**
```
http://localhost:3001/dashboard
```

**From Windows (after port forward):**
```powershell
# Run in PowerShell as Administrator
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=172.27.94.215
```

Then access: `http://localhost:3001/dashboard`

## 🛠️ Useful Commands

```bash
make help              # Show all available commands
make up                # Start Docker services
make down              # Stop Docker services
make dev-with-demo     # Deploy demo + start indexer + API
make reset-all         # HARD RESET: truncate DB + restart
make kill              # Kill all running processes
make doctor            # System health check
```

## 📊 API Endpoints

- **Health**: `http://localhost:3001/health`
- **Dashboard**: `http://localhost:3001/dashboard`
- **API Docs**: `http://localhost:3001/docs`
- **Sync Status**: `http://localhost:3001/api/status`
- **Blocks**: `http://localhost:3001/api/blocks`
- **Transfers**: `http://localhost:3001/api/transfers`

## 🔍 Troubleshooting

**Port already in use?**
```bash
make kill  # Kill all processes
```

**Database errors?**
```bash
make db-clean  # Truncate tables
make reset-all  # Full reset + restart
```

**Need fresh start?**
```bash
make reset-all  # Breaks logic deadlock, starts from block 0
```

## 📖 More Information

See [README.md](README.md) for detailed architecture and design decisions.
