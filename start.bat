@echo off
setlocal enabledelayedexpansion
title TitleNode - Starting Application Stack

echo ========================================================
echo       Starting TitleNode (AnyRoR SaaS Platform)
echo ========================================================
echo.

:: Ensure working directory is project root
cd /d "%~dp0"

:: 1. Check if Docker daemon is running
echo [*] Checking Docker status...
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [!] Docker is not currently running.
    echo [*] Attempting to launch Docker Desktop automatically...
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [x] Docker Desktop executable not found in default path.
        echo Please start Docker Desktop manually and run this script again.
        pause
        exit /b 1
    )

    echo [*] Waiting for Docker daemon to become ready...
    :WAIT_DOCKER
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo     Waiting for Docker engine...
        goto WAIT_DOCKER
    )
    echo [OK] Docker daemon is up and ready!
) else (
    echo [OK] Docker is running.
)

echo.
echo [*] Starting containers (PostgreSQL, Backend, Frontend)...
docker compose up -d

if %ERRORLEVEL% neq 0 (
    echo.
    echo [x] Error starting containers. Please check error messages above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [*] Waiting for services to initialize...
timeout /t 4 /nobreak >nul

echo.
echo ========================================================
echo   SUCCESS: TitleNode services are now running!
echo ========================================================
echo.
echo   - Advocate Dashboard : http://localhost:3000/advocate
echo   - Genealogy Flow Tree: http://localhost:3000/advocate/tree/3
echo   - Backend API Docs   : http://localhost:8000/docs
echo   - PostgreSQL Database: localhost:5435
echo.
echo   To stop all services later, double-click: stop.bat
echo ========================================================
echo.
echo [*] Opening TitleNode Advocate Dashboard in your browser...
start http://localhost:3000/advocate

echo.
echo Press any key to close this console (services stay running in background).
pause >nul
