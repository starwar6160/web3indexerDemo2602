#!/bin/bash

while true; do
  clear
  echo "🎯 Web3 Indexer - 交互式测试工具 (容器版)"
  echo "=========================================="
  echo ""
  echo "请选择操作:"
  echo "1) 📊 查看数据库状态"
  echo "2) 💰 发送测试交易"
  echo "3) 📈 实时监控同步状态"
  echo "4) 🧪 快速测试 (3笔交易)"
  echo "5) 🗑️  清空数据库"
  echo "0) 退出"
  echo ""
  read -p "请输入选项 (0-5): " choice

  case $choice in
    1)
      echo ""
      echo "📊 数据库状态:"
      npm run db:status
      echo ""
      read -p "按回车键继续..."
      ;;
    2)
      echo ""
      echo "💰 发送测试交易..."
      RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{
          "jsonrpc":"2.0",
          "method":"eth_sendTransaction",
          "params":[{
            "from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "to":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "value":"0xde0b6b3a7640000",
            "gas":"0x5208"
          }],
          "id":1
        }' \
        http://localhost:58545)

      TX_HASH=$(echo "$RESPONSE" | grep -o '"result":"0x[^"]*"' | cut -d'"' -f4)
      if [ -n "$TX_HASH" ]; then
        echo "✅ 交易已发送: $TX_HASH"
      else
        echo "❌ 发送失败: $RESPONSE"
      fi
      echo ""
      echo "⏳ 等待3秒查看同步结果..."
      sleep 3
      npm run db:status
      echo ""
      read -p "按回车键继续..."
      ;;
    3)
      echo ""
      echo "📈 启动实时监控..."
      bash scripts/container-monitor.sh
      ;;
    4)
      echo ""
      echo "🧪 运行快速测试..."
      bash scripts/container-quick-test.sh
      echo ""
      read -p "按回车键继续..."
      ;;
    5)
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
      echo ""
      read -p "按回车键继续..."
      ;;
    0)
      echo ""
      echo "👋 再见!"
      exit 0
      ;;
    *)
      echo ""
      echo "❌ 无效选项: $choice"
      echo ""
      read -p "按回车键继续..."
      ;;
  esac
done
