/**
 * "Your study sets" — a GRID of set cards with a progress bar, matching web's
 * `components/dashboard/HomeStudySets.tsx`.
 *
 * It used to be four `FeatureRow`s in a card, which read as a list of notes:
 * same disc, same two lines, no sense of a set being a thing you are partway
 * through. The grid gives each set its own card and, the part that matters,
 * a percentage — so Home answers "how far am I" without opening anything.
 *
 * The offline and cached states are kept exactly as they were, and they are
 * the reason this is still a `Card` wrapper rather than a bare grid: an
 * offline cold start must say "we have not been told yet", never "you have no
 * study sets". That distinction was hard-won and is not a layout detail.
 *
 * The percentage and the counts line are computed in `homeSections.ts`, where
 * they are tested — including the "1 materials · 2 cards" copy defect, which
 * is now "1 material · 2 decks".
 */
import React, { useCallback, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  isCalendarNote,
  isLectureNote,
  materialsForStudySet,
  STUDY_SET_TILE,
  studySetLabel,
} from '@lantern/shared';
import { Card, FeatureDisc, T } from '../ui';
import { useTheme } from '../../theme';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useStudySetStore } from '../../stores/studySetStore';
import {
  lastStudiedLabel,
  shouldRefetchSets,
  studySetCountsLabel,
  studySetProgress,
} from './homeSections';

interface HomeStudySetsCardProps {
  onOpenSet: (studySetId: string, title?: string) => void;
  onOpenHub: () => void;
  /** "New study set" — the create flow lives on the Study hub. */
  onNewSet?: () => void;
}

const MAX_SETS = 4;

/**
 * How stale the cached set list may be before Home refetches it on focus.
 *
 * The set room stamps `lastStudiedAt` when it opens, but Home renders from the
 * store's list, so coming back from a room showed the stamp Home loaded with
 * and "last studied" never appeared (Wave P device pass, defect 6). The store
 * belongs to another lane, so Home does the only half it owns: when it regains
 * focus with a list older than this, it asks for a fresh one. Short enough
 * that a round trip into a room and back always refreshes; long enough that
 * tab-flicking is not a fetch per tap.
 */
const SETS_MAX_AGE_MS = 30_000;

