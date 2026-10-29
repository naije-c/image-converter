@echo off
setlocal
cd /d "%~dp0"
title JPG to PNG Local Converter

where node >nul 2>&1
if errorlevel 1 goto no_node

if not exist "node_modules\sharp\package.json" goto install_deps
goto start

:install_deps
echo Installing dependencies for first run...
call npm install
if errorlevel 1 goto install_failed

:start
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"
node server.mjs
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Server stopped.
pause
exit /b %EXIT_CODE%

:no_node
echo.
echo Node.js 20 or newer is required.
echo Download: https://nodejs.org/
echo.
pause
exit /b 1

:install_failed
echo.
echo Dependency installation failed. Please check the network and try again.
echo.
pause
exit /b 1
