import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { isCalendarNote, isLectureNote, materialsForStudySet, studySetLabel } from '@lantern/shared';
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
  const notes = useNotesStore((s) => s.notes);
  const decks = useFlashcardStore((s) => s.decks);

  useEffect(() => {
    void loadSets().catch(() => undefined);
  }, [loadSets]);

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between mb-1">
        <T.Caption tone="secondary">Your study sets</T.Caption>
        <Pressable onPress={onOpenHub} accessibilityRole="button" accessibilityLabel="All study sets">
          <T.Caption>All sets</T.Caption>
        </Pressable>
      </View>
      {sets.length === 0 ? (
        <FeatureRow
          feature="notes"
          icon="albums"
          title="Level up your library"
          subtitle="Name a set to keep notes and decks together"
          onPress={onOpenHub}
        />
      ) : (
        sets.slice(0, 4).map((set, index) => {
          const setNotes = materialsForStudySet(notes, set.id).filter((note) => !isCalendarNote(note));
          const setDecks = materialsForStudySet(decks, set.id);
          const lectures = setNotes.filter(isLectureNote).length;
          return (
            <View key={set.id} className={index > 0 ? 'border-t border-lantern-border' : undefined}>
              <FeatureRow
                feature="notes"
                icon="albums"
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
