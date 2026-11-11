#!/bin/sh
# postmed-qbank 唯一的部署入口（規格書 §11-3、§11-8）。由使用者本人執行；實作模型不執行、不持有任何 Cloudflare 憑證。
#
#   scripts/deploy.sh login              登入 Cloudflare（開瀏覽器授權；憑證由 wrangler 存在你的 Mac）
#   scripts/deploy.sh check              只做名稱與設定檢查（不連 Cloudflare）
#   scripts/deploy.sh inventory          列出帳號裡的 D1、R2（唯讀），存到 reports/ 供動工前後比對
#   scripts/deploy.sh init               第一次：建立 D1 與 R2（名稱固定 postmed-qbank），把 database_id 寫進 wrangler.toml
#   scripts/deploy.sh                    建置 App → 套用 D1 migrations → 部署 Worker（預設動作）
#   scripts/deploy.sh secret password    設定登入密碼（只上傳 PBKDF2 雜湊）
#   scripts/deploy.sh secret admin       產生管理金鑰：存進 Mac 鑰匙圈，並設定到 Worker（不顯示在畫面上）
#   scripts/deploy.sh status             列出最近幾次部署（唯讀）
#   scripts/deploy.sh rollback           把 Worker 程式退回上一版（D1 資料不受影響）
#   scripts/deploy.sh d1-restore <時間>  把 D1 還原到某個時間點（D1 Time Travel，30 天內）
#
# 每個會寫入 Cloudflare 的動作之前都先跑 check：wrangler.toml 的 name、database_name、bucket_name
# 必須都是 postmed-qbank，且不得有 routes／網域設定，否則中止。

set -eu
NAME=postmed-qbank
HERE=$(cd "$(dirname "$0")/.." && pwd)
TOML="${HERE}/worker/wrangler.toml"
PLACEHOLDER=00000000-0000-0000-0000-000000000000

die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
ok() { printf '✓ %s\n' "$*"; }

wr() {
  # 一律用專案裡固定版本的 wrangler，一律指定這個設定檔
  ( cd "${HERE}/worker" && ./node_modules/.bin/wrangler "$@" --config "${TOML}" )
}

value() { # 讀 wrangler.toml 裡某個鍵的字串值（全部出現的都列出）
  grep -E "^[[:space:]]*$1[[:space:]]*=" "${TOML}" | sed -E 's/^[^=]*=[[:space:]]*"([^"]*)".*/\1/'
}

check() {
  [ -f "${TOML}" ] || die "找不到 ${TOML}"
  n=$(value name); [ "${n}" = "${NAME}" ] || die "wrangler.toml 的 name 是「${n}」，不是 ${NAME}。中止。"
  d=$(value database_name); [ "${d}" = "${NAME}" ] || die "database_name 是「${d}」，不是 ${NAME}。中止。"
  b=$(value bucket_name); [ "${b}" = "${NAME}" ] || die "bucket_name 是「${b}」，不是 ${NAME}。中止。"
  [ "$(grep -c '^\[\[d1_databases\]\]' "${TOML}")" = 1 ] || die "wrangler.toml 只能有一個 D1。中止。"
  [ "$(grep -c '^\[\[r2_buckets\]\]' "${TOML}")" = 1 ] || die "wrangler.toml 只能有一個 R2。中止。"
  if grep -Eq '^[[:space:]]*(route|routes|custom_domain|zone_id|zone_name)[[:space:]]*=' "${TOML}" || grep -Eq '^\[\[?routes' "${TOML}"; then
    die "wrangler.toml 不得設定 routes 或網域（規格書 §11-2）。中止。"
  fi
  grep -Eq '^workers_dev[[:space:]]*=[[:space:]]*true' "${TOML}" || die "workers_dev 必須是 true（網址只用 workers.dev）。中止。"
  [ -x "${HERE}/worker/node_modules/.bin/wrangler" ] || die "還沒安裝 wrangler：先執行  cd \"${HERE}/worker\" && pnpm install"
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${major}" -ge 20 ] || die "Node 版本太舊（$(node -v 2>/dev/null)）。請先 nvm use 22。"
  ok "wrangler.toml：name、database_name、bucket_name 都是 ${NAME}；沒有 routes／網域"
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    printf '! 注意：這個終端機有環境變數 CLOUDFLARE_API_TOKEN，wrangler 會用它，而不是 scripts/deploy.sh login 的授權（見 docs/部署步驟.md 第 1 步）。\n'
  fi
}

need_db_id() {
  id=$(value database_id)
  [ -n "${id}" ] && [ "${id}" != "${PLACEHOLDER}" ] || die "wrangler.toml 的 database_id 還是預設值。請先執行  scripts/deploy.sh init"
}

disk() {
  free_kb=$(df -k / | awk 'NR==2 {print $4}')
  [ "${free_kb}" -ge 2097152 ] || die "磁碟剩不到 2 GB，停止（規格書 §3.2）。"
}

