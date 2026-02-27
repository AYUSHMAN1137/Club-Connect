@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set MSG=deploy

git status --porcelain >nul 2>nul
if errorlevel 1 (
  echo Git not available or not a repo.
  exit /b 1
)

git add .
git commit -m "%MSG%"
if errorlevel 1 (
  echo Nothing to commit or commit failed.
)

git push
if errorlevel 1 (
  echo Push failed.
  exit /b 1
)

echo Done.
endlocal
