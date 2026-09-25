@echo off
setlocal
title Roblox Account Manager - Publish Release

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

echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 ( echo [ERROR] npm install failed. & pause & exit /b 1 )

echo.
echo [2/2] Building and publishing to GitHub Releases...
call npm run release
if errorlevel 1 ( echo [ERROR] Publish failed. See messages above. & pause & exit /b 1 )

echo.
echo Done. A DRAFT release was created on GitHub with the installer, latest.yml,
echo and blockmap. Finish it here, add your notes, and click Publish:
echo     https://github.com/Sacttt/roblox-account-manager/releases
echo Installed apps will detect it within a few hours (or on next launch).
echo.
pause
