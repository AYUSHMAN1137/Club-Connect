@echo off
echo Starting Backend Server...
cd backend
start cmd /k "node server.js"
echo Backend started on port 4000.
echo Opening Frontend...
cd ..\frontend
start index.html
echo Done!
pause
