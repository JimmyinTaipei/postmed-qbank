// 設定頁：外觀、同步、這台裝置、離線下載、登入中的裝置、資料（匯出全部、清除本機副本、登出）。

import { useState } from "react";
import {
  auth, prefs, setOffline, syncNow, useAsync, useContentInfo, useContentStatus, useDeviceName, useFigInvert, useOfflinePref, usePencilOnFigures, useShowUnverified,
  useSyncDetail, useTaxonomy, comboLabel, comboOf, useClozeKeys, CLOZE_KEYS_DEFAULT, type ClozeKeys, useThemePref, wipeLocal, settings, srs, useSrsConfig, type Subject, type SrsConfig,
} from "@/data";
import { formatAgo } from "@/lib/format";
import { Dialog, useToast } from "@/ui/overlays";
import { Button, Card, ListCard, ListRow, Notice, ProgressBar, SectionTitle, Segmented, Skeleton, Switch, TextField } from "@/ui/primitives";
import { Page, SyncStatus } from "@/ui/shell";

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

function OfflineSwitch({ subject }: { subject: Subject }) {
  const on = useOfflinePref(subject.id);
  const st = useContentStatus().subjects[subject.id];
  const hint = st ? `已下載 ${st.have} / ${st.total} 章${st.bytes ? `（${mb(st.bytes)}）` : ""}` : "讀取中";
  return <Switch checked={on} onChange={(v) => void setOffline(subject.id, v)} label={`${subject.name}：整科下載到這台裝置`} hint={on ? hint : `關閉時只留看過的章節；${hint}`} />;
}

function DeviceName() {
  const name = useDeviceName();
  const [draft, setDraft] = useState<string | null>(null);
  const toast = useToast();
  const value = draft ?? name;
  return (
    <form
      className="px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        prefs.setDevice(value);
        setDraft(null);
        toast("已改名；之後的作答會記成「" + value.trim() + "」");
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <TextField className="min-w-48 flex-1" label="這台裝置的名稱" value={value} maxLength={40} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={!value.trim() || value.trim() === name}>改名</Button>
      </div>
      <p className="mt-1.5 text-meta text-ink-muted">寫進每一筆作答，也是「登入中的裝置」顯示的名字（下次登入時）。例如 iPad、Mac。</p>
    </form>
  );
}

function Devices() {
  const list = useAsync(() => auth.devices(), []);
  const toast = useToast();
  if (list.error) return <Notice tone="warning" icon="cloudOff">讀不到登入中的裝置（{list.error.message}）。連上網路後再試。</Notice>;
  if (!list.data) return <Card className="p-4"><Skeleton lines={2} /></Card>;
  return (
    <ListCard label="登入中的裝置">
      {list.data.map((d) => (
        <li key={d.id} className="flex items-center">
          <ListRow className="min-w-0 flex-1" title={d.current ? `${d.label}（這台）` : d.label} meta={`登入於 ${new Date(d.created_at).toLocaleDateString("zh-TW")}・最後使用 ${formatAgo(d.last_seen)}`} chevron={false} />
          {!d.current && (
            <Button
              variant="ghost"
              className="mr-2"
              onClick={() => void auth.revoke(d.id).then(() => { toast(`已登出「${d.label}」`); list.reload(); }, (e: Error) => toast(`登出失敗：${e.message}`))}
            >
              登出
            </Button>
          )}
        </li>
      ))}
    </ListCard>
  );
}

function ReviewSettings() {
  const cfg = useSrsConfig();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<SrsConfig>) => cfg && void settings.set("srs.config", { ...cfg, ...p });
  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="text-ui text-ink-strong">{label}</div>
        <div className="text-meta text-ink-muted">{hint}</div>
      </div>
      {control}
    </div>
  );
  return (
    <section aria-labelledby="h-review">
      <SectionTitle id="h-review">複習</SectionTitle>
      <Card className="divide-y divide-line">
        {!cfg ? (
          <div className="p-4"><Skeleton lines={3} /></div>
        ) : (
          <>
            {row("目標記憶率", "越高複習越頻繁；Anki 預設 90%", <Segmented label="目標記憶率" value={cfg.retention} onChange={(v) => set({ retention: v })} options={[0.85, 0.9, 0.95].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))} />)}
            {row("每日複習上限", "超過的到期題目留到隔天", <Segmented label="每日複習上限" value={cfg.maxReviews} onChange={(v) => set({ maxReviews: v })} options={[100, 200, 400, 9999].map((v) => ({ value: v, label: v === 9999 ? "不限" : String(v) }))} />)}
            {row("每日新題上限", "手動「加入複習」的題目每天最多開始幾題", <Segmented label="每日新題上限" value={cfg.maxNew} onChange={(v) => set({ maxNew: v })} options={[10, 20, 50, 9999].map((v) => ({ value: v, label: v === 9999 ? "不限" : String(v) }))} />)}
            {row(
              "重算排程",
              "從每一筆評分紀錄重建排程。改了目標記憶率，或兩台裝置的到期日看起來不一致時用",
              <Button icon="refresh" loading={busy} onClick={() => { setBusy(true); void srs.rebuild().then((r) => toast(`重算 ${r.items} 題，${r.changed} 題的排程有變`)).finally(() => setBusy(false)); }}>重算</Button>,
            )}
          </>
        )}
      </Card>
    </section>
  );
}

