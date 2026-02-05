#!/bin/bash
# 容器环境初始化脚本

set -e

echo "🔧 Initializing container environment..."

# 清理
echo "Cleaning..."
rm -rf node_modules package-lock.json dist

# 安装依赖
echo "Installing dependencies..."
npm install

# 构建
echo "Building..."
npm run build

echo ""
echo "✅ Complete! Run: node tests/simple-db-test.js"
