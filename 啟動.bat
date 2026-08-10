@echo off
rem ====================================================================
rem  Pixel Town launcher.
rem
rem  This file is intentionally ASCII-only with CRLF line endings.
rem  cmd.exe reads batch files byte by byte while executing them, so any
rem  UTF-8 text or LF-only line ending breaks goto/label seeking and the
rem  script dies. All messages and logic live in tools\start.ps1 instead.
rem ====================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start.ps1"
if errorlevel 1 pause
