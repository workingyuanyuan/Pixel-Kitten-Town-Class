"""本機網頁伺服器，由 啟動.bat（tools/start.ps1）呼叫。

跟 `python -m http.server` 一樣，只多做一件事：告訴瀏覽器每次都要回來確認檔案
有沒有更新（Cache-Control: no-cache）。

為什麼需要：內建的伺服器不說要不要快取，瀏覽器就自己猜 —— 檔案越久沒改，
猜它越久不會變，舊的 .js 可能好幾天都直接從快取拿。更新程式之後按重新整理，
就會變成新的 index.html 配上舊的 main.js，畫面缺東缺西卻看不出原因。
加了這一行，沒改過的檔案伺服器回「沒變」（304），一樣很快。

用法：python tools/serve.py <連接埠>
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8173
    server = ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
