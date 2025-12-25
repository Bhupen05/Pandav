@echo off
echo ========================================
echo Backend Server Setup
echo ========================================
echo.

cd Backend

echo Installing dependencies...
call npm install
echo.

echo ========================================
echo Creating default users...
echo ========================================
echo.
call node create-users.js
echo.

echo ========================================
echo Starting Backend Server...
echo ========================================
echo.
echo Server will run on http://localhost:5000
echo Keep this window open!
echo.
call npm run dev
