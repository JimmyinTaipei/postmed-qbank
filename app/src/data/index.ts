// 畫面取用資料的唯一入口。src/pages、src/ui 只能 import 這個檔（不 import ./db、不直接 fetch）。
// 介面說明見 ./README.md。

export * from "./types";
export { content, setOffline, useContentStatus, type ContentStatus } from "./content";
export { attempts, exam, flags, sessions, settings, wipeLocal, wrongBook, type ExamPicks } from "./personal";
export { srs, type ReviewQueue } from "./srs";
export { ink, inkId, readInk, encodeInk, decodeInk, InkTooLarge } from "./ink";
export { cards, decks, tsv, cardQueue, ratingPreview, deckSubtree, flattenDecks, useCard, useCardQueue, useDeck, useDeckCards, useDeckTree, cardFaces, clozeNumbers, formatIvl, type CardQueue, type CardRow, type DeckNode, type NoteInput } from "./cards";
export { patches, notes, highlights, applyPatches, answerValue, fieldValue, fieldHash, markOf, patchNote, isWritten, FIELD_NAME, type AnswerValue } from "./patches";
export { kbPatches, applyKbPatches, useKbPatches, useKbDrafts, useKbDraft, draftName, isNewBid, kbTarget, KB_EDITABLE, KB_DELETABLE, KB_BAD_NAME, type KbMark, type KbOverlay } from "./kbPatches";
export { DEFAULT_SRS, ratingOf, startOfDay, localDay } from "./srs-core";
export { prefs, useInkToolPref, usePencilOnFigures, INK_TOOL_DEFAULT, type InkToolPref, useCardAutoplay, useDeviceName, useFigInvert, useOfflinePref, useShowUnverified, useThemePref } from "./prefs";
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
export { pushRecent, kbRecent, useKbRecent, KB_RECENT, type KbRecent } from "./recent";
