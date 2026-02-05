#!/bin/bash

echo "🧪 快速测试: 发送3笔交易并查看同步结果"
echo "=============================================="
echo ""

# 1. 查看初始状态
echo "📊 初始状态:"
npm run db:status
echo ""

# 2. 发送3笔交易
echo "💰 发送3笔测试交易..."
for i in {1..3}; do
  echo -n "  交易 $i: "

  RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    --data "{
      \"jsonrpc\":\"2.0\",
      \"method\":\"eth_sendTransaction\",
      \"params\":[{
        \"from\":\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\",
        \"to\":\"0x70997970C51812dc3A010C7d01b50e0d17dc79C8\",
        \"value\":\"0xde0b6b3a7640000\",
        \"gas\":\"0x5208\"
      }],
      \"id\":$i
    }" \
    http://anvil:8545)

  # 检查是否有错误
  if echo "$RESPONSE" | grep -q '"error"'; then
    echo "❌ 错误: $RESPONSE"
  else
    TX_HASH=$(echo "$RESPONSE" | grep -o '"result":"0x[^"]*"' | cut -d'"' -f4)
    if [ -n "$TX_HASH" ]; then
      echo "✅ $TX_HASH"
    else
      echo "⚠️  未知响应: $RESPONSE"
    fi
  fi
  sleep 1
done

echo ""
echo "⏳ 等待5秒让索引器同步..."
sleep 5

# 3. 查看同步结果
echo ""
echo "📊 同步后状态:"
npm run db:status
echo ""

# 4. 显示提示
echo "💡 提示:"
echo "   - 在宿主机运行 'docker logs web3-indexer-app --tail 20' 查看索引器日志"
echo "   - 运行 'npm run test:monitor' 实时监控同步状态"
echo ""
echo "✅ 测试完成!"
