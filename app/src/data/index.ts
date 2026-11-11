// 畫面取用資料的唯一入口。src/pages、src/ui 只能 import 這個檔（不 import ./db、不直接 fetch）。
// 介面說明見 ./README.md。

export * from "./types";
export { content, setOffline, useContentStatus, type ContentStatus } from "./content";
export { attempts, flags, sessions, settings, wipeLocal } from "./personal";
export { prefs, useDeviceName, useFigInvert, useOfflinePref, useThemePref } from "./prefs";
export { startSync, syncNow, useSyncDetail, useSyncState } from "./sync";
export { auth, type DeviceSession, type LoginResult } from "./auth";
export * from "./hooks";
export {
  buildContext,
  chapterLabel,
  chapterState,
  defaultFilter,
  describeFilter,
  facetCounts,
  matchRows,
  pickItems,
  sanitizeFilter,
  toggleChapter,
  type ChapterNode,
  type CheckState,
  type FacetCounts,
  type FilterContext,
} from "./filter";
export { isChoice, isMulti, judge, splitQuestion, answerText } from "./question";