/** 一個快速鍵：按「錄製」後按下新的組合（要有 ⌘／Ctrl）；Esc 取消。 */
function KeyRecorder({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  const [warn, setWarn] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="text-ui text-ink-strong">{label}</div>
        {warn && <div className="text-meta text-incorrect-ink" role="alert">{warn}</div>}
      </div>
      <button
        type="button"
        aria-label={`${label}：${rec ? "請按新的組合鍵，Esc 取消" : comboLabel(value)}`}
        className={`min-h-11 min-w-28 rounded-btn border px-3 font-mono text-ui ${rec ? "border-blue-accent bg-blue-light text-ink-strong" : "border-line bg-card text-ink-strong hover:bg-hover"}`}
        onClick={() => { setWarn(""); setRec(true); }}
        onBlur={() => setRec(false)}
        onKeyDown={(e) => {
          if (!rec) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") return setRec(false);
          if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
          if (!e.metaKey && !e.ctrlKey) return setWarn("要包含 ⌘ 或 Ctrl，才不會和打字衝突");
          onChange(comboOf(e));
          setRec(false);
        }}
      >
        {rec ? "請按組合鍵…" : comboLabel(value)}
      </button>
    </div>
  );
}

function ClozeKeySettings() {
  const keys = useClozeKeys();
  const toast = useToast();
  const set = (k: keyof ClozeKeys) => (v: string) => {
    const other = k === "new" ? keys.same : keys.new;
    if (v === other) return toast("兩個快速鍵不能一樣");
    prefs.setClozeKeys({ [k]: v });
    toast(`已改成 ${comboLabel(v)}`);
  };
  const changed = keys.new !== CLOZE_KEYS_DEFAULT.new || keys.same !== CLOZE_KEYS_DEFAULT.same;
  return (
    <section aria-labelledby="h-keys">
      <SectionTitle id="h-keys">快速鍵</SectionTitle>
      <Card className="divide-y divide-line">
        <KeyRecorder label="克漏字（新的編號）" value={keys.new} onChange={set("new")} />
        <KeyRecorder label="克漏字（和上一個同一張卡）" value={keys.same} onChange={set("same")} />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-meta text-ink-muted">筆記裡選字後按、卡片編輯器裡選字後按都可以。只影響這台裝置。</span>
          {changed && <Button variant="ghost" className="ml-auto" onClick={() => { prefs.setClozeKeys(null); toast("已恢復預設"); }}>恢復預設</Button>}
        </div>
      </Card>
    </section>
  );
}

