#!/bin/bash

echo "🚀 Web3 Indexer - 区块生成与同步实时监控脚本"
echo "================================================"
echo ""

# 检查服务状态
echo "📊 检查服务状态..."
docker-compose ps
echo ""

# 检查数据库状态
echo "📊 检查数据库状态..."
npm run db:status
echo ""

# 获取当前链上区块号
echo "📊 获取当前链上区块号..."
CURRENT_BLOCK=$(curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://localhost:58545 | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

echo "当前链上区块号: $((CURRENT_BLOCK))"
echo ""

# 发送测试交易触发区块生成
echo "💰 发送测试交易触发区块生成..."
for i in {1..5}; do
  echo "发送交易 $i..."
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
  echo "✅ 交易已发送: $TX_HASH"

  sleep 1
done

echo ""
echo "⏳ 等待区块被索引器捕获..."
sleep 3

# 再次检查数据库状态
echo "📊 交易后数据库状态..."
npm run db:status
echo ""

# 实时监控索引器日志
echo "🔍 实时监控索引器日志 (按 Ctrl+C 退出)..."
echo "================================================"
docker logs -f web3-indexer-app --tail 20