#!/bin/bash

echo "=========================================="
echo "Web3 Indexer Status Monitor"
echo "=========================================="
echo ""

echo "🐳 Docker Container Status:"
echo "-------------------------"
docker ps -a --filter "name=web3-indexer-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "📊 Service Details:"
echo "------------------"

# Check Anvil status
if docker ps --filter "name=web3-indexer-anvil" --filter "status=running" -q | grep -q .; then
    ANVIL_STATUS="✅ Running"
    ANVIL_IP=$(docker inspect web3-indexer-anvil | grep IPAddress | head -1 | cut -d'"' -f4)
    ANVIL_PORT=$(docker port web3-indexer-anvil | grep -oP '\d+$' | head -1)
    echo "🔷 Anvil: $ANVIL_STATUS (IP: $ANVIL_IP, Port: $ANVIL_PORT)"

    # Test Anvil RPC
    if curl -s -f "http://localhost:$ANVIL_PORT" > /dev/null; then
        echo "   🔗 RPC: ✅ Accessible"
    else
        echo "   🔗 RPC: ❌ Not accessible"
    fi
else
    echo "🔷 Anvil: ❌ Not running"
fi

# Check Postgres status
if docker ps --filter "name=web3-indexer-db" --filter "status=running" -q | grep -q .; then
    PG_STATUS="✅ Running"
    PG_PORT=$(docker port web3-indexer-db | grep -oP '\d+$' | head -1)
    echo "🗃️  PostgreSQL: $PG_STATUS (Port: $PG_PORT)"

    # Test Postgres connection
    if docker exec web3-indexer-db pg_isready -U postgres > /dev/null 2>&1; then
        echo "   🔗 Connection: ✅ Ready"
    else
        echo "   🔗 Connection: ❌ Not ready"
    fi
else
    echo "🗃️  PostgreSQL: ❌ Not running"
fi

echo ""
echo "📈 Node.js Indexer Status:"
echo "------------------------"
if pgrep -f "ts-node index.ts" > /dev/null; then
    INDEXER_PID=$(pgrep -f "ts-node index.ts")
    INDEXER_STATUS="✅ Running (PID: $INDEXER_PID)"
    echo "🔹 Indexer: $INDEXER_STATUS"
else
    echo "🔹 Indexer: ❌ Not running"
fi

echo ""
echo "🌐 Network Information:"
echo "---------------------"
echo "Anvil RPC: http://localhost:58545"
echo "Postgres:  localhost:15432"
echo ""

echo "💡 Quick Commands:"
echo "----------------"
echo "Start services:    docker-compose up -d"
echo "Stop services:     docker-compose down"
echo "View logs:         docker-compose logs -f [service]"
echo "Restart service:   docker-compose restart [service]"
echo "Enter container:   docker exec -it web3-indexer-anvil bash"
echo ""

echo "=========================================="