#!/bin/bash

echo "🎯 Web3 Indexer - 交互式测试工具"
echo "================================"
echo ""
echo "请选择操作:"
echo "1) 📊 查看服务状态"
echo "2) 📊 查看数据库状态"
echo "3) 💰 发送测试交易"
echo "4) 🔍 实时监控索引器日志"
echo "5) 📈 实时监控同步状态"
echo "6) 🧪 运行完整测试 (发送5笔交易)"
echo "7) 🗑️  清空数据库重新开始"
echo "0) 退出"
echo ""
read -p "请输入选项 (0-7): " choice

case $choice in
  1)
    echo ""
    echo "📊 服务状态:"
    echo "💡 在宿主机运行: docker-compose ps"
    echo "   或: docker ps"
    ;;
  2)
    echo ""
    echo "📊 数据库状态:"
    npm run db:status
    ;;
  3)
    echo ""
    echo "💰 发送测试交易..."
    RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
      --data '{
        "jsonrpc":"2.0",
        "method":"eth_sendTransaction",
        "params":[{
          "from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "to":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          "value":"0x10",
          "gas":"0x5208"
        }],
        "id":1
      }' \
      http://localhost:58545)

    TX_HASH=$(echo $RESPONSE | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
    echo "✅ 交易已发送: $TX_HASH"
    echo ""
    echo "⏳ 等待3秒查看同步结果..."
    sleep 3
    npm run db:status
    ;;
  4)
    echo ""
    echo "🔍 实时监控索引器日志:"
    echo "💡 在宿主机运行: docker logs -f web3-indexer-app --tail 20"
    echo "   或在后台终端运行该命令查看实时日志"
    ;;
  5)
    echo ""
    bash scripts/monitor-sync.sh
    ;;
  6)
    echo ""
    echo "🧪 运行完整测试..."
    bash scripts/test-block-sync.sh
    ;;
  7)
    echo ""
    read -p "⚠️  确定要清空数据库吗? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
      echo "🗑️  清空数据库..."
      psql -U postgres -h db -d web3_indexer -c "TRUNCATE TABLE blocks;"
      echo "✅ 数据库已清空"
      echo ""
      echo "💡 提示: 如需重启索引器，在宿主机运行: docker-compose restart indexer"
    else
      echo "❌ 操作已取消"
    fi
    ;;
  0)
    echo ""
    echo "👋 再见!"
    exit 0
    ;;
  *)
    echo ""
    echo "❌ 无效选项: $choice"
    ;;
esac

echo ""
read -p "按回车键继续..."
bash scripts/interactive-test.sh