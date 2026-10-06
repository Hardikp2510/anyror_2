@echo off
title TitleNode - Stopping Application Stack

echo ========================================================
echo       Stopping TitleNode (AnyRoR SaaS Platform)
echo ========================================================
echo.

cd /d "%~dp0"

echo [*] Shutting down containers...
docker compose down

echo.
echo ========================================================
echo   All TitleNode services have stopped successfully.
echo ========================================================
echo.
pause
