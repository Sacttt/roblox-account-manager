@echo off
setlocal
title Roblox Account Manager - Build

echo ============================================
echo  Roblox Account Manager - Build Script
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on this computer.
  echo Please install it from https://nodejs.org ^(LTS version^) then run this file again.
  pause
  exit /b 1
)

echo [1/3] Installing dependencies ^(first run only takes a few minutes^)...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo [2/3] Building the Windows app...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo [3/3] Done!
echo Your updated app is in the "dist" folder ^(look for the .exe file^).
echo You can re-run this file any time you change the code to get a fresh build.
echo.
pause
