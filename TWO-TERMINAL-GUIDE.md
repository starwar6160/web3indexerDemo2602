# 🖥️ Two-Terminal Development Guide

This guide shows you how to run the indexer and chaos tests in separate terminals for real-time monitoring.

## Quick Setup (One-Time)

```bash
# 1. Clone repository
git clone https://github.com/starwar6160/web3indexerDemo2602.git
cd web3indexerDemo2602

# 2. Auto-install dependencies (Ubuntu/Fedora/CentOS)
make install-deps

# 3. Install Node.js dependencies
make install

# 4. Start infrastructure (PostgreSQL + Anvil)
docker-compose up -d

# 5. Initialize database
npm run db:init

# 6. Deploy demo contract and generate transfers
npx ts-node scripts/auto-deploy-erc20-demo.ts
```

---

## Terminal 1: Start Indexer + API Server

Open a terminal and run:

```bash
# Start indexer (shows real-time sync progress)
npx ts-node --transpile-only src/index-enhanced.ts
```

**Expected output:**
```
[2026-02-07T...] 🚀 Starting Enhanced Web3 Block Indexer
[2026-02-07T...] Instance ID: 1af78e95-8577-4fdb-9718-8bed0d08cb37
[2026-02-07T...] RPC URL: http://localhost:58545
[2026-02-07T...] Token contract: 0x63ece4c05b8fb272d16844e96702ea2f26370982
[2026-02-07T...] ✅ Distributed lock system initialized
[2026-02-07T...] ✅ Checkpoint system initialized
[SyncEngine] ✅ Fetched block 0 from RPC 0
[SyncEngine] ✅ Fetched block 1 from RPC 0
...
[SyncEngine] ✅ Fetched 2 Transfer events
[SyncEngine] ✅ Batch sync complete: 100 inserted
```

**Keep this terminal open** to see sync progress in real-time!

---

## Terminal 2: Start API Server

Open a **second** terminal and run:

```bash
# Start API server
npm run start:api:dev
```

**Expected output:**
```
======================================================================
  🚀 API Server Started
======================================================================
  Dashboard: http://localhost:3001/dashboard
  API Docs:  http://localhost:3001/docs
  Health:    http://localhost:3001/health

  📍 WSL2 Access Information:
     WSL IP: 172.27.94.215
     From Windows: http://localhost:3001/dashboard
     From Network:  http://172.27.94.215:3001/dashboard
======================================================================
```

**Dashboard URL**: http://localhost:3001/dashboard

---

## Terminal 3: Run Chaos Tests

Open a **third** terminal and run chaos tests:

### Option 1: Run All Chaos Tests (Automated)

```bash
# Run all 4 chaos tests in sequence
npm run chaos:automated
```

**What it tests:**
- ✅ toxic-rpc: Simulates RPC failures and tests retry logic
- ✅ bigint: Tests numeric precision (100 ETH transfers)
- ✅ db-killer: Simulates database crash and recovery
- ⚠️  reorg: Tests chain reorganization (5-block depth)

**Expected output:**
```
🐵 Running Chaos Engineering Tests...
✅ toxic-rpc: PASSED (RPC failure recovery)
✅ bigint: PASSED (Numeric precision handling)
✅ db-killer: PASSED (Crash recovery)
⚠️  reorg: FAILED (optimization needed)

Pass Rate: 75% (3/4)
```

### Option 2: Run Individual Chaos Tests

```bash
# Test 1: RPC Failure Simulation
npm run chaos:automated toxic-rpc

# Test 2: BigInt Precision (100 ETH)
npm run chaos:automated bigint

# Test 3: Database Crash Recovery
npm run chaos:automated db-killer

# Test 4: Chain Reorganization (5-block rollback)
npm run chaos:automated reorg
```

### Option 3: Interactive Chaos Testing

```bash
# Run toxic-rpc proxy in interactive mode
npx ts-node --transpile-only scripts/chaos/toxic-rpc-proxy.ts

# Then in another terminal, trigger transfers and watch the indexer retry
```

**Controls:**
- Press `s` to stop chaos
- Press `q` to quit
- Watch Terminal 1 (indexer) for retry attempts

---

## What You'll See

### Terminal 1 (Indexer)
```
[SyncEngine] ✅ Fetched block 1234 from RPC 0
[SyncEngine] ✅ Saved 5 Transfer events in same transaction
[SyncEngine] ✅ Batch sync complete: 100 inserted
[ConnectionManager] ✅ Connection verified (default)
[SyncEngine] Syncing batch 1200 to 1299...
```

