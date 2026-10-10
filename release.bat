@echo off
setlocal
title Roblox Account Manager - Publish Release
cd /d "%~dp0"

echo ============================================
echo  Roblox Account Manager - Publish Release
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org ^(LTS^) and retry.
  pause
  exit /b 1
)

if "%GH_TOKEN%"=="" (
  echo [ERROR] GH_TOKEN is not set for this window.
  echo.
  echo Create a GitHub token with "repo" scope, then run this in the SAME window first:
  echo     set GH_TOKEN=ghp_your_token_here
  echo and run release.bat again. The token is never stored in the app.
  pause
  exit /b 1
)

set CSC_IDENTITY_AUTO_DISCOVERY=false

echo [1/3] Installing dependencies...
call npm ci
if errorlevel 1 ( echo [ERROR] npm ci failed. & pause & exit /b 1 )

echo.
echo [2/3] Running checks...
call npm run -s lint
if errorlevel 1 ( echo [ERROR] Lint failed. & pause & exit /b 1 )
call npm run -s test:unit
if errorlevel 1 ( echo [ERROR] Unit tests failed. & pause & exit /b 1 )

echo.
echo [3/3] Building and publishing to GitHub Releases...
call npm run release
if errorlevel 1 ( echo [ERROR] Publish failed. See messages above. & pause & exit /b 1 )

echo.
echo Done. A DRAFT release was created on GitHub with the installer, the portable
echo exe, latest.yml and the blockmap. Add your notes there and click Publish:
echo     https://github.com/Sacttt/roblox-account-manager/releases
echo Installed copies pick it up within a few hours (or on next launch).
echo.
pause
