import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import {
  isCalendarNote,
  isLectureNote,
  materialsForStudySet,
  STUDY_SET_TILE,
  studySetLabel,
} from '@lantern/shared';
import { Card, FeatureRow, T } from '../ui';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useStudySetStore } from '../../stores/studySetStore';

interface HomeStudySetsCardProps {
  onOpenSet: (studySetId: string, title?: string) => void;
  onOpenHub: () => void;
}

export function HomeStudySetsCard({ onOpenSet, onOpenHub }: HomeStudySetsCardProps) {
  const loadSets = useStudySetStore((s) => s.loadSets);
  const sets = useStudySetStore((s) => s.sets);
  const status = useStudySetStore((s) => s.status);
  const fromCache = useStudySetStore((s) => s.fromCache);
  const notes = useNotesStore((s) => s.notes);
  const decks = useFlashcardStore((s) => s.decks);

  useEffect(() => {
    void loadSets().catch(() => undefined);
  }, [loadSets]);

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between mb-1">
        <T.Caption tone="secondary">Your study sets</T.Caption>
        <View className="flex-row items-center gap-2">
          {/* The list is real, but it is the cached copy — say so rather than
              passing a stale list off as this minute's truth. */}
          {fromCache && sets.length > 0 ? (
            <T.Caption tone="secondary">{status === 'offline' ? 'Offline' : 'Saved copy'}</T.Caption>
          ) : null}
          <Pressable onPress={onOpenHub} accessibilityRole="button" accessibilityLabel="All study sets">
            <T.Caption>All sets</T.Caption>
          </Pressable>
        </View>
      </View>
      {sets.length === 0 ? (
        status === 'ready' ? (
          <FeatureRow
            // The study set's own identity, from the one place that owns it —
            // never `feature="notes"` again. A set is not a note: it is the box
            // notes, decks, tests and lectures are filed in, and painting it in
            // the notes hue is what made Home's list read as four notes.
            feature={STUDY_SET_TILE.feature}
            icon={STUDY_SET_TILE.icon}
            title="Level up your library"
            subtitle="Name a set to keep notes and decks together"
            onPress={onOpenHub}
          />
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
        sets.slice(0, 4).map((set, index) => {
          const setNotes = materialsForStudySet(notes, set.id).filter((note) => !isCalendarNote(note));
          const setDecks = materialsForStudySet(decks, set.id);
          const lectures = setNotes.filter(isLectureNote).length;
          return (
            <View key={set.id} className={index > 0 ? 'border-t border-lantern-border' : undefined}>
              <FeatureRow
                feature={STUDY_SET_TILE.feature}
                icon={STUDY_SET_TILE.icon}
                title={studySetLabel(set)}
                subtitle={`${setNotes.length} materials${lectures ? ` · ${lectures} lectures` : ''}${
                  setDecks.length ? ` · ${setDecks.length} cards` : ''
                }${set.lastStudiedAt ? ` · last studied` : ''}`}
                onPress={() => onOpenSet(set.id, set.title)}
              />
            </View>
          );
        })
      )}
    </Card>
  );
}
