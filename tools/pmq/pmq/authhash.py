"""pmq auth hash：把密碼轉成 Worker 的 AUTH_HASH（規格書 §10：PBKDF2-SHA256、100,000 次、16 位元組鹽）。

密碼從終端機讀（不顯示、不存檔）；只把雜湊印到標準輸出，scripts/set-secrets.sh 直接把它接給 wrangler secret put。
"""
import base64
import getpass
import hashlib
import os
import sys
import unicodedata

ITERATIONS = 100_000


def make_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", unicodedata.normalize("NFC", password).encode("utf-8"), salt, ITERATIONS, 32)
    return f"pbkdf2_sha256${ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def main(min_len: int = 12):
    prompt = "新密碼（建議 4 個以上的詞組成的長密語）：" if min_len >= 12 else "本機測試版的密碼（長度不限）："
    pw = getpass.getpass(prompt, stream=sys.stderr)
    if len(pw) < min_len:
        print("沒有輸入密碼。" if min_len <= 1 else f"太短了：至少 {min_len} 個字元。", file=sys.stderr)
        return 1
    if getpass.getpass("再輸入一次：", stream=sys.stderr) != pw:
        print("兩次不一樣。", file=sys.stderr)
        return 1
    print(make_hash(pw))
    return 0
