#!/bin/sh
# 在 Mac 上跑一份「本機測試版」的網站：Worker、D1、R2 全部是本機模擬，資料存在 worker/.wrangler/。
# 完全不連 Cloudflare，不會動到正式站或護理站。用法見 docs/本機測試步驟.md。
#
#   scripts/local.sh password   設定本機測試版的登入密碼（只存在 worker/.dev.vars，和正式站無關）
#   scripts/local.sh start      建置 App → 建立本機資料表 → 啟動 http://localhost:8787（按 Ctrl-C 停止）
#   scripts/local.sh publish    把主檔的題庫發佈到本機測試版（另開一個終端機視窗執行）
#   scripts/local.sh pmq …      對本機測試版執行 pmq，例如  scripts/local.sh pmq usage、scripts/local.sh pmq backup now
#   scripts/local.sh reset      刪掉本機測試版的所有資料（作答、題庫內容）；下次 start 從空的開始

set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
VARS="${HERE}/worker/.dev.vars"
PORT=8787

# 本機測試一律不用任何 Cloudflare 憑證
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
ok() { printf '✓ %s\n' "$*"; }

wr() { ( cd "${HERE}/worker" && ./node_modules/.bin/wrangler "$@" ); }

need_tools() {
  [ -x "${HERE}/worker/node_modules/.bin/wrangler" ] || die "還沒安裝：先執行  cd worker && pnpm install && cd .."
  [ -d "${HERE}/app/node_modules" ] || die "還沒安裝：先執行  cd app && pnpm install && cd .."
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${major}" -ge 20 ] || die "Node 版本太舊（$(node -v 2>/dev/null)）。請先 nvm use 22。"
}

admin_token() { grep -E '^ADMIN_TOKEN=' "${VARS}" | head -1 | cut -d= -f2-; }

cmd=${1:-}
case "${cmd}" in
  password)
    echo "→ 設定本機測試版的密碼（輸入兩次，畫面不顯示；至少 12 個字元）"
    hash=$("${HERE}/bin/pmq" auth hash) || die "沒有設定"
    tok=""
    [ -f "${VARS}" ] && tok=$(admin_token || true)
    [ -n "${tok}" ] || tok=$(openssl rand -hex 24)
    umask 077
    printf 'DEV=1\nAUTH_HASH=%s\nADMIN_TOKEN=%s\n' "${hash}" "${tok}" > "${VARS}"
    ok "已存到 worker/.dev.vars。正在執行的本機網站要停掉（Ctrl-C）再 start 一次才會用新密碼。"
    ;;

  start)
    need_tools
    [ -f "${VARS}" ] || die "還沒設定本機密碼：先執行  scripts/local.sh password"
    echo "→ 建置 App"
    ( cd "${HERE}/app" && pnpm run build >/dev/null ) || die "App 建置失敗"
    ok "App 建置完成"
    echo "→ 建立本機資料表"
    wr d1 migrations apply postmed-qbank --local >/dev/null || die "本機資料表建立失敗"
    ok "本機資料表就緒"
    echo
    echo "  本機測試版：http://localhost:${PORT}   （停止：在這個視窗按 Ctrl-C）"
    echo "  第一次用要先在另一個終端機視窗執行  scripts/local.sh publish"
    echo
    wr dev --port "${PORT}" --ip 127.0.0.1
    ;;

  publish|pmq)
    [ -f "${VARS}" ] || die "還沒設定本機密碼：先執行  scripts/local.sh password"
    curl -fs -o /dev/null "http://127.0.0.1:${PORT}/login" || die "本機網站沒有在跑：先在另一個視窗執行  scripts/local.sh start"
    shift
    [ "${cmd}" = publish ] && set -- publish "$@"
    case "$*" in
      "backup pull"*) die "本機測試版不做 backup pull（會把測試資料存進 iCloud 的正式備份資料夾）。要看備份內容，用設定頁的「匯出全部」。" ;;
    esac
    PMQ_URL="http://127.0.0.1:${PORT}" PMQ_ADMIN_TOKEN="$(admin_token)" "${HERE}/bin/pmq" "$@"
    ;;

  reset)
    if pgrep -f "wrangler dev --port ${PORT}" >/dev/null 2>&1; then die "本機網站還在跑，先在那個視窗按 Ctrl-C"; fi
    rm -rf "${HERE}/worker/.wrangler"
    ok "本機測試資料已刪除（密碼設定 worker/.dev.vars 保留）"
    ;;

  *)
    die "用法：scripts/local.sh password｜start｜publish｜pmq …｜reset（說明見 docs/本機測試步驟.md）"
    ;;
esac
