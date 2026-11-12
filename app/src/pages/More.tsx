// 更多：主導覽放不下的頁面。卡片、考題（錯題本、題庫瀏覽、原卷）第 2B 階段搬到主導覽。

import { useOpenPatchCount } from "@/data";
import { Icon, type IconName } from "@/ui/icons";
import { Badge, ListCard, ListRow, SectionTitle } from "@/ui/primitives";
import { Page } from "@/ui/shell";

const GROUPS: { title: string; items: { to: string; label: string; meta: string; icon: IconName; stage?: string }[] }[] = [
  {
    title: "分析",
    items: [
      { to: "/stats", label: "統計", meta: "每日題數、弱點章節", icon: "chart" },
      { to: "/analysis", label: "考題分析", meta: "各單元歷年出題比例", icon: "grid" },
    ],
  },
  {
    title: "其他",
    items: [
      { to: "/patches", label: "修訂佇列", meta: "在網站上改過、待寫回主檔的內容", icon: "edit" },
      { to: "/settings", label: "設定", meta: "外觀、資料", icon: "sliders" },
    ],
  },
];

export function More() {
  const openPatches = useOpenPatchCount();
  return (
    <Page title="更多">
      {GROUPS.map((g) => (
        <section key={g.title} aria-labelledby={`h-${g.title}`}>
          <SectionTitle id={`h-${g.title}`}>{g.title}</SectionTitle>
          <ListCard>
            {g.items.map((it) => (
              <li key={it.to}>
                <ListRow to={it.to} title={it.label} meta={it.meta} leading={<Icon name={it.icon} size={20} />} trailing={it.to === "/patches" && openPatches ? <Badge tone="warning">{openPatches}</Badge> : it.stage ? <Badge>{it.stage}</Badge> : undefined} />
              </li>
            ))}
          </ListCard>
        </section>
      ))}
    </Page>
  );
}
