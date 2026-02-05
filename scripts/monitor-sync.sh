#!/bin/bash

echo "🔍 实时监控区块同步状态"
echo "=========================="
echo ""
echo "提示: 按 Ctrl+C 退出监控"
echo ""

while true; do
  clear
  echo "⏰ $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""

  # 获取链上最新区块
  CHAIN_BLOCK=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://localhost:58545 | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

  # 检查数据库中的区块数量
  DB_COUNT=$(psql -U postgres -h db -d web3_indexer -t -c "SELECT COUNT(*) FROM blocks;" 2>/dev/null | tr -d ' ')

  # 获取数据库中最大区块号
  DB_MAX=$(psql -U postgres -h db -d web3_indexer -t -c "SELECT MAX(number) FROM blocks;" 2>/dev/null | tr -d ' ')

  # 转换为十进制显示
  CHAIN_BLOCK_DEC=$((CHAIN_BLOCK))

  echo "📊 区块同步状态:"
  echo "   链上最新区块: $CHAIN_BLOCK_DEC"
  echo "   数据库区块数: $DB_COUNT"
  echo "   数据库最大区块: $DB_MAX"
  echo ""

  # 计算同步进度
  if [ ! -z "$DB_MAX" ] && [ "$DB_MAX" != "null" ]; then
    BEHIND=$((CHAIN_BLOCK_DEC - DB_MAX))
    echo "📈 同步进度:"
    if [ $BEHIND -eq 0 ]; then
      echo "   ✅ 完全同步!"
    else
      echo "   ⏳ 落后 $BEHIND 个区块"
    fi
  else
    echo "⏳ 等待同步开始..."
  fi

  echo ""
  echo "💡 提示: 在宿主机运行 'docker logs web3-indexer-app --tail 20' 查看索引器日志"
  echo ""
  echo "⏳ 5秒后刷新..."
  sleep 5
done
