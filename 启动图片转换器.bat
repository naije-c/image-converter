@echo off
chcp 65001 >nul
cd /d "%~dp0"
title JPG to PNG - 本地图片转换器

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未找到 Node.js，请先安装 Node.js 20 或更高版本。
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\sharp" (
  echo 首次运行，正在安装图片处理依赖...
  call npm install
  if errorlevel 1 (
    echo.
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

set OPEN_BROWSER=1
node server.mjs
echo.
echo 本地转换器已停止。
pause
