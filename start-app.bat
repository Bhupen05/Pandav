@echo off
echo ========================================
echo Starting Pandav Application
echo ========================================
echo.

echo Checking if MongoDB is running...
echo Please ensure MongoDB is started before continuing.
echo.
pause

echo.
echo ========================================
echo Step 1: Starting Backend Server
echo ========================================
cd Backend
start "Pandav Backend" cmd /k "npm install && npm run dev"
timeout /t 5

echo.
echo ========================================
echo Step 2: Starting Frontend Application
echo ========================================
cd ..\Frontend
start "Pandav Frontend" cmd /k "npm install && npm run dev"

echo.
echo ========================================
echo Pandav Application is starting...
echo ========================================
echo.
echo Backend: http://localhost:5000
echo Frontend: http://localhost:5173
echo.
echo Two new terminal windows have been opened.
echo Check them for any errors.
echo.
echo Press any key to exit this window...
pause > nul
