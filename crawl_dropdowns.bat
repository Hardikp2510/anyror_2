@echo off
setlocal enabledelayedexpansion
title AnyRoR Gujarat - Live Dropdown Hierarchy Crawler

echo ====================================================================
echo       AnyRoR Gujarat - Live 4-Dropdown Hierarchy Crawler
echo ====================================================================
echo.
echo [*] Target: https://anyror.gujarat.gov.in/LandRecordRural.aspx
echo [*] Mode:   Headed Chrome (Visible Browser, Anti-Ban Protection)
echo [*] Flow:   Record Type 8 -^> District -^> Taluka -^> Village -^> Survey No.
echo.

:: Ensure working directory is project root
cd /d "%~dp0"

:: Check if PostgreSQL container is running
echo [*] Verifying database connection...
docker ps | findstr anyror_db_fresh >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [!] Database container 'anyror_db_fresh' is not running!
    echo [*] Starting database container now...
    docker compose up -d db
    timeout /t 3 /nobreak >nul
)

echo.
echo ====================================================================
echo Select Crawl Scope:
echo   1. Crawl Kutch District [01] only
echo   2. Crawl Ahmedabad District [07] only
echo   3. Crawl a Custom District Code
echo   4. Crawl ALL 34 Gujarat Districts [Full State Scrape]
echo   5. Fast Mode: Crawl all Districts, Talukas and Villages [Skip Surveys]
echo ====================================================================
echo.
set CHOICE=1
set /p CHOICE="Enter your choice 1-5 [default: 1]: "

echo.
echo [*] Proxy Configuration [Optional]:
echo     - If using VPN or Mobile Hotspot, leave blank and press ENTER.
echo     - If using an HTTP or SOCKS5 proxy, type it below:
set PROXY_INPUT=
set /p PROXY_INPUT="Proxy URL [press ENTER for direct]: "

set PROXY_ARG=
if defined PROXY_INPUT (
    set PROXY_ARG=--proxy "%PROXY_INPUT%"
)

if "%CHOICE%"=="1" goto DO_KUTCH
if "%CHOICE%"=="2" goto DO_AHMEDABAD
if "%CHOICE%"=="3" goto DO_CUSTOM
if "%CHOICE%"=="4" goto DO_ALL
if "%CHOICE%"=="5" goto DO_FAST

:DO_KUTCH
echo.
echo [*] Starting crawl for District 01 [Kutch]...
python backend\scripts\crawl_dropdowns_headed.py --district 01 %PROXY_ARG%
goto END

:DO_AHMEDABAD
echo.
echo [*] Starting crawl for District 07 [Ahmedabad]...
python backend\scripts\crawl_dropdowns_headed.py --district 07 %PROXY_ARG%
goto END

:DO_CUSTOM
set CUST_DIST=01
set /p CUST_DIST="Enter 2-digit District Code (e.g. 02, 14, 22): "
echo.
echo [*] Starting crawl for District %CUST_DIST%...
python backend\scripts\crawl_dropdowns_headed.py --district %CUST_DIST% %PROXY_ARG%
goto END

:DO_ALL
echo.
echo [*] Starting FULL STATE CRAWL for all 34 Districts...
python backend\scripts\crawl_dropdowns_headed.py %PROXY_ARG%
goto END

:DO_FAST
echo.
echo [*] Starting FAST CRAWL (Districts, Talukas and Villages without surveys)...
python backend\scripts\crawl_dropdowns_headed.py --no-surveys %PROXY_ARG%
goto END

:END
echo.
echo ====================================================================
echo Crawl finished. Check database or frontend to view records.
echo ====================================================================
pause
