.PHONY: help install up down db-init dev test test-integrity doctor clean logs

# Default target
.DEFAULT_GOAL := help

# Colors for terminal output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

## help: Show this help message
help:
	@echo '$(BLUE)Web3 Indexer Demo - Developer Commands$(NC)'
	@echo ''
	@echo '$(GREEN)Usage:$(NC)'
	@echo '  make <target>'
	@echo ''
	@echo '$(GREEN)Available targets:$(NC)'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ''
	@echo '$(GREEN)Examples:$(NC)'
	@echo '  make install        # Install dependencies'
	@echo '  make up             # Start services'
	@echo '  make dev            # Run in development mode'
	@echo '  make test           # Run all tests'
	@echo '  make doctor         # Check system health'

## install: Install dependencies and setup environment
install:
	@echo '$(BLUE)📦 Installing dependencies...$(NC)'
	npm install
	@echo '$(GREEN)✅ Dependencies installed$(NC)'
	@echo ''
	@echo '$(BLUE)🔧 Checking environment...$(NC)'
	@if [ ! -f .env ]; then \
		echo '$(YELLOW)⚠️  .env file not found, creating from .env.example...$(NC)'; \
		cp .env.example .env 2>/dev/null || echo '# Add your configuration here' > .env; \
		echo '$(GREEN)✅ .env file created$(NC)'; \
	else \
		echo '$(GREEN)✅ .env file exists$(NC)'; \
	fi

## up: Start development services (Postgres + Anvil)
up:
	@echo '$(BLUE)🚀 Starting development services...$(NC)'
	docker-compose up -d
	@echo '$(GREEN)✅ Services started$(NC)'
	@echo ''
	@echo '$(BLUE)📊 Service status:$(NC)'
	@docker-compose ps
	@echo ''
	@echo '$(GREEN)✨ Ready! Run "make dev" to start the indexer$(NC)'

## down: Stop development services
down:
	@echo '$(BLUE)🛑 Stopping development services...$(NC)'
	docker-compose down
	@echo '$(GREEN)✅ Services stopped$(NC)'

## restart: Restart development services
restart: down up

## db-init: Initialize database schema
db-init:
	@echo '$(BLUE)🗄️  Initializing database schema...$(NC)'
	npx ts-node src/database/init-database.ts
	@echo '$(GREEN)✅ Database initialized$(NC)'

## db-migrate: Run database migrations
db-migrate:
	@echo '$(BLUE)🔄 Running database migrations...$(NC)'
	npx ts-node src/database/migration-runner.ts
	@echo '$(GREEN)✅ Migrations complete$(NC)'

## dev: Run indexer in development mode (with hot reload)
dev:
	@echo '$(BLUE)▶️  Starting indexer in development mode...$(NC)'
	npm run start:dev

## dev-watch: Run indexer with file watching
dev-watch:
	@echo '$(BLUE)👀 Starting indexer with file watching...$(NC)'
	npm run watch

## build: Build TypeScript code
build:
	@echo '$(BLUE)🔨 Building TypeScript...$(NC)'
	npm run build
	@echo '$(GREEN)✅ Build complete$(NC)'

## test: Run all tests
test:
	@echo '$(BLUE)🧪 Running all tests...$(NC)'
	npm test
	@echo '$(GREEN)✅ Tests complete$(NC)'

## test-integrity: Run C++ style BigInt boundary tests
test-integrity:
	@echo '$(BLUE)🔬 Running integrity tests (BigInt precision boundaries)...$(NC)'
	npm test -- tests/unit/type-safety.test.ts
	@echo '$(GREEN)✅ Integrity tests complete$(NC)'

## test-integration: Run integration tests only
test-integration:
	@echo '$(BLUE)🔗 Running integration tests...$(NC)'
	npm test -- tests/integration/
	@echo '$(GREEN)✅ Integration tests complete$(NC)'

## test-api: Run API tests only
test-api:
	@echo '$(BLUE)🌐 Running API tests...$(NC)'
	npm test -- tests/api/
	@echo '$(GREEN)✅ API tests complete$(NC)'

## coverage: Generate test coverage report
coverage:
	@echo '$(BLUE)📊 Generating test coverage...$(NC)'
	npm run test:coverage
	@echo '$(GREEN)✅ Coverage report generated$(NC)'

## lint: Run linter
lint:
	@echo '$(BLUE)🔍 Running linter...$(NC)'
	npm run lint
	@echo '$(GREEN)✅ Linting complete$(NC)'

## lint-fix: Fix linting issues automatically
lint-fix:
	@echo '$(BLUE)🔧 Fixing linting issues...$(NC)'
	npm run lint:fix
	@echo '$(GREEN)✅ Linting fixed$(NC)'

