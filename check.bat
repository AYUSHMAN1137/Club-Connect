@echo off
echo === JavaScript Syntax Check (node --check) ===
echo.

echo data-store.js
node --check "C:\Users\ayush_lr8ru2y\Desktop\Club Connect\frontend\data-store.js"
if %errorlevel% equ 0 (echo PASS) else (echo FAIL)
echo.

echo sync-engine.js
node --check "C:\Users\ayush_lr8ru2y\Desktop\Club Connect\frontend\sync-engine.js"
if %errorlevel% equ 0 (echo PASS) else (echo FAIL)
echo.

echo service-worker.js
node --check "C:\Users\ayush_lr8ru2y\Desktop\Club Connect\frontend\service-worker.js"
if %errorlevel% equ 0 (echo PASS) else (echo FAIL)
echo.

echo member-dashboard.js
node --check "C:\Users\ayush_lr8ru2y\Desktop\Club Connect\frontend\member-dashboard.js"
if %errorlevel% equ 0 (echo PASS) else (echo FAIL)
echo.

echo owner-dashboard.js
node --check "C:\Users\ayush_lr8ru2y\Desktop\Club Connect\frontend\owner-dashboard.js"
if %errorlevel% equ 0 (echo PASS) else (echo FAIL)
echo.