export function HomeStudySetsCard({ onOpenSet, onOpenHub, onNewSet }: HomeStudySetsCardProps) {
  const loadSets = useStudySetStore((s) => s.loadSets);
  const sets = useStudySetStore((s) => s.sets);
  const status = useStudySetStore((s) => s.status);
  const fromCache = useStudySetStore((s) => s.fromCache);
  const syncedAt = useStudySetStore((s) => s.syncedAt);
  const notes = useNotesStore((s) => s.notes);
  const decks = useFlashcardStore((s) => s.decks);
  const { colors } = useTheme();
  const startNew = onNewSet ?? onOpenHub;

  useEffect(() => {
    void loadSets().catch(() => undefined);
  }, [loadSets]);

  // Back on Home: refresh a stale list so a set studied in its room shows its
  // new "last studied" here. `force` because the list IS loaded — an unforced
  // call would return the same cached rows it already returned.
  useFocusEffect(
    useCallback(() => {
      if (!shouldRefetchSets({ syncedAt, now: Date.now(), maxAgeMs: SETS_MAX_AGE_MS })) return;
      void loadSets({ force: true }).catch(() => undefined);
    }, [loadSets, syncedAt])
  );

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <T.Caption tone="secondary">Your study sets</T.Caption>
        <View className="flex-row items-center gap-3">
          {/* The list is real, but it is the cached copy — say so rather than
              passing a stale list off as this minute's truth. */}
          {fromCache && sets.length > 0 ? (
            <T.Caption tone="secondary">{status === 'offline' ? 'Offline' : 'Saved copy'}</T.Caption>
          ) : null}
          <Pressable
            onPress={startNew}
            accessibilityRole="button"
            accessibilityLabel="New study set"
            testID="home-new-study-set"
          >
            <T.Caption>New study set</T.Caption>
          </Pressable>
          <Pressable onPress={onOpenHub} accessibilityRole="button" accessibilityLabel="All study sets">
            <T.Caption>All sets</T.Caption>
          </Pressable>
        </View>
      </View>

      {sets.length === 0 ? (
        status === 'ready' ? (
          <Pressable
            onPress={startNew}
            accessibilityRole="button"
            accessibilityLabel="Level up your library. Name a set to keep notes and decks together."
            className="flex-row items-center gap-3 py-2 active:opacity-80"
          >
            {/* The study set's own identity, from the one place that owns it —
                never `feature="notes"` again. A set is not a note: it is the box
                notes, decks, tests and lectures are filed in, and painting it in
                the notes hue is what made Home's list read as four notes. */}
            <FeatureDisc feature={STUDY_SET_TILE.feature} icon={STUDY_SET_TILE.icon} size={32} />
            <View className="flex-1 min-w-0">
              <T.Body style={{ fontWeight: '600' }}>Level up your library</T.Body>
              <T.Caption tone="secondary">
                Name a set to keep notes and decks together
              </T.Caption>
            </View>
          </Pressable>
        ) : (
          // Not "you have no sets" — "we have not been told yet". An offline
          // cold start with nothing cached must not invite a student with four
          // sets to start their library.
          <T.Caption tone="secondary">
            {status === 'loading'
              ? 'Loading your study sets…'
              : status === 'offline'
              ? "You're offline — your sets will appear when you reconnect."
              : "Couldn't load your study sets. Pull down to try again."}
          </T.Caption>
        )
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {sets.slice(0, MAX_SETS).map((set) => {
            const setNotes = materialsForStudySet(notes, set.id).filter((note) => !isCalendarNote(note));
            const setDecks = materialsForStudySet(decks, set.id);
            const counts = {
              materials: setNotes.length,
              lectures: setNotes.filter(isLectureNote).length,
              decks: setDecks.length,
            };
            const studiedLabel = lastStudiedLabel(set.lastStudiedAt, Date.now());
            const progress = studySetProgress({
              counts,
              hasExamDate: Boolean((set.examDate || '').trim()),
              studied: Boolean(set.lastStudiedAt),
            });
            return (
              <Pressable
                key={set.id}
                onPress={() => onOpenSet(set.id, set.title)}
                accessibilityRole="button"
                accessibilityLabel={`${studySetLabel(set)}. ${studySetCountsLabel(counts)}. ${
                  progress.basis === 'plan'
                    ? `${progress.percent} percent complete`
                    : `${progress.percent} percent set up`
                }${studiedLabel ? `. ${studiedLabel}` : ''}`}
                testID={`home-study-set-${set.id}`}
                // flexBasis rather than a Tailwind arbitrary percentage: a 2-up
                // wrap RN understands on both platforms.
                style={{ flexBasis: '47%', flexGrow: 1 }}
                className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-3 active:opacity-80"
              >
                <FeatureDisc feature={STUDY_SET_TILE.feature} icon={STUDY_SET_TILE.icon} size={32} />
                <T.Body style={{ fontWeight: '600' }} numberOfLines={1} className="mt-2">
                  {studySetLabel(set)}
                </T.Body>
                <T.Caption tone="secondary" numberOfLines={1}>
                  {studySetCountsLabel(counts)}
                </T.Caption>
                <View
                  // A bar can only ever be full: the percent is already clamped
                  // in homeSections.ts, so no ratio reaches the geometry raw.
                  style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}
                  className="mt-2 overflow-hidden"
                  importantForAccessibility="no-hide-descendants"
                >
                  <View
                    style={{
                      width: `${progress.percent}%`,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.primaryText,
                    }}
                  />
                </View>
                {/* Only when the set HAS been studied: "Last studied never" is
                    a line that tells a student off for a set they just made. */}
                {studiedLabel ? (
                  <T.Caption tone="tertiary" numberOfLines={1} className="mt-1">
                    {studiedLabel}
                  </T.Caption>
                ) : null}
                <T.Caption tone="tertiary" numberOfLines={1} className="mt-1">
                  {/* The fallback is set-up progress, not mastery, and says so
                      — a 75% that means "three of the four things a set needs"
                      must never be read as "three quarters learnt". */}
                  {progress.basis === 'plan'
                    ? `${progress.percent}% complete`
                    : `${progress.percent}% set up`}
                </T.Caption>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}