cmd=${1:-deploy}
case "${cmd}" in
  login)
    check
    wr login
    wr whoami
    ;;

  check)
    check
    ;;

  inventory)
    check
    mkdir -p "${HERE}/reports"
    out="${HERE}/reports/cloudflare-inventory-$(date +%Y%m%d-%H%M%S).txt"
    {
      echo "# Cloudflare 資源清單（唯讀）$(date)"
      echo; echo "## 帳號"; wr whoami 2>&1 | grep -v -i token || true
      echo; echo "## D1"; wr d1 list 2>&1 || true
      echo; echo "## R2"; wr r2 bucket list 2>&1 || true
    } > "${out}"
    ok "已存 ${out}"
    echo "  Workers 的清單請另外在 Cloudflare 網頁「Workers & Pages」截圖一張（wrangler 沒有列出全部 Worker 的唯讀指令）。"
    echo "  這份檔案只在你的 Mac 上（reports/ 不進版本庫）。"
    ;;

  init)
    check
    echo "→ 建立 D1：${NAME}"
    id=$(value database_id)
    if [ -n "${id}" ] && [ "${id}" != "${PLACEHOLDER}" ]; then
      ok "wrangler.toml 已經有 database_id（${id}），不再建立 D1"
    else
      outp=$( cd "${HERE}/worker" && ./node_modules/.bin/wrangler d1 create "${NAME}" 2>&1 ) || { echo "${outp}"; die "建立 D1 失敗（見上面的訊息）"; }
      echo "${outp}"
      new=$(printf '%s\n' "${outp}" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
      [ -n "${new}" ] || die "看不到新的 database_id。請把上面的訊息貼給 Claude。"
      sed -i '' "s/${PLACEHOLDER}/${new}/" "${TOML}"
      ok "database_id = ${new}（已寫進 worker/wrangler.toml）"
    fi
    echo "→ 建立 R2 bucket：${NAME}"
    if wr r2 bucket list 2>/dev/null | grep -Eq "^name:[[:space:]]+${NAME}\$"; then
      ok "R2 bucket ${NAME} 已存在"
    else
      wr r2 bucket create "${NAME}"
      ok "R2 bucket ${NAME} 已建立"
    fi
    echo
    echo "下一步：scripts/deploy.sh"
    ;;

  deploy)
    check; need_db_id; disk
    echo "→ 建置 App"
    ( cd "${HERE}/app" && pnpm install --frozen-lockfile >/dev/null && pnpm run build )
    [ -f "${HERE}/app/dist/index.html" ] && [ -f "${HERE}/app/dist/login.html" ] && [ -f "${HERE}/app/dist/sw.js" ] || die "建置成品不完整"
    size=$(du -sk "${HERE}/app/dist" | awk '{print $1}')
    [ "${size}" -lt 20480 ] || die "建置成品 ${size} KB，超過 20 MB 上限（規格書 §3.2）"
    ok "App 建置完成（$((size / 1024)) MB）"
    echo "→ 套用 D1 migrations（只對 ${NAME}）"
    wr d1 migrations apply "${NAME}" --remote
    echo "→ 部署 Worker ${NAME}"
    log=$(mktemp)
    wr deploy 2>&1 | tee "${log}"
    url=$(grep -Eo "https://${NAME}\.[a-z0-9-]+\.workers\.dev" "${log}" | head -1 || true)
    rm -f "${log}"
    if [ -n "${url}" ]; then
      ok "網址：${url}"
      if grep -Eq '^url[[:space:]]*=[[:space:]]*""' "${HERE}/tools/pmq/pmq.toml"; then
        sed -i '' "s#^url[[:space:]]*=[[:space:]]*\"\"#url = \"${url}\"#" "${HERE}/tools/pmq/pmq.toml"
        ok "已把網址寫進 tools/pmq/pmq.toml 的 [site] url"
      fi
    fi
    # 部署後的暫存（wrangler 的建置輸出）不留
    rm -rf "${HERE}/worker/.wrangler/tmp"
    ;;

  secret)
    check
    what=${2:-}
    case "${what}" in
      password)
        echo "→ 設定登入密碼。密碼只在這台 Mac 上轉成雜湊，雜湊才送到 Cloudflare。"
        hash=$("${HERE}/bin/pmq" auth hash) || die "沒有設定"
        printf '%s' "${hash}" | wr secret put AUTH_HASH
        unset hash
        ok "AUTH_HASH 已設定。所有裝置要用新密碼重新登入（舊的登入不受影響，要登出請到設定頁）。"
        ;;
      admin)
        tok=$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)
        security add-generic-password -U -s postmed-qbank-admin -a postmed-qbank -w "${tok}" >/dev/null
        printf '%s' "${tok}" | wr secret put ADMIN_TOKEN
        unset tok
        ok "管理金鑰已存進鑰匙圈（postmed-qbank-admin）並設定到 Worker。pmq publish 會自動讀它。"
        ;;
      *) die "用法：scripts/deploy.sh secret password｜admin" ;;
    esac
    ;;

  status)
    check
    wr deployments list
    ;;

  rollback)
    check
    echo "→ 把 Worker ${NAME} 退回上一版（只換程式；D1 與 R2 的資料不動）"
    wr rollback
    ;;

  d1-restore)
    check; need_db_id
    ts=${2:-}
    [ -n "${ts}" ] || die "用法：scripts/deploy.sh d1-restore 2026-11-20T08:00:00+08:00（或 Unix 秒數）"
    echo "→ 把 D1 ${NAME} 還原到 ${ts}（之後的寫入會被蓋掉；還原前的狀態 Cloudflare 會另存一個書籤，可再還原回來）"
    wr d1 time-travel restore "${NAME}" --timestamp="${ts}"
    ;;

  *)
    die "不認得的指令：${cmd}（見這個檔案開頭的說明）"
    ;;
esac
