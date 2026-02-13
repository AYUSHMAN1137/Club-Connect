@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ====================================================
::   CLUB CONNECT - Project Launcher
:: ====================================================

echo.
echo  ============================================
echo     CLUB CONNECT - Project Launcher
echo  ============================================
echo.

:: ---------- Read Supabase (online) DATABASE_URL from .env files ----------
set "ONLINE_DB_URL="

:: Check root .env
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /I "%%A"=="DATABASE_URL" set "ONLINE_DB_URL=%%B"
    )
)

:: Check backend\.env (overrides root if present)
if exist "backend\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
        if /I "%%A"=="DATABASE_URL" set "ONLINE_DB_URL=%%B"
    )
)

:: ---------- Local PostgreSQL Config ----------
set "LOCAL_DB_URL=postgresql://postgres:postgres@localhost:5432/club_connect"

:: ---------- Ask user ----------
echo  Select Database Mode:
echo.
echo    [1] ONLINE  - Supabase Cloud Database (Production)
echo    [2] OFFLINE - Local PostgreSQL Database (Development)
echo.
set /p "DB_CHOICE=  Enter choice (1 or 2, default 2): "
if "%DB_CHOICE%"=="" set DB_CHOICE=2

:: ---------- Set DATABASE_URL based on choice ----------
if "%DB_CHOICE%"=="1" (
    if "!ONLINE_DB_URL!"=="" (
        echo.
        echo  [ERROR] DATABASE_URL not found!
        echo  Set it in .env or backend\.env and try again.
        echo.
        pause
        exit /b 1
    )
    set "DATABASE_URL=!ONLINE_DB_URL!"
    echo.
    echo  [INFO] Mode: ONLINE ^(Supabase Cloud Database^)
) else (
    set "DATABASE_URL=%LOCAL_DB_URL%"
    echo.
    echo  [INFO] Mode: OFFLINE ^(Local PostgreSQL^)
    echo  [INFO] Make sure PostgreSQL is running on localhost:5432
    echo  [INFO] Database: club_connect ^| User: postgres
)

echo.

:: ---------- Sync database schema ----------
echo  [STEP 1/3] Syncing database schema...
cd backend
node migrations/sync-schema.js
if errorlevel 1 (
    echo.
    echo  [WARNING] Schema sync had issues. Server will still try to start.
    echo  If this is a fresh setup, make sure the database exists.
    echo.
)
cd ..

:: ---------- Start backend ----------
echo  [STEP 2/3] Starting Backend Server...
cd backend
start "CLUB CONNECT - Backend" cmd /k "title CLUB CONNECT - Backend && set DATABASE_URL=!DATABASE_URL!&& node server.js"
cd ..
echo  [OK] Backend started on http://localhost:4000

:: ---------- Open frontend ----------
echo  [STEP 3/3] Opening Frontend...
cd frontend
start "" "index.html"
cd ..
echo  [OK] Frontend opened in browser

echo.
echo  ============================================
echo     All systems GO! 
echo  ============================================
echo.
echo  Backend: http://localhost:4000
echo  Close this window anytime.
echo.
pause
