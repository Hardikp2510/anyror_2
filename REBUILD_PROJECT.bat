@echo off
setlocal enabledelayedexpansion
title TitleNode (AnyRoR SaaS Platform) - Rebuild & Start
color 0E
cd /d "%~dp0"

echo ========================================================================
echo        TITLENODE - GUJARAT ANYROR INTELLIGENCE AND TITLE CLEARANCE
echo                       REBUILD AND START LAUNCHER
echo ========================================================================
echo.
echo [*] Rebuilding and starting containers with latest code...
docker compose up -d --build

if %ERRORLEVEL% neq 0 (
    echo.
    echo [x] Build failed. Please review the errors above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [*] Waiting for services to become ready...
timeout /t 5 /nobreak >nul

echo [*] Launching Advocate Portal in browser...
start http://localhost:3000/advocate

echo.
echo [OK] Rebuild complete and services are active!
timeout /t 4 >nul
