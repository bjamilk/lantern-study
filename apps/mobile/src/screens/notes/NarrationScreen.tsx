// ===========================================
// Lantern Study Mobile - Read it to me
// ===========================================

/**
 * A document, read out loud by the phone.
 *
 * There is no audio file anywhere in this feature and no server voice. The
 * server writes a SCRIPT — one spoken paragraph per page — and `expo-speech`
 * says it on the device. That is what makes a reading free to replay, playable
 * with no signal, and about four kilobytes instead of nine megabytes.
 *
 * Four decisions this screen makes, each one a place it could have gone wrong:
 *
 * 1. GENERATING IS A JOB, PLAYING IS NOT. Writing the script is the single
 *    metered action, and it runs through the Wave G job system like every other
 *    generation: the student can leave, the work survives, a notification lands.
 *    Playing costs nothing and touches nothing but the device.
 * 2. A SCRIPT IS FETCHED BEFORE IT IS BOUGHT. The screen always asks what
 *    already exists first — from the device, then from the server — so a
 *    document that has been read once is never paid for twice, whichever
 *    platform paid the first time.
 * 3. THE SCRIPT IS KEPT, THE PICTURES ARE NOT. The script is written to
 *    AsyncStorage the moment it lands, so a replay works offline. Page images
 *    arrive as short-lived signed URLs and are deliberately NOT stored — a
 *    frozen signed URL is the bug the chat photos already taught us. Offline
 *    therefore means "the words, and the page text", and the frame says so.
 * 4. `not_generated` IS A STATE, NOT AN ERROR. So is a server without the
 *    migration. Neither is rendered as a failure.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { BackButton, Body, Button, Caption, Card, Title } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { useTheme } from '../../theme';
import {
  NarrationPlayer,
  narrationTitle,
  narrationUnavailableCopy,
} from '../../components/narration';
import {
  fetchNarrationScript,
  readCachedScript,
  requestNarrationScript,
  writeCachedScript,
  type NarrationReason,
  type NarrationScriptResult,
  type NarrationScriptSegment,
} from '../../services/narration';
import { fetchNote, fetchNoteAttachmentPages } from '../../services/notes';
import { useJobsStore } from '../../stores/jobsStore';
import { saveNarrationScript } from '../../services/jobArtifacts';
import {
  MAX_NARRATION_PAGES,
  formatCreditCost,
  formatNarrationPrice,
  getNarrationCreditCost,
} from '@lantern/shared/utils/aiCredits';

interface RouteParams {
  noteId: string;
  attachmentId: string;
  /** Where the walk-through was standing when it handed over. */
  pageIndex?: number;
}

