#!/bin/bash
# Linux/Mac 脚本 - 进入 workspace 容器执行命令

if [ -z "$1" ]; then
    echo "Usage: ./workspace.sh [command]"
    echo "Example: ./workspace.sh bash"
    echo "Example: ./workspace.sh npm run db:init"
    echo "Example: ./workspace.sh npm run dev"
    docker exec -it web3-indexer-workspace /bin/bash
else
    docker exec -it web3-indexer-workspace "$@"
fi