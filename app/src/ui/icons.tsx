// 全站圖示：一組線條圖示，24×24、線寬 1.75、跟著文字顏色。要新增圖示就加在這裡，不另外引入圖示庫。

import type { ReactNode } from "react";

const P = (d: string) => <path d={d} />;

const ICONS = {
  home: P("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"),
  pencil: (
    <>
      {P("M12 20h9")}
      {P("M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z")}
    </>
  ),
  repeat: (
    <>
      {P("m17 2 4 4-4 4")}
      {P("M3 11v-1a4 4 0 0 1 4-4h14")}
      {P("m7 22-4-4 4-4")}
      {P("M21 13v1a4 4 0 0 1-4 4H3")}
    </>
  ),
  book: P("M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  dots: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </g>
  ),
  star: P("m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"),
  starFilled: <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor" />,
  flag: (
    <>
      {P("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z")}
      {P("M4 22v-7")}
    </>
  ),
  chevronLeft: P("m15 18-6-6 6-6"),
  chevronRight: P("m9 18 6-6-6-6"),
  chevronDown: P("m6 9 6 6 6-6"),
  arrowLeft: (
    <>
      {P("M19 12H5")}
      {P("m12 19-7-7 7-7")}
    </>
  ),
  arrowRight: (
    <>
      {P("M5 12h14")}
      {P("m12 5 7 7-7 7")}
    </>
  ),
  check: P("M20 6 9 17l-5-5"),
  x: (
    <>
      {P("M18 6 6 18")}
      {P("m6 6 12 12")}
    </>
  ),
  alert: (
    <>
      {P("M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z")}
      {P("M12 9v4")}
      {P("M12 17h.01")}
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P("M12 16v-4")}
      {P("M12 8h.01")}
    </>
  ),
  sliders: (
    <>
      {P("M4 21v-7")}
      {P("M4 10V3")}
      {P("M12 21v-9")}
      {P("M12 8V3")}
      {P("M20 21v-5")}
      {P("M20 12V3")}
      {P("M1 14h6")}
      {P("M9 8h6")}
      {P("M17 16h6")}
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      {P("m21 21-4.3-4.3")}
    </>
  ),
  plus: (
    <>
      {P("M12 5v14")}
      {P("M5 12h14")}
    </>
  ),
  minus: P("M5 12h14"),
  fit: (
    <>
      {P("M8 3H5a2 2 0 0 0-2 2v3")}
      {P("M21 8V5a2 2 0 0 0-2-2h-3")}
      {P("M3 16v3a2 2 0 0 0 2 2h3")}
      {P("M16 21h3a2 2 0 0 0 2-2v-3")}
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>
  ),
  device: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      {P("M12 18h.01")}
    </>
  ),
  cloud: P("M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"),
  cloudOff: (
    <>
      {P("M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z")}
      {P("m3 3 18 18")}
    </>
  ),
  refresh: (
    <>
      {P("M21 12a9 9 0 1 1-3-6.7L21 8")}
      {P("M21 3v5h-5")}
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P("M12 7v5l3 2")}
    </>
  ),
  edit: (
    <>
      {P("M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7")}
      {P("M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z")}
    </>
  ),
  trash: (
    <>
      {P("M3 6h18")}
      {P("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")}
      {P("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6")}
    </>
  ),
  chart: (
    <>
      {P("M3 3v18h18")}
      {P("M7 16v-5")}
      {P("M12 16V8")}
      {P("M17 16v-9")}
    </>
  ),
  list: (
    <>
      {P("M8 6h13")}
      {P("M8 12h13")}
      {P("M8 18h13")}
      {P("M3 6h.01")}
      {P("M3 12h.01")}
      {P("M3 18h.01")}
    </>
  ),
  file: (
    <>
      {P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z")}
      {P("M14 2v6h6")}
      {P("M8 13h8")}
      {P("M8 17h8")}
    </>
  ),
  note: P("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"),
  download: (
    <>
      {P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4")}
      {P("m7 10 5 5 5-5")}
      {P("M12 15V3")}
    </>
  ),
  printer: (
    <>
      {P("M6 9V2h12v7")}
      {P("M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2")}
      <rect x="6" y="14" width="12" height="8" />
    </>
  ),
  undo: (
    <>
      {P("M3 7v6h6")}
      {P("M21 17a9 9 0 0 0-15-6.7L3 13")}
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      {P("M7 11V7a5 5 0 0 1 10 0v4")}
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      {P("M12 2v2")}
      {P("M12 20v2")}
      {P("m4.9 4.9 1.4 1.4")}
      {P("m17.7 17.7 1.4 1.4")}
      {P("M2 12h2")}
      {P("M20 12h2")}
      {P("m6.3 17.7-1.4 1.4")}
      {P("m19.1 4.9-1.4 1.4")}
    </>
  ),
  moon: P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** 裝飾用圖示（aria-hidden）。有意義的圖示要搭配文字，或放在有 aria-label 的 IconButton 裡。 */
export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
    >
      {ICONS[name]}
    </svg>
  );
}
