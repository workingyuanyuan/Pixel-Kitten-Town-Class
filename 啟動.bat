@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ====================================================================
rem  班級像素小鎮 — 啟動腳本
rem
rem  這個檔案做三件事：切到專案資料夾、起一個本機小型網頁伺服器、
rem  然後打開瀏覽器。關掉這個黑色視窗就等於關掉伺服器。
rem ====================================================================

cd /d "%~dp0"

rem --- 找一個可用的 Python ---
set PYCMD=
where python >nul 2>nul && set PYCMD=python
if "!PYCMD!"=="" (
  where python3 >nul 2>nul && set PYCMD=python3
)
if "!PYCMD!"=="" (
  where py >nul 2>nul && set PYCMD=py
)

if "!PYCMD!"=="" (
  echo.
  echo  ──────────────────────────────────────────────
  echo   找不到 Python，無法啟動。
  echo.
  echo   請到 https://www.python.org/downloads/ 下載安裝，
  echo   安裝時務必勾選「Add Python to PATH」這一項，
  echo   裝好之後重新開機，再雙擊這個檔案一次。
  echo  ──────────────────────────────────────────────
  echo.
  pause
  exit /b 1
)

rem --- 從 8173 開始找一個沒被佔用的埠 ---
set PORT=8173
:findport
netstat -ano | findstr /r /c:":!PORT! .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  set /a PORT+=1
  if !PORT! GTR 8200 (
    echo 找不到可用的連接埠，請關掉一些程式後再試。
    pause
    exit /b 1
  )
  goto findport
)

echo.
echo   班級像素小鎮啟動中…
echo   網址：http://localhost:!PORT!/
echo.
echo   ※ 使用完畢請直接關閉這個視窗。
echo.

start "" "http://localhost:!PORT!/"
!PYCMD! -m http.server !PORT! --bind 127.0.0.1
