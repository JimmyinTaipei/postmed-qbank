"""呼叫本站 Worker 的管理 API（規格書 §7.2-5）。只用標準函式庫。

不用 Cloudflare API token：發佈、備份、用量全部走 /api/admin/*，以管理金鑰（Bearer）驗證。
金鑰存在 Mac 鑰匙圈（scripts/set-secrets.sh 寫入），這裡在執行時讀，不寫進任何檔案。
"""
import json
import time
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request

KEYCHAIN_SERVICE = "postmed-qbank-admin"
KEYCHAIN_ACCOUNT = "postmed-qbank"


class RemoteError(SystemExit):
    pass


def admin_token():
    tok = os.environ.get("PMQ_ADMIN_TOKEN")
    if tok:
        return tok.strip()
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
                             capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        raise RemoteError("鑰匙圈裡找不到管理金鑰（服務名稱 postmed-qbank-admin）。請先照 docs/部署步驟.md 執行 scripts/set-secrets.sh admin。")
    return out.stdout.strip()


class Remote:
    def __init__(self, url, token=None, timeout=120):
        if not url:
            raise RemoteError("沒有網站網址：請在 tools/pmq/pmq.toml 的 [site] url 填上 https://postmed-qbank.<帳號>.workers.dev，或用 --url。")
        self.url = url.rstrip("/")
        self.token = token or admin_token()
        self.timeout = timeout

    def _req(self, method, path, body=None, ctype="application/json", raw=False):
        data = body
        if body is not None and not isinstance(body, (bytes, bytearray)):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.url + path, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("User-Agent", "pmq")
        if data is not None:
            req.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                payload = res.read()
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:500]
            if e.code == 401:
                raise RemoteError(f"管理金鑰不對（401）。鑰匙圈裡的金鑰要與 Worker 的 ADMIN_TOKEN 相同。{msg}")
            if e.code == 503:
                raise RemoteError(f"伺服器還沒設定好（503）：{msg}")
            raise RemoteError(f"{method} {path} 失敗（{e.code}）：{msg}")
        except urllib.error.URLError as e:
            raise RemoteError(f"連不上 {self.url}：{e.reason}")
        return payload if raw else json.loads(payload or b"{}")

    def have(self, keys):
        missing = []
        for i in range(0, len(keys), 2000):
            missing += self._req("POST", "/api/admin/have", {"keys": keys[i:i + 2000]})["missing"]
        return missing

    def put_blob(self, key, data, ctype, tries=5):
        """上傳一個檔。R2 偶爾回 500（例如 10001 internal error）或連線中斷：同一個檔重傳是安全的，等一下再試，最多 tries 次。"""
        path = "/api/admin/blob/" + urllib.parse.quote(key, safe="/")
        for i in range(tries):
            try:
                return self._req("PUT", path, data, ctype=ctype)
            except RemoteError as e:
                msg = str(e)
                transient = "（500）" in msg or "（502）" in msg or "（504）" in msg or "（429）" in msg or msg.startswith("連不上")
                if not transient or i == tries - 1:
                    raise
                time.sleep(2 * (i + 1))

    def put_manifest(self, manifest):
        return self._req("POST", "/api/admin/manifest", json.dumps(manifest, ensure_ascii=False, indent=1).encode("utf-8"))

    def get_manifest(self):
        try:
            return self._req("GET", "/api/admin/manifest")
        except RemoteError as e:
            if "（404）" in str(e):
                return None
            raise

    def usage(self):
        return self._req("GET", "/api/admin/usage")

    def export_zip(self):
        return self._req("GET", "/api/admin/export", raw=True)

    def restore(self, ndjson_bytes):
        return self._req("POST", "/api/admin/restore", ndjson_bytes, ctype="application/x-ndjson")

    def backup_now(self):
        return self._req("POST", "/api/admin/backup", {})

    # 第 5 階段：卡片匯入匯出
    def post_rows(self, rows, mode="insert"):
        return self._req("POST", "/api/admin/rows", {"mode": mode, "rows": rows})

    def get_cards(self):
        return self._req("GET", "/api/admin/cards")

    def get_blob(self, key):
        return self._req("GET", "/api/admin/blob/" + urllib.parse.quote(key, safe="/"), raw=True)
