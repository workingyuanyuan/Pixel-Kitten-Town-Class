# =====================================================================
#  班級像素小鎮 — 啟動程式
# =====================================================================
#  這個檔案由 啟動.bat 呼叫，不需要自己執行。
#
#  為什麼中文訊息放在這裡而不是 .bat：
#    cmd.exe 是邊執行邊按位元組讀取批次檔的，一旦檔案裡混了 UTF-8 中文，
#    goto 跳轉的位移就會算錯，整個腳本會壞掉。PowerShell 沒有這個問題。
# =====================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host '  班級像素小鎮' -ForegroundColor Cyan
Write-Host ''

# --- 找一個可用的 Python -------------------------------------------------
$pyCmd = $null
$pyArgsPrefix = @()

foreach ($candidate in @('python', 'python3')) {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($found) {
        # Windows 市集的假 python 會直接跳到商店頁面，要濾掉
        if ($found.Source -notlike '*WindowsApps*') {
            $pyCmd = $found.Source
            break
        }
    }
}

if (-not $pyCmd) {
    $found = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($found) {
        $pyCmd = $found.Source
        $pyArgsPrefix = @('-3')
    }
}

if (-not $pyCmd) {
    Write-Host '  找不到 Python，無法啟動。' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  請到 https://www.python.org/downloads/ 下載安裝，'
    Write-Host '  安裝時務必勾選「Add Python to PATH」這一項，'
    Write-Host '  裝好之後重新開機，再雙擊 啟動.bat 一次。'
    Write-Host ''
    Read-Host '  按 Enter 關閉'
    exit 1
}

# --- 從 8173 開始找一個沒被佔用的連接埠 ----------------------------------
function Test-PortFree([int]$port) {
    # 【注意】一定要設 ExclusiveAddressUse。
    # Windows 預設允許兩個 socket 綁同一個埠，不設這個旗標的話，
    # 就算連接埠已經有人在用，試綁也會成功，偵測等於沒作用。
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
        $listener.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        try { $listener.Stop() } catch { }
    }
}

$port = 0
foreach ($p in 8173..8200) {
    if (Test-PortFree $p) { $port = $p; break }
}

if ($port -eq 0) {
    Write-Host '  8173 到 8200 的連接埠全都被佔用了。' -ForegroundColor Yellow
    Write-Host '  請關掉一些程式後再試一次。'
    Read-Host '  按 Enter 關閉'
    exit 1
}

$url = "http://localhost:$port/"

# --- 啟動伺服器 ----------------------------------------------------------
# 先啟動、確認真的在聽，才開瀏覽器。順序反過來的話，瀏覽器會比伺服器早一步
# 開啟，使用者看到的就是「無法連上這個網站」。
$serverArgs = $pyArgsPrefix + @('-m', 'http.server', "$port", '--bind', '127.0.0.1')
$server = Start-Process -FilePath $pyCmd -ArgumentList $serverArgs -PassThru -NoNewWindow

$ready = $false
foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 200
    if ($server.HasExited) { break }
    if (-not (Test-PortFree $port)) { $ready = $true; break }
}

if (-not $ready) {
    Write-Host '  伺服器啟動失敗。' -ForegroundColor Yellow
    if (-not $server.HasExited) { $server.Kill() }
    Read-Host '  按 Enter 關閉'
    exit 1
}

Write-Host "  網址：$url" -ForegroundColor Green
Write-Host ''
Write-Host '  ※ 使用完畢請直接關閉這個視窗。'
Write-Host ''

# --- 用 Chrome 或 Edge 開啟 ---------------------------------------------
# 這個程式需要 File System Access API 才能把分數寫回檔案，而該 API 只有
# Chrome 系列支援。直接用預設瀏覽器開的話，萬一預設是 Firefox，
# 「連接資料夾」會完全沒反應且看不出原因。所以這裡明確指定。
$browser = $null
$candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)
foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $browser = $c; break }
}

if ($browser) {
    Write-Host ("  瀏覽器：" + (Split-Path $browser -Leaf))
    Start-Process -FilePath $browser -ArgumentList $url
} else {
    Write-Host ''
    Write-Host '  找不到 Chrome 或 Edge，改用預設瀏覽器開啟。' -ForegroundColor Yellow
    Write-Host '  ※ 若預設瀏覽器不是 Chrome 或 Edge，「連接資料夾」會無法使用，'
    Write-Host '    因為儲存分數所需的功能只有 Chrome 系列支援。'
    Write-Host ''
    Start-Process $url
}

# 這個視窗關掉就等於關掉伺服器
try {
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { $server.Kill() }
}
