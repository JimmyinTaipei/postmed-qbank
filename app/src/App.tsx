// 路由表（規格書 §9.1）。有外殼的頁面放在 <AppShell> 底下；刷題畫面與登入頁是全螢幕、沒有導覽。

import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useApplyTheme } from "./lib/theme";
import { FigureViewerProvider } from "./ui/content/FigureViewer";
import { ToastProvider } from "./ui/overlays";
import { EmptyState, LinkButton, Skeleton } from "./ui/primitives";
import { AppShell, Page } from "./ui/shell";
import { Today } from "./pages/Today";
import { PracticeSetup } from "./pages/PracticeSetup";
import { SessionPlayer } from "./pages/SessionPlayer";
import { SessionDone } from "./pages/SessionDone";
import { QuestionPage } from "./pages/QuestionPage";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { More } from "./pages/More";
import { KbDraftPage, KbIndex, KbReaderPage } from "./pages/Kb";
import { CardEditPage, CardPage, CardReviewPage, CardsIndex, DeckPage } from "./pages/Cards";
import { PatchesPage } from "./pages/Patches";
import { EditorProvider } from "./pages/EditQuestion";
import { ReviewPage } from "./pages/Review";
import { PapersPage } from "./pages/Papers";
import { StatsPage } from "./pages/Stats";
import { BrowsePage } from "./pages/Browse";
import { AnalysisPage } from "./pages/Analysis";
import { WrongBookPage } from "./pages/WrongBook";

// 展示頁不常開，另外打包
const UiGallery = lazy(() => import("./pages/UiGallery"));

function NotFound() {
  return (
    <Page title="找不到這一頁">
      <EmptyState title="這個網址沒有對應的頁面" action={<LinkButton to="/">回今日</LinkButton>}>
        可能是連結打錯，或這個功能還沒開放。
      </EmptyState>
    </Page>
  );
}

export function App() {
  useApplyTheme();
  return (
    <BrowserRouter>
      <ToastProvider>
        <FigureViewerProvider>
          <EditorProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/s/:sessionId" element={<SessionPlayer />} />
            <Route path="/cards/review" element={<CardReviewPage />} />
            <Route element={<AppShell />}>
              <Route index element={<Today />} />
              <Route path="/practice" element={<PracticeSetup />} />
              <Route path="/s/:sessionId/done" element={<SessionDone />} />
              <Route path="/q/:id" element={<QuestionPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/kb" element={<KbIndex />} />
              <Route path="/kb/new/:id" element={<KbDraftPage />} />
              <Route path="/kb/:subject/:doc" element={<KbReaderPage />} />
              <Route path="/cards" element={<CardsIndex />} />
              <Route path="/cards/d/:deckId" element={<DeckPage />} />
              <Route path="/cards/new" element={<CardEditPage />} />
              <Route path="/cards/c/:cardId" element={<CardPage />} />
              <Route path="/cards/c/:cardId/edit" element={<CardEditPage />} />
              <Route path="/more" element={<More />} />
              <Route path="/wrong" element={<WrongBookPage />} />
              <Route path="/browse" element={<BrowsePage />} />
              <Route path="/papers" element={<PapersPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/patches" element={<PatchesPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="/dev/ui"
                element={
                  <Suspense fallback={<Page title="UI 展示"><Skeleton lines={6} /></Page>}>
                    <UiGallery />
                  </Suspense>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </EditorProvider>
        </FigureViewerProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
