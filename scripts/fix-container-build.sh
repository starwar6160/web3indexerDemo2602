#!/bin/bash
# Fix container build issues by cleaning and rebuilding

set -e

echo "🔧 Fixing container build issues..."

echo "📦 Cleaning node_modules and dist..."
rm -rf node_modules dist package-lock.json

echo "📥 Installing dependencies..."
npm ci

echo "🔨 Building project..."
npm run build

echo "✅ Build fixed!"
echo ""
echo "You can now run tests:"
echo "  npm run test:all"
