#!/bin/bash

case "$1" in
    anvil)
        echo "🔷 Anvil Logs (last 50 lines):"
        echo "================================"
        docker logs --tail 50 web3-indexer-anvil
        ;;
    postgres)
        echo "🗃️  PostgreSQL Logs (last 50 lines):"
        echo "===================================="
        docker logs --tail 50 web3-indexer-db
        ;;
    indexer)
        echo "🔹 Indexer Logs (last 50 lines):"
        echo "================================="
        if pgrep -f "ts-node index.ts" > /dev/null; then
            if [ -f "/c/Users/$USER/AppData/Roaming/npm-cache/_logs/*.log" ]; then
                find "/c/Users/$USER/AppData/Roaming/npm-cache/_logs/" -name "*.log" -type f -exec tail -50 {} \;
            else
                echo "Indexer logs not found. Try running: npm run dev"
            fi
        else
            echo "Indexer is not running. Start it with: npm run dev"
        fi
        ;;
    follow)
        echo "🔄 Following logs (press Ctrl+C to stop):"
        echo "=========================================="
        case "$2" in
            anvil)
                docker logs -f web3-indexer-anvil
                ;;
            postgres)
                docker logs -f web3-indexer-db
                ;;
            indexer)
                echo "Indexer logs cannot be followed with this script. Use: npm run dev"
                ;;
            *)
                echo "Usage: $0 follow [anvil|postgres]"
                exit 1
                ;;
        esac
        ;;
    *)
        echo "Usage: $0 {anvil|postgres|indexer|follow [service]}"
        echo ""
        echo "Examples:"
        echo "  $0 anvil        # Show last 50 lines of Anvil logs"
        echo "  $0 postgres     # Show last 50 lines of PostgreSQL logs"
        echo "  $0 indexer      # Show last 50 lines of indexer logs"
        echo "  $0 follow anvil # Follow Anvil logs in real-time"
        echo "  $0 follow postgres # Follow PostgreSQL logs in real-time"
        exit 1
        ;;
esac