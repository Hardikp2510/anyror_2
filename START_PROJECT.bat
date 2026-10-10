@echo off
setlocal enabledelayedexpansion
title TitleNode (AnyRoR SaaS Platform) - System Launcher
color 0B

:: Ensure current working directory is the repository root
cd /d "%~dp0"

echo ========================================================================
echo        TITLENODE - GUJARAT ANYROR INTELLIGENCE AND TITLE CLEARANCE
echo                       ONE-CLICK SYSTEM LAUNCHER
echo ========================================================================
echo.

:: 1. Verify / Create required output directories
if not exist "backend\output" mkdir "backend\output" >nul 2>&1
if not exist "backend\storage" mkdir "backend\storage" >nul 2>&1

:: 2. Check if Docker daemon is running
echo [1/4] Checking Docker engine status...
docker info >nul 2>&1
if %ERRORLEVEL% equ 0 goto DOCKER_READY

echo.
echo [!] Docker is not currently running.
echo [*] Searching for Docker Desktop installation...

set "DOCKER_EXE="
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    set "DOCKER_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe"
)
if not defined DOCKER_EXE if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)
if not defined DOCKER_EXE if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" (
    set "DOCKER_EXE=%LOCALAPPDATA%\Docker\Docker Desktop.exe"
)

if not defined DOCKER_EXE goto DOCKER_NOT_FOUND

echo [*] Auto-starting Docker Desktop: "!DOCKER_EXE!"
start "" "!DOCKER_EXE!"
echo [*] Waiting for Docker daemon to initialize...

set /a ATTEMPTS=0
:WAIT_DOCKER_LOOP
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo [OK] Docker daemon is up and ready!
    goto DOCKER_READY
)
set /a ATTEMPTS+=1
echo     Waiting for Docker engine... (!ATTEMPTS!/30)
if !ATTEMPTS! lss 30 goto WAIT_DOCKER_LOOP

echo.
echo [x] Docker engine took too long to start.
echo Please ensure Docker Desktop is running and try again.
pause
exit /b 1

:DOCKER_NOT_FOUND
echo [x] Docker Desktop executable not found in standard directories.
echo Please start Docker Desktop manually and run this script again.
pause
exit /b 1

:DOCKER_READY
echo [OK] Docker daemon is running.
echo.

:: 3. Launch Docker containers
echo [2/4] Starting TitleNode containers: PostgreSQL 16, Backend, Frontend...
docker compose up -d

if %ERRORLEVEL% neq 0 (
    echo.
    echo [x] Failed to start Docker containers. Check the errors above.
    pause
    exit /b %ERRORLEVEL%
)

:: 4. Verify Backend & Frontend Health
echo.
echo [3/4] Verifying services health...
echo [*] Waiting for services to initialize...

powershell -NoProfile -Command "for ($i = 0; $i -lt 15; $i++) { try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 0" >nul 2>&1

echo [OK] All services are healthy and responsive!
echo.

:: 5. Open Browser directly to Advocate Dashboard
echo [4/4] Launching Advocate Portal in default web browser...
start http://localhost:3000/advocate

echo.
echo ========================================================================
echo        SUCCESS: TITLENODE FULL STACK IS NOW RUNNING!
echo ========================================================================
echo.
echo   * Advocate Portal      : http://localhost:3000/advocate
echo   * Pedhinamu Family Tree: http://localhost:3000/advocate/tree/3
echo   * Backend REST API Docs: http://localhost:8000/docs
echo   * PostgreSQL Database  : localhost:5435
echo.
echo ========================================================================
echo   CONTROLS AND SHORTCUTS:
echo ========================================================================

:MENU_LOOP
echo.
echo   [1] Re-open Advocate Dashboard in Browser
echo   [2] Re-open Pedhinamu Genealogy Tree in Browser
echo   [3] Open Backend API Swagger Docs in Browser
echo   [4] View Live Container Logs
echo   [5] Create Windows Desktop Shortcut on Desktop
echo   [6] Stop All Services (docker compose down)
echo   [7] Exit this window (Services continue running in background)
echo.
set "USER_CHOICE="
set /p USER_CHOICE="Select an option [1-7] (or press Enter to exit): "

if "%USER_CHOICE%"=="1" goto OPEN_DASHBOARD
if "%USER_CHOICE%"=="2" goto OPEN_TREE
if "%USER_CHOICE%"=="3" goto OPEN_DOCS
if "%USER_CHOICE%"=="4" goto VIEW_LOGS
if "%USER_CHOICE%"=="5" goto CREATE_SHORTCUT
if "%USER_CHOICE%"=="6" goto STOP_SERVICES
if "%USER_CHOICE%"=="7" goto EXIT_SCRIPT
if "%USER_CHOICE%"=="" goto EXIT_SCRIPT

echo Invalid selection. Please choose 1 to 7.
goto MENU_LOOP

:OPEN_DASHBOARD
start http://localhost:3000/advocate
goto MENU_LOOP

:OPEN_TREE
start http://localhost:3000/advocate/tree/3
goto MENU_LOOP

:OPEN_DOCS
start http://localhost:8000/docs
goto MENU_LOOP

:VIEW_LOGS
echo [*] Streaming live logs. Press Ctrl+C to return to menu.
docker compose logs -f
goto MENU_LOOP

:CREATE_SHORTCUT
echo [*] Creating Desktop Shortcut...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'TitleNode AnyRoR.lnk')); $s.TargetPath = '%~dp0START_PROJECT.bat'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Start TitleNode AnyRoR SaaS Platform'; $s.Save()"
echo [OK] Shortcut created on Desktop: TitleNode AnyRoR.lnk
goto MENU_LOOP

:STOP_SERVICES
echo.
echo [*] Stopping TitleNode containers...
docker compose down
echo [OK] All services have been stopped.
timeout /t 3 >nul
exit /b 0

:EXIT_SCRIPT
echo Services are running in background. Goodbye!
exit /b 0
