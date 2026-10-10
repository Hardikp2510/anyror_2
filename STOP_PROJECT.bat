@echo off
setlocal
title TitleNode (AnyRoR SaaS Platform) - System Shutdown
color 0C
cd /d "%~dp0"

echo ========================================================================
echo        TITLENODE - GUJARAT ANYROR INTELLIGENCE AND TITLE CLEARANCE
echo                       ONE-CLICK SYSTEM SHUTDOWN
echo ========================================================================
echo.
echo [*] Stopping all Docker containers (Database, Backend, Frontend)...
docker compose down

echo.
echo ========================================================================
echo   [OK] All TitleNode services have been stopped successfully!
echo ========================================================================
echo.
timeout /t 3 >nul
