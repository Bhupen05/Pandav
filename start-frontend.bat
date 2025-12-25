@echo off
echo ========================================
echo Frontend Application Setup
echo ========================================
echo.

cd Frontend

echo Installing dependencies...
call npm install
echo.

echo ========================================
echo Starting Frontend Application...
echo ========================================
echo.
echo App will run on http://localhost:5173
echo Keep this window open!
echo.
call npm run dev
