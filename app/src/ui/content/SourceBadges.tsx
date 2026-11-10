// 來源徽章（規格書 §4.4、§5.1）：答案與詳解各是誰給的。
// 不顯示「未確認」——每一題都未確認，顯示了等於沒有資訊；只有 human_verified 才多一個「已確認」。

import type { Question } from "@/data";
import { Badge } from "../primitives";

const TRUST: Record<Question["answer"]["trust"], string> = {
  official: "官方答案",
  key: "答案表",
  teacher: "老師答案",
  ai: "AI 答案",
  pending: "答案待定",
};
const ORIGIN: Record<Question["sol_meta"]["origin"], string> = {
  official: "官方詳解",
  teacher: "老師詳解",
  ai: "AI 詳解",
  human: "自己寫的詳解",
  mixed: "老師核心式＋AI 補寫",
};

export function SourceBadges({ q }: { q: Question }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={q.answer.trust === "pending" ? "warning" : "neutral"}>{TRUST[q.answer.trust]}</Badge>
      {q.sol.trim() && <Badge>{ORIGIN[q.sol_meta.origin]}</Badge>}
      {q.sol_meta.human_verified && (
        <Badge tone="blue" icon="check">
          已確認
        </Badge>
      )}
    </span>
  );
}
