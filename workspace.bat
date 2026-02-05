@echo off
REM Windows 批处理脚本 - 进入 workspace 容器执行命令

IF "%1"=="" (
    echo Usage: workspace.bat [command]
    echo Example: workspace.bat bash
    echo Example: workspace.bat npm run db:init
    echo Example: workspace.bat npm run dev
    docker exec -it web3-indexer-workspace /bin/bash
) ELSE (
    docker exec -it web3-indexer-workspace %*
)