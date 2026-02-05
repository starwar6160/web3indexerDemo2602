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
    http://anvil:8545 | grep -o '"result":"0x[^"]*"' | cut -d'"' -f4)

  # 检查数据库中的区块数量
  DB_COUNT=$(psql -U postgres -h db -d web3_indexer -t -c "SELECT COUNT(*) FROM blocks;" 2>/dev/null | tr -d ' ')

  # 获取数据库中最大区块号
  DB_MAX=$(psql -U postgres -h db -d web3_indexer -t -c "SELECT MAX(number) FROM blocks;" 2>/dev/null | tr -d ' ')

  # 转换为十进制显示
  if [ -n "$CHAIN_BLOCK" ]; then
    CHAIN_BLOCK_DEC=$((16#${CHAIN_BLOCK#0x}))
  else
    CHAIN_BLOCK_DEC="N/A"
  fi

  echo "📊 区块同步状态:"
  echo "   链上最新区块: $CHAIN_BLOCK_DEC"
  echo "   数据库区块数: $DB_COUNT"
  echo "   数据库最大区块: $DB_MAX"
  echo ""

  # 计算同步进度
  if [ ! -z "$DB_MAX" ] && [ "$DB_MAX" != "null" ] && [ "$CHAIN_BLOCK_DEC" != "N/A" ]; then
    BEHIND=$((CHAIN_BLOCK_DEC - DB_MAX))
    echo "📈 同步进度:"
    if [ $BEHIND -le 0 ]; then
      echo "   ✅ 完全同步!"
    elif [ $BEHIND -le 2 ]; then
      echo "   🟢 接近同步 (落后 $BEHIND 个区块)"
    elif [ $BEHIND -le 5 ]; then
      echo "   🟡 同步中 (落后 $BEHIND 个区块)"
    else
      echo "   🔴 落后较多 ($BEHIND 个区块)"
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
