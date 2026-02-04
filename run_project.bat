@echo off
setlocal
set DB_CHOICE=
set ONLINE_DB_URL=
if not "%DATABASE_URL%"=="" set ONLINE_DB_URL=%DATABASE_URL%
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /I "%%A"=="DATABASE_URL" set ONLINE_DB_URL=%%B
  )
)
if exist "backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
    if /I "%%A"=="DATABASE_URL" set ONLINE_DB_URL=%%B
  )
)
echo Select database mode:
echo 1. Online
echo 2. Local
set /p DB_CHOICE=Enter choice (default 1): 
if "%DB_CHOICE%"=="" set DB_CHOICE=1
if "%DB_CHOICE%"=="2" (
  set DATABASE_URL=
) else (
  set DATABASE_URL=%ONLINE_DB_URL%
)
if "%DB_CHOICE%"=="1" if "%DATABASE_URL%"=="" (
  echo DATABASE_URL not found. Set it in .env or backend\.env, then run again.
  pause
  exit /b 1
)
echo Starting Backend Server...
cd backend
start cmd /k "set DATABASE_URL=%DATABASE_URL%&& node server.js"
echo Backend started on port 4000.
echo Opening Frontend...
cd ..\frontend
start index.html
echo Done!
pause
