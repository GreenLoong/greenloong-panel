@echo off
cd /d "%~dp0"
if not exist "%~dp0data\admin-request.json" (
  echo Please apply network settings in the deployment panel first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\privileged.ps1" -Request "%~dp0data\admin-request.json"
if errorlevel 1 (
  echo Network configuration failed. Right-click ApplyNetwork.cmd and Run as administrator.
) else (
  echo Network configuration completed. Check domain resolution in the deployment panel.
)
pause
