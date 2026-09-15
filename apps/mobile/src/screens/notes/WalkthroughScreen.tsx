// ===========================================
// Lantern Study Mobile - Walk me through
// ===========================================

/**
 * The page-by-page walk-through of a document.
 *
 * The unit is the PAGE. Everything on this screen is scoped to the one the
 * student is looking at: the explanation is grounded in that page's text, the
 * quiz is written from that page's text, and the done mark is that page's.
 * That is the whole idea — a document is walked, not swallowed.
 *
 * Four decisions worth stating, because each one is a place this could have
 * gone wrong:
 *
 * 1. Progression is the student's. Nothing advances on its own, nothing is
 *    locked behind a check, and a check is only ever OFFERED — after every N
 *    pages, by `walkthroughCheckpoint`, which is shared with web so both
 *    platforms pace a document the same way.
 * 2. Explaining reuses the companion. There is no second AI surface here: "Ask
 *    about this page" opens the app's own companion with a prompt scoped to
 *    this page, so the honesty clamp that already grounds companion answers
 *    comes free rather than being re-implemented behind a new door.
 * 3. `available: false` is a state, not an error. A server without the page
 *    migration says so, and this screen prints "not split into pages yet"
 *    rather than a failure the student can do nothing about.
 * 4. Done marks are local. They are a reading position, not shared work: they
 *    live in AsyncStorage under a key of note + attachment, so they survive
 *    leaving the screen without pretending to be a synced artifact.
 *
 * Route: `Walkthrough`, opened with a `noteId` + `attachmentId` (and optionally
 * the page to land on).
 * Main exports: `WalkthroughScreen`.
 * Touches: companionStore (`openWithMessage`, `setActiveNoteContext`) for Ask,
 * services/notes `fetchNote`/`fetchNoteAttachmentPages`/
 * `generateDailyQuizFromContent`, and AsyncStorage for the done marks. The page
 * viewer, sheets and pure rules live in components/walkthrough. No other native
 * modules.
 *
 * Gotcha: the done-marks key is note + attachment only, with no user id in it,
 * so two accounts on one device share a reading position.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, useScreenActions, useScreenBottomPadding } from '../../components/layout';
import { BackButton, Body, Button, Caption, Card, Title } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { useTheme } from '../../theme';
import {
  WalkthroughAskSheet,
  WalkthroughPageViewer,
  WalkthroughPlanPanel,
  WalkthroughQuizSheet,
  clampPageIndex,
  DEFAULT_CHECK_EVERY_N,
  doneStorageKey,
  nextPageIndex,
  normalizeDone,
  PAGE_QUIZ_QUESTION_COUNT,
  pageAskPrompt,
  pageExcerpt,
  pageHeadings,
  pageQuizAvailability,
  pageText,
  pagesUnavailableCopy,
  prevPageIndex,
  progressLabel,
  shouldOfferCheck,
  toggleDone,
  type PageQuizQuestion,
  type WalkthroughPage,
  type WalkthroughReason,
} from '../../components/walkthrough';
import {
  fetchNote,
  fetchNoteAttachmentPages,
  generateDailyQuizFromContent,
} from '../../services/notes';
import { useCompanionStore } from '../../stores/companionStore';
import { requestFailureSentence } from '@lantern/shared/network';
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';

interface RouteParams {
  noteId: string;
  attachmentId: string;
  pageIndex?: number;
}

export function WalkthroughScreen() {
  const navigation = useNavigation<any>();
  const params = (useRoute().params || {}) as RouteParams;
  const { noteId, attachmentId } = params;
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const openCompanionWithMessage = useCompanionStore((s) => s.openWithMessage);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const scrollRef = useRef<ScrollView>(null);

  const [noteTitle, setNoteTitle] = useState('');
  const [pages, setPages] = useState<WalkthroughPage[]>([]);
  const [reason, setReason] = useState<WalkthroughReason>('ok');
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  // The thrown thing itself, not its message. `pagesUnavailableCopy` is the
  // only code allowed to turn a failure into words the student reads.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [missingDocument, setMissingDocument] = useState(false);

  const [pageIndex, setPageIndex] = useState(() =>
    typeof params.pageIndex === 'number' ? Math.max(0, Math.trunc(params.pageIndex)) : 0
  );
  const [done, setDone] = useState<number[]>([]);
  const [offeredChecks, setOfferedChecks] = useState<number[]>([]);

  const [planOpen, setPlanOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<PageQuizQuestion[]>([]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!noteId || !attachmentId) {
      setLoading(false);
      setMissingDocument(true);
      return;
    }
    setLoading(true);
    setMissingDocument(false);
    setLoadError(null);
    try {
      // Images are asked for here and only here: the page viewer wants them,
      // and a render failure server-side still answers with the text.
      const result = await fetchNoteAttachmentPages(noteId, attachmentId, { images: true });
      setAvailable(Boolean(result?.available));
      setReason((result?.reason || 'ok') as WalkthroughReason);
      setPages(Array.isArray(result?.pages) ? (result.pages as WalkthroughPage[]) : []);
    } catch (error) {
      setLoadError(error ?? new Error('The pages could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [noteId, attachmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The title is only for the heading and the AI prompt, so a failure here is
  // silent: a walk-through with an unnamed document still works.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const note = await fetchNote(noteId);
        if (!cancelled) setNoteTitle(note?.title || '');
      } catch {
        /* the heading falls back to "This document" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // ── Done marks ────────────────────────────────────────────────────────────

  const storageKey = useMemo(
    () => (noteId && attachmentId ? doneStorageKey(noteId, attachmentId) : null),
    [noteId, attachmentId]
  );

  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled || !raw) return;
        setDone(normalizeDone(JSON.parse(raw), 0));
      } catch {
        /* a corrupt value reads as no marks, never as a crash */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const persistDone = useCallback(
    (next: number[]) => {
      if (!storageKey) return;
      void AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
    },
    [storageKey]
  );

  // ── Derived ───────────────────────────────────────────────────────────────

  const pageCount = pages.length;
  const currentIndex = clampPageIndex(pageIndex, pageCount);
  const headings = useMemo(() => pageHeadings(pages), [pages]);
  const currentHeading = headings.find((h) => h.pageIndex === currentIndex);
  const currentPage = pages.find((p) => p.pageIndex === currentIndex);
  const currentText = pageText(pages, currentIndex);
  const quizVerdict = pageQuizAvailability(currentText);
  const isDone = done.includes(currentIndex);
  const pageLabel = `Page ${currentIndex + 1}${currentHeading?.isDerived ? ` · ${currentHeading.title}` : ''}`;

  const goToPage = useCallback(
    (index: number) => {
      setPageIndex(clampPageIndex(index, pages.length));
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    },
    [pages.length]
  );

  // ── The four doors ────────────────────────────────────────────────────────

  const openPlan = useCallback(() => setPlanOpen(true), []);
  const openAsk = useCallback(() => setAskOpen(true), []);

  /**
   * Hand this page to the reading screen.
   *
   * A plain push on the SAME stack, like the walk-through's own arrival, and
   * it carries the page: a student who pressed "read this to me" on page 12
   * means page 12, not page 1.
   */
  const openReading = useCallback(() => {
    navigation.navigate('Narration', {
      noteId,
      attachmentId,
      pageIndex: clampPageIndex(pageIndex, pages.length),
    });
  }, [navigation, noteId, attachmentId, pageIndex, pages.length]);

  const runPageQuiz = useCallback(async () => {
    const text = pageText(pages, clampPageIndex(pageIndex, pages.length));
    const verdict = pageQuizAvailability(text);
    if (!verdict.canQuiz) {
      // Said out loud rather than as a disabled control with no explanation —
      // the row's Quiz item cannot print a reason before the press.
      appAlert('Nothing to quiz here', verdict.reason || 'This page has no readable text.');
      return;
    }
    setQuizOpen(true);
    setQuizLoading(true);
    setQuizError(null);
    setQuizQuestions([]);
    try {
      const result = await generateDailyQuizFromContent(
        pageExcerpt(text),
        'retention',
        PAGE_QUIZ_QUESTION_COUNT
      );
      const questions = (result?.questions || []).map((q, index) => ({
        id: q.id || `page-q-${index}`,
        question: q.question || q.text || '',
        options: Array.isArray(q.options) ? q.options : undefined,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      }));
      setQuizQuestions(questions.filter((q) => q.question && q.correctAnswer));
    } catch (error) {
      // Never the server's own words: the sheet gets the app's failure
      // vocabulary, the same one every other failed request speaks.
      setQuizError(requestFailureSentence(error));
    } finally {
      setQuizLoading(false);
    }
  }, [pages, pageIndex]);

  const toggleCurrentDone = useCallback(() => {
    const index = clampPageIndex(pageIndex, pages.length);
    const next = toggleDone(done, index);
    const justMarkedDone = next.includes(index);
    setDone(next);
    persistDone(next);
    if (
      shouldOfferCheck({
        pageIndex: index,
        everyN: DEFAULT_CHECK_EVERY_N,
        justMarkedDone,
        offered: offeredChecks,
      })
    ) {
      setOfferedChecks((prev) => [...prev, index]);
      // An OFFER. Declining costs nothing and blocks nothing — the next page
      // is one tap away either way.
      appAlert(
        'Check what you have read?',
        `You have marked ${DEFAULT_CHECK_EVERY_N} pages done. Want a few questions on this page?`,
        [
          { text: 'Keep reading', style: 'cancel' },
          { text: 'Quiz me', onPress: () => void runPageQuiz() },
        ]
      );
    }
  }, [pageIndex, pages.length, done, persistDone, offeredChecks, runPageQuiz]);

  /**
   * The contextual row's four items (Plan · Ask · Quiz · Done).
   *
   * Plain functions, not memoised, for the same reason the note editor's are:
   * `useScreenActions` reads them through a ref on every render, so a handler
   * can never close over a stale page index.
   */
  useScreenActions('Walkthrough', {
    walkthroughPlan: openPlan,
    walkthroughAsk: openAsk,
    walkthroughQuiz: () => void runPageQuiz(),
    walkthroughDone: toggleCurrentDone,
  });

  const askAboutPage = useCallback(
    (question: string) => {
      setAskOpen(false);
      const index = clampPageIndex(pageIndex, pages.length);
      const prompt = pageAskPrompt({
        noteTitle: noteTitle || 'this document',
        pageIndex: index,
        heading: currentHeading?.isDerived ? currentHeading.title : undefined,
        text: pageText(pages, index),
        question,
      });
      // Attach the note so the reply lands on this note's thread, then queue
      // the question with its page scope. The scope rides with THIS send only:
      // on a note the student owns the server grounds the reply in that one
      // page (or in nothing, on a blank page) rather than the whole note.
      void (async () => {
        try {
          await setActiveNoteContext({ id: noteId, title: noteTitle || 'Untitled note' });
        } catch {
          /* the page text is still in the message; the thread just is not note-scoped */
        }
        openCompanionWithMessage(prompt, { attachmentId, pageIndex: index });
      })();
    },
    [
      openCompanionWithMessage,
      setActiveNoteContext,
      noteId,
      attachmentId,
      noteTitle,
      pageIndex,
      pages,
      currentHeading,
    ]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * The one card for every "there is nothing to walk through" ending.
   *
   * A thrown error and an `available: false` answer are the same event to the
   * student, so they are the same card: one honest sentence, and a button only
   * where pressing it could change the answer.
   */
  const failureCopy = missingDocument
    ? {
        title: 'No document to walk through',
        detail: 'This walk-through was opened without a document.',
        retryable: false,
        retryLabel: null,
      }
    : loadError != null
      ? pagesUnavailableCopy(loadError)
      : !loading && (!available || pageCount === 0)
        ? pagesUnavailableCopy({ reason })
        : null;

  return (
    <Screen edges={['top']} bottom="none" className="flex-1">
      <View className="px-4 pt-2 pb-3">
        <View className="flex-row items-center">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: -9, marginRight: 4 }} />
          <View className="flex-1 min-w-0">
            <Title numberOfLines={1}>{noteTitle || 'Walk me through'}</Title>
            {/* "No pages" under the title is a claim about the document. With
                nothing loaded we have not earned it, so the card below does
                the talking instead. */}
            {pageCount > 0 ? (
              <Caption tone="secondary">{progressLabel(done.length, pageCount)}</Caption>
            ) : null}
          </View>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : failureCopy ? (
        <View className="px-4">
          <Card>
            <Body style={{ fontWeight: '600' }}>{failureCopy.title}</Body>
            <Caption tone="secondary" className="mt-1">
              {failureCopy.detail}
            </Caption>
            {failureCopy.retryable ? (
              <Button size="sm" variant="secondary" className="mt-3 self-start" onPress={() => void load()}>
                {failureCopy.retryLabel || 'Try again'}
              </Button>
            ) : null}
          </Card>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding + 16 }}
        >
          <View className="flex-row items-center justify-between mb-2">
            <Caption tone="secondary" numberOfLines={1} className="flex-1 pr-2">
              {pageLabel}
            </Caption>
            {isDone ? (
              <View className="flex-row items-center gap-1">
                <AppIcon name="checkmark-circle" size={16} color={colors.success} />
                <Caption tone="secondary">Done</Caption>
              </View>
            ) : null}
          </View>

          <WalkthroughPageViewer page={currentPage} />

          <View className="flex-row flex-wrap gap-2 mt-4">
            <Button size="sm" variant="secondary" onPress={openPlan}>
              Plan
            </Button>
            <Button size="sm" variant="secondary" onPress={openAsk}>
              Ask about this page
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!quizVerdict.canQuiz}
              onPress={() => void runPageQuiz()}
            >
              {`Quiz me · ${formatCreditCost(AI_CREDIT_COSTS.generate_questions)}`}
            </Button>
            {/* The hand-over to the reading, carrying THE PAGE YOU ARE ON.
                Not a player embedded here: the walk-through is a place you
                read, the reading is a place you listen, and putting a voice
                inside the quiz-and-ask screen would leave two surfaces both
                claiming to own the page. Nothing is charged by pressing it —
                the reading screen prints the price and asks. */}
            <Button size="sm" variant="secondary" onPress={openReading}>
              Read this to me
            </Button>
            <Button size="sm" variant={isDone ? 'ghost' : 'primary'} onPress={toggleCurrentDone}>
              {isDone ? 'Mark not done' : 'Mark done'}
            </Button>
          </View>

          {!quizVerdict.canQuiz && quizVerdict.reason ? (
            <Caption tone="secondary" className="mt-2">
              {quizVerdict.reason}
            </Caption>
          ) : null}

          <View className="flex-row items-center justify-between mt-6">
            <Button
              size="sm"
              variant="secondary"
              disabled={prevPageIndex(currentIndex, pageCount) === null}
              onPress={() => {
                const prev = prevPageIndex(currentIndex, pageCount);
                if (prev !== null) goToPage(prev);
              }}
            >
              Previous
            </Button>
            <Caption tone="secondary">{`${currentIndex + 1} / ${pageCount}`}</Caption>
            <Button
              size="sm"
              variant="secondary"
              disabled={nextPageIndex(currentIndex, pageCount) === null}
              onPress={() => {
                const next = nextPageIndex(currentIndex, pageCount);
                if (next !== null) goToPage(next);
              }}
            >
              Next
            </Button>
          </View>
        </ScrollView>
      )}

      <WalkthroughPlanPanel
        visible={planOpen}
        headings={headings}
        currentIndex={currentIndex}
        done={done}
        progress={progressLabel(done.length, pageCount)}
        onSelect={(index) => {
          setPlanOpen(false);
          goToPage(index);
        }}
        onClose={() => setPlanOpen(false)}
      />

      <WalkthroughAskSheet
        visible={askOpen}
        pageLabel={pageLabel}
        hasPageText={currentText.trim().length > 0}
        onAsk={askAboutPage}
        onClose={() => setAskOpen(false)}
      />

      <WalkthroughQuizSheet
        visible={quizOpen}
        pageLabel={pageLabel}
        loading={quizLoading}
        error={quizError}
        questions={quizQuestions}
        onRetry={() => void runPageQuiz()}
        onClose={() => setQuizOpen(false)}
      />
    </Screen>
  );
}

export default WalkthroughScreen;
