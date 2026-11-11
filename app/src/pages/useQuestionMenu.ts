// 題目右上 ⋯ 選單的共用項目（刷題畫面與單題頁）。規格書 §9.2：存疑・編輯・加入複習・標為已確認；
// 第 2 階段加上：已掌握（移出錯題本）、恢復追蹤（取消「粗心錯，不追蹤」，§5.3）。

import { attempts, flags, srs, useFlags, useSrsState, wrongBook, type ItemKey } from "@/data";
import type { MenuItem } from "@/ui/overlays";
import { useToast } from "@/ui/overlays";

export function useQuestionMenu(item: ItemKey, id: string): MenuItem[] {
  const flag = useFlags(item);
  const st = useSrsState(item);
  const toast = useToast();
  const inReview = !!st && !st.suspended;
  const items: MenuItem[] = [
    {
      label: "存疑",
      icon: "flag",
      checked: flag.doubt,
      onSelect: () => {
        void flags.set(item, "doubt", !flag.doubt);
        toast(flag.doubt ? "已取消存疑" : "已標為存疑，之後可以在出題設定的「狀態」篩出來");
      },
    },
    { label: "編輯這一題", icon: "edit", disabledReason: "第 3 階段開放" },
    st?.suspended
      ? {
          label: "恢復追蹤（放回錯題本與複習）",
          icon: "undo",
          onSelect: () => {
            void attempts.undoCareless(item);
            toast("已恢復：放回錯題本並排進複習");
          },
        }
      : {
          label: inReview ? "移出複習" : "加入複習",
          icon: "repeat",
          onSelect: () => {
            if (inReview) {
              void srs.remove(id);
              toast("已移出複習；之後再加入會接著原本的進度");
            } else {
              void srs.add(id);
              toast("已加入複習，會出現在今日複習的新題裡");
            }
          },
        },
  ];
  if (flag.wrong)
    items.push({
      label: "已掌握（移出錯題本）",
      icon: "check",
      onSelect: () => {
        void wrongBook.master(item);
        toast("已移出錯題本", { action: { label: "復原", run: () => void wrongBook.unmaster(item) } });
      },
    });
  items.push({ label: "標為已確認", icon: "check", disabledReason: "第 3 階段開放" });
  return items;
}
