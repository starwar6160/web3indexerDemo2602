#!/bin/bash

echo "🚀 Testing Anvil auto block generation..."
echo "Sending test transaction to trigger block creation..."

# 发送一个简单交易触发新区块
RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  --data '{
    "jsonrpc":"2.0",
    "method":"eth_sendTransaction",
    "params":[{
      "from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "to":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "value":"0x64",
      "gas":"0x5208"
    }],
    "id":1
  }' \
  http://localhost:58545)

echo "Transaction response: $RESPONSE"

# 等待1秒让区块被索引器捕获
sleep 1

echo "👀 Check indexer output for block number changes..."
echo "💡 You can also run: bash logs.sh indexer to see the latest logs"