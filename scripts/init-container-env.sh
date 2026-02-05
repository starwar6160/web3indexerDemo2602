#!/bin/bash
# 容器环境初始化脚本
# 解决 Windows + Docker 跨平台 node_modules 问题

set -e  # 遇到错误立即退出

echo "🔧 Initializing container environment..."
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否在容器中
if [ ! -f /.dockerenv ]; then
    echo -e "${YELLOW}⚠️  Warning: This script is designed to run inside a Docker container${NC}"
    echo "Continue anyway? (y/n)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# 1. 清理旧文件
echo ""
echo "📦 Step 1/4: Cleaning old build artifacts..."
if [ -d "node_modules" ] || [ -f "package-lock.json" ] || [ -d "dist" ]; then
    echo "Removing node_modules, package-lock.json, dist..."
    rm -rf node_modules package-lock.json dist
    echo -e "${GREEN}✅ Cleanup complete${NC}"
else
    echo -e "${GREEN}✅ Already clean${NC}"
fi

# 2. 安装依赖
echo ""
echo "📦 Step 2/4: Installing dependencies (this may take a minute)..."
if npm ci; then
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    echo "Trying alternative method..."
    npm install
fi

# 3. 构建项目
echo ""
echo "🔨 Step 3/4: Building project..."
if npm run build; then
    echo -e "${GREEN}✅ Build complete${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# 4. 验证安装
echo ""
echo "🔍 Step 4/4: Verifying installation..."

# 验证关键依赖
echo "Checking dependencies..."

if node -e "
try {
  const pg = require('pg');
  const viem = require('viem');
  const kysely = require('kysely');
  const pino = require('pino');
  console.log('✅ All dependencies loaded successfully');
  process.exit(0);
} catch (error) {
  console.error('❌ Dependency check failed:', error.message);
  process.exit(1);
}
"; then
    echo -e "${GREEN}✅ All dependencies verified${NC}"
else
    echo -e "${RED}❌ Dependency verification failed${NC}"
    exit 1
fi

# 显示环境信息
echo ""
echo "=========================================="
echo -e "${GREEN}✅ Container environment initialized!${NC}"
echo ""
echo "Environment Info:"
echo "  - Node.js: $(node --version)"
echo "  - npm: $(npm --version)"
echo "  - Platform: $(node -e 'console.log(process.platform)')"
echo "  - Architecture: $(node -e 'console.log(process.arch)')"
echo ""
echo "📦 Key Dependencies:"
echo "  - viem: $(npm list viem --depth=0 2>/dev/null | grep viem | awk '{print $2}')"
echo "  - pg: $(npm list pg --depth=0 2>/dev/null | grep pg | awk '{print $2}')"
echo "  - kysely: $(npm list kysely --depth=0 2>/dev/null | grep kysely | awk '{print $2}')"
echo ""
echo "🚀 You can now run:"
echo "  npm run test:basic     # Run basic tests"
echo "  npm run dev            # Start indexer"
echo "  npm run dev:failfast   # Start fail-fast version"
echo ""
echo "📝 For development workflow:"
echo "  1. Edit code in Windows (VS Code)"
echo "  2. Save files (Ctrl+S)"
echo "  3. In container: npm run build  (if .ts files changed)"
echo "  4. In container: npm run test:basic"
echo ""
