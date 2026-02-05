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
  RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    --data "{
      \"jsonrpc\":\"2.0\",
      \"method\":\"eth_sendTransaction\",
      \"params\":[{
        \"from\":\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\",
        \"to\":\"0x70997970C51812dc3A010C7d01b50e0d17dc79C8\",
        \"value\":\"0x$((i * 10))\",
        \"gas\":\"0x5208\"
      }],
      \"id\":$i
    }" \
    http://localhost:58545)

  TX_HASH=$(echo $RESPONSE | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
  echo "  交易 $i: $TX_HASH"
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

# 4. 显示最新日志（从日志文件或监控进程）
echo "🔍 索引器最新日志:"
echo "💡 提示: 在另一个终端运行 'npm run test:monitor' 查看实时日志"

echo ""
echo "✅ 测试完成!"
echo ""
echo "💡 提示: 运行 'npm run test:monitor' 实时监控同步状态"