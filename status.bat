@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==========================================
echo Web3 Indexer Status Monitor
echo ==========================================
echo.

echo 🐳 Docker Container Status:
echo -------------------------
docker ps -a --filter "name=web3-indexer-" --format "table {{.Names}}^t{{.Status}}^t{{.Ports}}"

echo.
echo 📊 Service Details:
echo ------------------

:: Check Anvil status
docker ps --filter "name=web3-indexer-anvil" --filter "status=running" -q >anvil_running.txt
findstr /c:"." anvil_running.txt >nul
if !errorlevel! equ 0 (
    set ANVIL_STATUS=✅ Running
    for /f "tokens=*" %%a in ('docker inspect web3-indexer-anvil ^| find "IPAddress"') do (
        for /f "tokens=4 delims== " %%b in ("%%a") do set ANVIL_IP=%%~b
    )
    set ANVIL_IP=%ANVIL_IP:"=%
    for /f "tokens=3 delims=:" %%a in ('docker port web3-indexer-anvil') do set ANVIL_PORT=%%a
    echo 🔷 Anvil: !ANVIL_STATUS! (IP: !ANVIL_IP!, Port: !ANVIL_PORT!)

    :: Test Anvil RPC
    curl -s -f "http://localhost:!ANVIL_PORT!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo    🔗 RPC: ✅ Accessible
    ) else (
        echo    🔗 RPC: ❌ Not accessible
    )
) else (
    echo 🔷 Anvil: ❌ Not running
)

:: Check Postgres status
docker ps --filter "name=web3-indexer-db" --filter "status=running" -q >postgres_running.txt
findstr /c:"." postgres_running.txt >nul
if !errorlevel! equ 0 (
    set PG_STATUS=✅ Running
    for /f "tokens=3 delims=:" %%a in ('docker port web3-indexer-db') do set PG_PORT=%%a
    echo 🗃^  PostgreSQL: !PG_STATUS! (Port: !PG_PORT!)

    :: Test Postgres connection
    docker exec web3-indexer-db pg_isready -U postgres >nul 2>&1
    if !errorlevel! equ 0 (
        echo    🔗 Connection: ✅ Ready
    ) else (
        echo    🔗 Connection: ❌ Not ready
    )
) else (
    echo 🗃^  PostgreSQL: ❌ Not running
)

del anvil_running.txt postgres_running.txt >nul 2>&1

echo.
echo 📈 Node.js Indexer Status:
echo ------------------------
:: Check if indexer is running (look for ts-node process)
tasklist /fi "imagename eq node.exe" /fo csv | findstr "ts-node index.ts" >indexer_check.txt
findstr /c:"." indexer_check.txt >nul
if !errorlevel! equ 0 (
    for /f "tokens=2 delims=," %%a in ('tasklist /fi "imagename eq node.exe" /fo csv ^| findstr "ts-node"') do (
        set INDEXER_PID=%%~a
        set INDEXER_PID=!INDEXER_PID:"=!
    )
    set INDEXER_STATUS=✅ Running ^(PID: !INDEXER_PID!^)
    echo 🔹 Indexer: !INDEXER_STATUS!
) else (
    echo 🔹 Indexer: ❌ Not running
)

del indexer_check.txt >nul 2>&1

echo.
echo 🌐 Network Information:
echo ---------------------
echo Anvil RPC: http://localhost:58545
echo Postgres:  localhost:15432
echo.

echo 💡 Quick Commands:
echo ----------------
echo Start services:    docker-compose up -d
echo Stop services:     docker-compose down
echo View logs:         docker-compose logs -f [service]
echo Restart service:   docker-compose restart [service]
echo Enter container:   docker exec -it web3-indexer-anvil bash
echo.

echo ==========================================
pause