export function NarrationScreen() {
  const navigation = useNavigation<any>();
  const params = (useRoute().params || {}) as RouteParams;
  const { noteId, attachmentId } = params;
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const startJob = useJobsStore((state) => state.startJob);

  const [noteTitle, setNoteTitle] = useState('');
  const [script, setScript] = useState<NarrationScriptResult | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string | undefined>>({});
  const [pageTexts, setPageTexts] = useState<Record<number, string | undefined>>({});
  const [documentPageCount, setDocumentPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /**
   * The job writing this script, if this screen started one.
   *
   * The screen does not track "am I generating" itself: the job store already
   * knows, it survives this screen being left and come back to, and a second
   * source of truth for the same fact is how a button ends up spinning forever
   * over work that finished.
   */
  const [jobId, setJobId] = useState<string | null>(null);
  const trackedJob = useJobsStore((state) =>
    jobId ? state.jobs.find((job) => job.id === jobId) : undefined
  );
  const generating = trackedJob?.status === 'queued' || trackedJob?.status === 'running';

  /* ------------------------------------------------------------- load -- */

  const load = useCallback(async () => {
    if (!noteId || !attachmentId) {
      setLoading(false);
      setLoadError('This reading was opened without a document.');
      return;
    }
    setLoading(true);
    setLoadError(null);

    // The device's copy first, so an offline open plays immediately instead of
    // sitting behind a request that is going to fail.
    const cached = await readCachedScript(attachmentId);
    if (cached) setScript(cached);

    try {
      const fresh = await fetchNarrationScript(noteId, attachmentId);
      setScript(fresh);
      setOffline(false);
      if (fresh.segments.length) void writeCachedScript(fresh);
    } catch (error) {
      // A cached script makes a network failure a non-event: the student is
      // told they are offline, and the reading plays.
      if (cached) setOffline(true);
      else setLoadError(error instanceof Error ? error.message : 'This reading could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [noteId, attachmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pictures and page text, asked for once and never cached. A failure here is
  // silent on purpose: the reading works without them, and an error over a
  // player that is about to speak would be noise.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchNoteAttachmentPages(noteId, attachmentId, { images: true });
        if (cancelled) return;
        const images: Record<number, string | undefined> = {};
        const texts: Record<number, string | undefined> = {};
        for (const page of result?.pages || []) {
          images[page.pageIndex] = page.imageUrl;
          texts[page.pageIndex] = page.text;
        }
        setPageImages(images);
        setPageTexts(texts);
        setDocumentPageCount(result?.pageCount || 0);
      } catch {
        /* the reading is the words; the pictures are a bonus */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId, attachmentId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const note = await fetchNote(noteId);
        if (!cancelled) setNoteTitle(note?.title || '');
      } catch {
        /* the heading falls back to "this document" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  /* --------------------------------------------------------- generate -- */

  const segments: NarrationScriptSegment[] = useMemo(
    () => (script?.segments || []).slice().sort((a, b) => a.order - b.order),
    [script]
  );
  const hasScript = segments.length > 0;

  const handleGenerate = useCallback(() => {
    if (generating || hasScript) return;
    const sourceTitle = noteTitle || 'This document';
    const startedId = startJob({
      kind: 'narration',
      sourceTitle,
      run: async ({ jobId, onServerJob, onStage }) => {
        const result = await requestNarrationScript(noteId, attachmentId, {
          clientJobId: jobId,
          onJobId: onServerJob,
        });
        if (!result.segments.length) {
          throw new Error('There was nothing readable in this document.');
        }
        onStage('Saving the reading');
        // Held on the device before the job settles, so the reading is
        // playable the moment the sheet says it is ready — including with no
        // signal at all.
        const { ref, saved } = await saveNarrationScript({
          jobId,
          noteId,
          noteTitle: sourceTitle,
          result,
        });
        setScript(result);
        return { artifact: ref, resultCount: saved };
      },
    });
    setJobId(startedId);
  }, [generating, hasScript, noteTitle, noteId, attachmentId, startJob]);

  // A job that failed leaves the offer standing; one that landed while the
  // screen was open has already set the script. Either way the screen re-reads
  // rather than guessing, which is also how a script bought on the web arrives.
  useEffect(() => {
    if (trackedJob?.status === 'done' && !hasScript) void load();
  }, [trackedJob?.status, hasScript, load]);

  /* ------------------------------------------------------------- view -- */

  const reason: NarrationReason = script?.reason ?? 'not_generated';
  const unavailable = narrationUnavailableCopy(reason);
  const pagesForPrice = documentPageCount || script?.pageCount || 0;
  const priceLine = pagesForPrice
    ? formatNarrationPrice(pagesForPrice)
    : `${formatCreditCost(getNarrationCreditCost(0))} — covers up to ${MAX_NARRATION_PAGES} pages`;

  return (
    <Screen bottom="none">
      <View className="px-4 pt-2 flex-row items-center gap-2">
        <BackButton onPress={() => navigation.goBack()} />
        <Title numberOfLines={1} className="flex-1">
          {narrationTitle(noteTitle)}
        </Title>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPadding }}
      >
        {loading && !hasScript ? (
          <View className="py-12 items-center">
            <ActivityIndicator color={colors.primary} />
            <Caption tone="secondary" className="mt-3">
              Looking for this document's reading…
            </Caption>
          </View>
        ) : loadError ? (
          <Card className="border-lantern-border">
            <Body>{loadError}</Body>
            <Button className="mt-3" variant="secondary" onPress={() => void load()}>
              Try again
            </Button>
          </Card>
        ) : hasScript ? (
          <>
            {offline ? (
              <View className="flex-row items-center gap-2 mb-3 p-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface">
                <AppIcon name="cloud-offline" size={18} color={colors.textSecondary} />
                <Caption tone="secondary" className="flex-1">
                  Offline — playing the copy on this phone. Page pictures need a
                  connection.
                </Caption>
              </View>
            ) : null}
            <NarrationPlayer
              segments={segments}
              pageCount={script?.pageCount || documentPageCount}
              pageImages={pageImages}
              pageTexts={pageTexts}
              initialPageIndex={params.pageIndex}
            />
          </>
        ) : (
          <Card className="border-lantern-border">
            <View className="flex-row items-center gap-2 mb-1">
              <AppIcon name="volume-medium" size={20} color={colors.textSecondary} />
              <Body style={{ fontWeight: '600' }}>{unavailable.title}</Body>
            </View>
            <Caption tone="secondary">{unavailable.detail}</Caption>
            {unavailable.canGenerate ? (
              <>
                <Caption tone="secondary" className="mt-3">
                  {priceLine}
                </Caption>
                <Caption tone="secondary" className="mt-1">
                  Charged once. Playing it again, skipping pages and listening
                  offline all cost nothing.
                </Caption>
                <Button className="mt-3" disabled={generating} onPress={handleGenerate}>
                  Read it to me
                </Button>
              </>
            ) : null}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

export default NarrationScreen;