export function Settings() {
  const theme = useThemePref();
  const invert = useFigInvert();
  const pencilFigs = usePencilOnFigures();
  const unverified = useShowUnverified();
  const info = useContentInfo().data;
  const tax = useTaxonomy().data;
  const cst = useContentStatus();
  const sync = useSyncDetail();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"wipe" | "logout" | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Page title="設定" back="/more">
      <section aria-labelledby="h-look">
        <SectionTitle id="h-look">外觀</SectionTitle>
        <Card className="divide-y divide-line">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-ui text-ink-strong">主題</span>
            <Segmented label="主題" value={theme} onChange={(v) => prefs.setTheme(v)} options={[{ value: "system", label: "跟隨系統" }, { value: "light", label: "淺色" }, { value: "dark", label: "深色" }]} />
          </div>
          <Switch checked={invert} onChange={(v) => prefs.setFigInvert(v)} label="深色模式下反相黑白線稿" hint="只影響純黑白的圖；彩色圖一律放在白色紙卡上。也可以在圖片檢視器裡切換。" />
          <Switch checked={pencilFigs} onChange={(v) => prefs.setPencilOnFigures(v)} label="Apple Pencil 直接在圖上畫" hint="打開時，筆在內文的圖上拖曳就是畫標記，點一下是放大；手指照常捲動。關掉後筆和手指一樣，要在圖片檢視器按「標記」才能畫。只影響這台裝置。" />
          <Switch checked={unverified} onChange={(v) => prefs.setShowUnverified(v)} label="顯示「未確認」" hint="預設只在你確認過的題目顯示「✓ 已確認」。打開後，還沒確認的題目也會顯示「未確認」。" />
        </Card>
      </section>

      <section aria-labelledby="h-sync">
        <SectionTitle id="h-sync">同步</SectionTitle>
        <Card className="divide-y divide-line">
          <ListRow
            title="狀態"
            trailing={<SyncStatus />}
            chevron={false}
            meta={[sync.lastOk ? `上次同步 ${formatAgo(sync.lastOk)}` : "還沒同步過", sync.pending ? `待送 ${sync.pending} 筆` : null].filter(Boolean).join("・")}
          />
          {sync.error && <div className="p-4"><Notice tone="incorrect" icon="alert">{sync.error}</Notice></div>}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button icon="refresh" loading={busy} disabled={busy} onClick={() => { setBusy(true); void syncNow().finally(() => setBusy(false)); }}>立即同步</Button>
            <span className="text-meta text-ink-muted">App 開著時每 30 秒自動同步；作答後幾秒內就會送出。</span>
          </div>
        </Card>
      </section>

      <ReviewSettings />

      <ClozeKeySettings />

      <section aria-labelledby="h-device">
        <SectionTitle id="h-device">這台裝置</SectionTitle>
        <Card className="divide-y divide-line">
          <DeviceName />
        </Card>
      </section>

      <section aria-labelledby="h-offline">
        <SectionTitle id="h-offline">離線下載</SectionTitle>
        <Card className="divide-y divide-line">
          {!tax ? <div className="p-4"><Skeleton lines={2} /></div> : tax.subjects.map((s) => <OfflineSwitch key={s.id} subject={s} />)}
          {cst.downloading && (
            <div className="px-4 py-3">
              <p className="mb-2 text-meta text-ink-muted">下載中 {cst.downloading.done} / {cst.downloading.total}</p>
              <ProgressBar value={cst.downloading.done} max={cst.downloading.total} label="下載進度" />
            </div>
          )}
          {cst.error && <div className="p-4"><Notice tone="warning">{cst.error}</Notice></div>}
        </Card>
        <p className="mt-2 text-meta text-ink-muted">已下載的科目在飛航模式下也能刷題。看過的圖也會留在裝置上。iPad 請用「加入主畫面」的 App，Safari 分頁的資料可能在 7 天沒開後被清掉。</p>
      </section>

      <section aria-labelledby="h-devices">
        <SectionTitle id="h-devices">登入中的裝置</SectionTitle>
        <Devices />
      </section>

      <section aria-labelledby="h-data">
        <SectionTitle id="h-data">資料</SectionTitle>
        <ListCard>
          <li><ListRow title="題庫內容" chevron={false} meta={info ? `${Object.entries(info.counts).map(([k, v]) => `${tax?.subjects.find((s) => s.id === k)?.name ?? k} ${v.toLocaleString()} 題`).join("・")}・發佈於 ${info.generated.replace("T", " ")}${info.sample ? "・樣本資料" : ""}` : "讀取中"} /></li>
        </ListCard>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button icon="file" onClick={() => location.assign(auth.exportUrl)}>匯出全部</Button>
          <Button variant="ghost" icon="lock" onClick={() => setConfirm("logout")}>登出這台裝置</Button>
          <Button variant="danger" icon="trash" onClick={() => setConfirm("wipe")}>清除這台裝置上的資料副本</Button>
        </div>
        <p className="mt-2 text-meta text-ink-muted">「匯出全部」下載一個 zip：作答、題組、標記、設定等每張表一個 NDJSON 檔。Mac 上可用 pmq restore 灌回。</p>
      </section>

      <section aria-labelledby="h-dev">
        <SectionTitle id="h-dev">開發</SectionTitle>
        <ListCard>
          <li><ListRow to="/dev/ui" title="UI 展示" meta="每個元件的每種狀態、色彩對比表、特殊情況題目" /></li>
        </ListCard>
      </section>

      {confirm === "wipe" && (
        <Dialog
          title="清除這台裝置上的資料副本？"
          onClose={() => setConfirm(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>取消</Button>
              <Button variant="danger" onClick={() => { void wipeLocal().then(() => toast("已清除；正在從雲端重新下載")); setConfirm(null); }}>清除</Button>
            </>
          }
        >
          {sync.pending
            ? `還有 ${sync.pending} 筆沒送到雲端，清除後就沒有了。建議先連上網路按「立即同步」。`
            : "雲端的資料不受影響，清除後會重新下載。用在這台裝置的資料看起來不對的時候。"}
        </Dialog>
      )}
      {confirm === "logout" && (
        <Dialog
          title="登出這台裝置？"
          onClose={() => setConfirm(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>取消</Button>
              <Button variant="danger" onClick={() => { setConfirm(null); void auth.logout(); }}>登出</Button>
            </>
          }
        >
          {sync.pending ? `還有 ${sync.pending} 筆沒送出，登出前會先試著送一次。` : "登出後要重新輸入密碼。"}這台裝置上的題庫與作答副本會留著，重新登入後繼續同步。
        </Dialog>
      )}
    </Page>
  );
}
