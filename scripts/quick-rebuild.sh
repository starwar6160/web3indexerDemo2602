#!/bin/bash
# 快速重建脚本

echo "⚡ Quick rebuild..."

rm -rf dist
npm run build

echo "✅ Rebuild complete!"
