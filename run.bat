@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto missing_node

where npm >nul 2>nul
if errorlevel 1 goto missing_npm

if not exist "node_modules\vite\bin\vite.js" (
    echo Installing project dependencies...
    call npm install
    if errorlevel 1 goto failed_install
)

call npm run dev -- --open
if errorlevel 1 goto failed_start
exit /b 0

:missing_node
echo Node.js 20.19.x or 22.12+ is required by Vite. Install a supported version and try again.
pause
exit /b 1

:missing_npm
echo npm is required. Reinstall Node.js with npm, then try again.
pause
exit /b 1

:failed_install
echo Dependency installation failed.
pause
exit /b 1

:failed_start
echo The development server stopped with an error.
pause
exit /b 1