## doctor: Check system health and dependencies
doctor:
	@echo '$(BLUE)🏥 System Health Check$(NC)'
	@echo ''
	@echo '$(BLUE)Checking Docker...$(NC)'
	@docker --version > /dev/null 2>&1 && echo '  $(GREEN)✅ Docker installed$(NC)' || echo '  $(RED)❌ Docker not found$(NC)'
	@docker-compose --version > /dev/null 2>&1 && echo '  $(GREEN)✅ Docker Compose installed$(NC)' || echo '  $(RED)❌ Docker Compose not found$(NC)'
	@echo ''
	@echo '$(BLUE)Checking Node.js...$(NC)'
	@node --version > /dev/null 2>&1 && echo '  $(GREEN)✅ Node.js installed$(NC)' || echo '  $(RED)❌ Node.js not found$(NC)'
	@npm --version > /dev/null 2>&1 && echo '  $(GREEN)✅ npm installed$(NC)' || echo '  $(RED)❌ npm not found$(NC)'
	@echo ''
	@echo '$(BLUE)Checking port availability...$(NC)'
	@lsof -i :5432 > /dev/null 2>&1 && echo '  $(GREEN)✅ PostgreSQL on port 5432$(NC)' || echo '  $(YELLOW)⚠️  Port 5432 (PostgreSQL) not in use$(NC)'
	@lsof -i :8545 > /dev/null 2>&1 && echo '  $(GREEN)✅ RPC on port 8545$(NC)' || echo '  $(YELLOW)⚠️  Port 8545 (RPC) not in use$(NC)'
	@lsof:3011 > /dev/null 2>&1 && echo '  $(GREEN)✅ API on port 3001$(NC)' || echo '  $(YELLOW)⚠️  Port 3001 (API) not in use$(NC)'
	@echo ''
	@echo '$(BLUE)Checking Docker services...$(NC)'
	@docker-compose ps > /dev/null 2>&1 && echo '  $(GREEN)✅ Docker services running$(NC)' || echo '  $(YELLOW)⚠️  Docker services not running$(NC)'
	@echo ''
	@echo '$(BLUE)Checking dependencies...$(NC)'
	@test -d node_modules && echo '  $(GREEN)✅ node_modules exists$(NC)' || echo '  $(RED)❌ Dependencies not installed - run "make install"$(NC)'
	@test -f .env && echo '  $(GREEN)✅ .env file exists$(NC)' || echo '  $(YELLOW)⚠️  .env file not found - run "make install"$(NC)'

## logs: Show logs from development services
logs:
	docker-compose logs -f

## logs-db: Show only database logs
logs-db:
	docker-compose logs -f db

## logs-rpc: Show only RPC logs
logs-rpc:
	docker-compose logs -f anvil

## clean: Clean build artifacts and node_modules
clean:
	@echo '$(BLUE)🧹 Cleaning build artifacts...$(NC)'
	rm -rf dist
	@echo '$(GREEN)✅ Build artifacts removed$(NC)'
	@echo ''
	@echo '$(YELLOW)⚠️  To remove node_modules, run: make clean-all$(NC)'

## clean-all: Clean everything including dependencies
clean-all: clean
	@echo '$(BLUE)🧹 Removing node_modules...$(NC)'
	rm -rf node_modules
	@echo '$(GREEN)✅ node_modules removed$(NC)'

## reset: Reset database and start fresh (⚠️  DESTRUCTIVE)
reset:
	@echo '$(RED)⚠️  WARNING: This will delete all data!$(NC)'
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker-compose down -v; \
		docker-compose up -d; \
		sleep 3; \
		make db-init; \
		echo '$(GREEN)✅ Database reset complete$(NC)'; \
	else \
		echo '$(YELLOW)Aborted$(NC)'; \
	fi

## api: Start API server only
api:
	@echo '$(BLUE)🌐 Starting API server...$(NC)'
	npm run start:api

## sync: Start indexer only (no API)
sync:
	@echo '$(BLUE)🔄 Starting indexer...$(NC)'
	npm run start:prod

## status: Show project status
status:
	@echo '$(BLUE)📊 Project Status$(NC)'
	@echo ''
	@echo '$(BLUE)Git:$(NC)'
	@git status -sb 2>/dev/null || echo '  Not a git repository'
	@echo ''
	@echo '$(BLUE)Last commit:$(NC)'
	@git log -1 --oneline 2>/dev/null || echo '  No commits'
	@echo ''
	@echo '$(BLUE)Dependencies:$(NC)'
	@test -d node_modules && echo '  $(GREEN)✅ Installed$(NC)' || echo '  $(RED)❌ Not installed$(NC)'
	@echo ''
	@echo '$(BLUE)Tests:$(NC)'
	@npm test 2>&1 | tail -3

## ip: Show WSL IP and access URLs
ip:
	@echo '$(BLUE)🌐 Network Access Information$(NC)'
	@echo ''
	@echo '$(BLUE)WSL IP Address:$(NC) ' $$(hostname -I | awk '{print $$1}')
	@echo ''
	@echo '$(BLUE)Access URLs:$(NC)'
	@echo '  Dashboard: $(YELLOW)http://'$$(hostname -I | awk '{print $$1}')':3001/dashboard$(NC)'
	@echo '  API Docs:  $(YELLOW)http://'$$(hostname -I | awk '{print $$1}')':3001/docs$(NC)'
	@echo '  Health:    $(YELLOW)http://'$$(hostname -I | awk '{print $$1}')':3001/health$(NC)'
	@echo ''
	@echo '$(BLUE)Windows Port Forward (run in PowerShell as admin):$(NC)'
	@echo '  netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress='$$(hostname -I | awk '{print $$1}')''
	@echo ''
	@echo '$(BLUE)Then access via:$(NC) $(YELLOW)http://localhost:3001/dashboard$(NC)'
	@echo ''
	@echo '$(BLUE)For more info:$(NC) see WSL_SETUP.md'

## setup: First-time setup (install + up + db-init)
setup: install up db-init
	@echo ''
	@echo '$(GREEN)✨ Setup complete! Run one of:$(NC)'
	@echo '  make dev          # Development mode'
	@echo '  make api          # API server only'
	@echo '  make sync         # Indexer only'