### Terminal 2 (API Server)
```
[01:53:44 UTC] INFO: 🚀 API server started
    module: "indexer"
    port: 3001
    endpoints: [...]
```

### Terminal 3 (Chaos Tests)
```
🐵 Running Chaos Engineering Tests...
☠️  Testing RPC failure handling...
✅ toxic-rpc: PASSED (10 retries, 8 succeeded)
💥 Testing numeric boundaries...
✅ bigint: PASSED (100 ETH stored and displayed correctly)
💀 Testing database crash recovery...
✅ db-killer: PASSED (checkpoint mechanism working)
```

### Dashboard (Browser)
Navigate to: http://localhost:3001/dashboard

You'll see:
- **Sync Status**: "Syncing" or "Synchronized"
- **Latest Indexed Block**: Real-time counter
- **Sync Lag**: Blocks behind chain tip
- **Recent Transfers**: Live list of ERC20 transfers
- **Metrics**: Reorgs detected, RPC error rate, DB writes

---

## Common Workflows

### Workflow 1: Development + Monitoring

```bash
# Terminal 1: Start indexer
npx ts-node --transpile-only src/index-enhanced.ts

# Terminal 2: Start API
npm run start:api:dev

# Terminal 3: Watch logs
tail -f indexer.log
```

### Workflow 2: Chaos Testing

```bash
# Terminal 1: Start indexer (watch for retries)
npx ts-node --transpile-only src/index-enhanced.ts

# Terminal 2: Start API
npm run start:api:dev

# Terminal 3: Run chaos tests
npm run chaos:automated

# Watch Terminal 1 for:
# - Retry attempts during RPC failures
# - Checkpoint recovery after DB crashes
# - Reorg detection and rollback
```

### Workflow 3: Debugging

```bash
# Terminal 1: Start indexer with verbose logging
LOG_LEVEL=debug npx ts-node --transpile-only src/index-enhanced.ts

# Terminal 2: Start API
npm run start:api:dev

# Terminal 3: Run specific test
npm run chaos:automated bigint

# Watch Terminal 1 for detailed logs
```

---

## Quick Reference Commands

### Indexer Commands

```bash
# Start indexer
npx ts-node --transpile-only src/index-enhanced.ts

# Start with debug logging
LOG_LEVEL=debug npx ts-node --transpile-only src/index-enhanced.ts

# Start with custom RPC
RPC_URL=http://localhost:8545 npx ts-node --transpile-only src/index-enhanced.ts
```

### API Commands

```bash
# Start API server
npm run start:api:dev

# Start on custom port
API_PORT=8080 npm run start:api:dev

# Check API health
curl http://localhost:3001/health

# Check sync status
curl http://localhost:3001/api/status | jq
```

### Chaos Test Commands

```bash
# Run all chaos tests
npm run chaos:automated

# Run specific test
npm run chaos:automated bigint

# Run with verbose output
npm run chaos:automated toxic-rpc -- --verbose

# Run tests in sequence
make chaos && make chaos-reorg && make chaos-bigint
```

---

## Troubleshooting

### "Port already in use"

```bash
# Kill all processes
make kill

# Or manually
sudo lsof -ti :3001 | xargs kill -9
sudo lsof -ti :5432 | xargs kill -9
sudo lsof -ti :58545 | xargs kill -9
```

### "Cannot connect to database"

```bash
# Check database is running
docker-compose ps

# Restart database
docker-compose restart postgres

# Reinitialize database
npm run db:init
```

### "Indexer not syncing"

```bash
# Check indexer logs in Terminal 1
# Look for error messages

# Reset database
make db-clean

# Start fresh
make dev-with-demo
```

---

## Tips

1. **Keep Terminal 1 open**: The indexer output shows real-time sync progress
2. **Refresh dashboard**: Press F5 to see latest sync status
3. **Run chaos tests**: Use Terminal 3 to test system resilience
4. **Monitor logs**: Use `tail -f` to follow log files
5. **Check metrics**: Visit `/metrics` endpoint for Prometheus metrics

---

## Advanced: Screen/Tmux Sessions

For a professional setup, use `tmux` or `screen`:

```bash
# Create tmux session with 3 windows
tmux new-session -d -s web3-indexer 'npx ts-node --transpile-only src/index-enhanced.ts'
tmux new-window -t web3-indexer -n 'api' 'npm run start:api:dev'
tmux new-window -t web3-indexer -n 'chaos' 'npm run chaos:automated'
tmux attach-session -t web3-indexer

# Navigate windows:
# Ctrl+B 0  → Indexer
# Ctrl+B 1  → API
# Ctrl+B 2  → Chaos
```

---

**Happy Testing! 🚀**
