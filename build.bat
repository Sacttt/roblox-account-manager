@echo off
setlocal enableextensions
title Roblox Account Manager - Build
cd /d "%~dp0"

echo ============================================
echo  Roblox Account Manager - Build
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on this computer.
  echo Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

REM Unsigned local build: don't look for a code-signing certificate.
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo [1/3] Installing dependencies (the first run takes a few minutes)...
if exist package-lock.json (call npm ci) else (call npm install)
if errorlevel 1 (
  echo [ERROR] Installing dependencies failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo [2/3] Running checks...
call npm run -s lint
if errorlevel 1 (
  echo [ERROR] Lint failed. See the messages above.
  pause
  exit /b 1
)
call npm run -s test:unit
if errorlevel 1 (
  echo [ERROR] Unit tests failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo [3/3] Building the installer and the portable app...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] The build failed. See the messages above.
  echo.
  echo If you see "Cannot create symbolic link : A required privilege is not held":
  echo   turn on Windows Developer Mode ^(Settings ^> System ^> For developers^)
  echo   or right-click build.bat and choose "Run as administrator", then try again.
  pause
  exit /b 1
)

echo.
echo Done! Your files are in the "dist" folder:
echo   RobloxAccountManager-Setup-^<version^>.exe     installer (recommended)
echo   RobloxAccountManager-Portable-^<version^>.exe  portable, no install needed
echo.
pause
