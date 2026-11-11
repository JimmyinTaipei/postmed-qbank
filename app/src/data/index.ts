// 畫面取用資料的唯一入口。src/pages、src/ui 只能 import 這個檔（不 import ./db、不直接 fetch）。
// 介面說明見 ./README.md。

export * from "./types";
export { content, setOffline, useContentStatus, type ContentStatus } from "./content";
export { attempts, exam, flags, sessions, settings, wipeLocal, wrongBook, type ExamPicks } from "./personal";
export { srs, type ReviewQueue } from "./srs";
export { patches, notes, highlights, applyPatches, answerValue, fieldValue, fieldHash, markOf, patchNote, isWritten, FIELD_NAME, type AnswerValue } from "./patches";
export { DEFAULT_SRS, ratingOf, startOfDay, localDay } from "./srs-core";
export { prefs, useDeviceName, useFigInvert, useOfflinePref, useShowUnverified, useThemePref } from "./prefs";
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
  withStatus,
  STATUS_KEYS,
  type StatusSets,
  type ChapterNode,
  type CheckState,
  type FacetCounts,
  type FilterContext,
} from "./filter";
export { isChoice, isMulti, judge, splitQuestion, answerText } from "./question";
export { useSearch, searchText, prepareSearch, type SearchHit, type SearchState } from "./search";
