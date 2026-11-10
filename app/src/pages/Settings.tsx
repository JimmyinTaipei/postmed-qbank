// 設定頁。1A 只有外觀與本機資料；裝置名稱、同步、匯出、登出在 1B 加在這一頁。

import { useState } from "react";
import { prefs, useContentInfo, useFigInvert, useThemePref, wipeLocal } from "@/data";
import { Dialog, useToast } from "@/ui/overlays";
import { Button, Card, ListCard, ListRow, SectionTitle, Segmented, Switch } from "@/ui/primitives";
import { Page, SyncStatus } from "@/ui/shell";

export function Settings() {
  const theme = useThemePref();
  const invert = useFigInvert();
  const info = useContentInfo().data;
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
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
        </Card>
      </section>

      <section aria-labelledby="h-data">
        <SectionTitle id="h-data">資料</SectionTitle>
        <ListCard>
          <li><ListRow title="同步" trailing={<SyncStatus />} chevron={false} meta="第 1B 階段開放：兩台裝置同步、匯出全部、登出" /></li>
          <li><ListRow title="題庫內容" chevron={false} meta={info ? `${Object.entries(info.counts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join("・")}・產生於 ${info.generated.replace("T", " ")}${info.sample ? "・樣本資料" : ""}` : "讀取中"} /></li>
          <li><ListRow title="這台裝置的代號" chevron={false} trailing={prefs.device()} /></li>
        </ListCard>
        <div className="mt-3">
          <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>清除這台裝置上的作答紀錄</Button>
        </div>
      </section>

      <section aria-labelledby="h-dev">
        <SectionTitle id="h-dev">開發</SectionTitle>
        <ListCard>
          <li><ListRow to="/dev/ui" title="UI 展示" meta="每個元件的每種狀態、色彩對比表、特殊情況題目" /></li>
          <li><ListRow to="/login" title="登入頁" meta="只有畫面；登入在第 1B 階段接上" /></li>
        </ListCard>
      </section>

      {confirm && (
        <Dialog
          title="清除作答紀錄？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button variant="danger" onClick={() => { void wipeLocal().then(() => toast("已清除這台裝置上的資料")); setConfirm(false); }}>清除</Button>
            </>
          }
        >
          這台裝置上的作答、錯題、星號、做到一半的題組都會刪掉，無法復原。目前還沒有同步，所以沒有其他地方留著。
        </Dialog>
      )}
    </Page>
  );
}
