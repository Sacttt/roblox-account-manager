@echo off
setlocal enableextensions
title Roblox Account Manager - Build

REM ============================================================
REM  Self-elevate to Administrator.
REM  electron-builder unpacks a "winCodeSign" package that
REM  contains symbolic links. Creating symlinks on Windows needs
REM  a privilege normal users don't have, which causes:
REM    "Cannot create symbolic link : A required privilege is not held"
REM  Running elevated (as admin) grants that privilege and fixes it.
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator permissions ^(needed to build^)...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

REM After elevation the shell starts in System32, so go back to this folder.
cd /d "%~dp0"

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

REM This is an unsigned local build: don't try to auto-discover a signing certificate.
set CSC_IDENTITY_AUTO_DISCOVERY=false

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
  echo.
  echo If you see "Cannot create symbolic link":
  echo   - Make sure you ran this file as Administrator ^(right-click ^> Run as administrator^), or
  echo   - Turn on Windows Developer Mode: Settings ^> Privacy ^& security ^> For developers.
  pause
  exit /b 1
)

echo.
echo [3/3] Done!
echo Your updated app is in the "dist" folder ^(look for the .exe file^).
echo You can re-run this file any time you change the code to get a fresh build.
echo.
pause
