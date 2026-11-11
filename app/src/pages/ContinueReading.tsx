// 「繼續閱讀」：最近讀過的資料庫筆記（第 4B 階段，規格書 §9.4）。/kb 目錄頁最上面列 5 份，今日頁列 1 份。

import { useKbCatalog, useKbRecent } from "@/data";
import { formatAgo } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { ListCard, ListRow, SectionTitle } from "@/ui/primitives";

// 不帶 #b-：打開後由閱讀頁自己還原上次的位置（含展開層數）
const docUrlOf = (key: string) => `/kb/${key.split("/").map(encodeURIComponent).join("/")}`;

export function ContinueReading({ limit, title = "繼續閱讀" }: { limit: number; title?: string }) {
  const recent = useKbRecent();
  const cat = useKbCatalog();
  if (!recent?.length || !cat.data) return null;
  const docs = new Map(cat.data.subjects.flatMap((s) => s.groups.flatMap((g) => g.docs.map((d) => [d.key, { title: d.title, subject: s.name }] as const))));
  const rows = recent.filter((e) => docs.has(e.key)).slice(0, limit);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="h-continue">
      <SectionTitle id="h-continue">{title}</SectionTitle>
      <ListCard label="最近讀過的筆記">
        {rows.map((e) => {
          const d = docs.get(e.key)!;
          return (
            <li key={e.key}>
              <ListRow
                to={docUrlOf(e.key)}
                title={d.title}
                meta={[d.subject, e.path.at(-1) ? `讀到「${e.path.at(-1)}」` : null, formatAgo(e.at)].filter(Boolean).join("・")}
                leading={<Icon name="book" size={20} />}
              />
            </li>
          );
        })}
      </ListCard>
    </section>
  );
}
