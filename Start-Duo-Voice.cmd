@echo off
title Duo Voice Harness
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Duo-Voice.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup encountered an issue. Review the message above.
  pause
)
