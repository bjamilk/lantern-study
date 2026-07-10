import React, { useEffect } from 'react';
import { View, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { NotesScreen } from '../notes/NotesScreen';
import { FlashcardsScreen } from '../flashcards/FlashcardsScreen';
import { ScreenHeader } from '../../components/ui';
import { useUIStore, type LibraryTab } from '../../stores/uiStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';

type Tab = LibraryTab;

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { tab?: Tab } };
}

const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'notes', label: 'Notes', icon: 'document-text-outline' },
  { id: 'flashcards', label: 'Flashcards', icon: 'layers-outline' },
];

export function LibraryScreen({ navigation, route }: Props) {
  const tab = useUIStore(s => s.libraryTab);
  const setLibraryTab = useUIStore(s => s.setLibraryTab);
  const decks = useFlashcardStore(s => s.decks);
  const notes = useNotesStore(s => s.notes);
  const dueCardsCount = decks.reduce((sum, d) => sum + (d.due_count || 0), 0);

  useEffect(() => {
    const paramTab = route?.params?.tab;
    if (paramTab === 'notes' || paramTab === 'flashcards') {
      setLibraryTab(paramTab);
    }
  }, [route?.params?.tab, setLibraryTab]);

  useFocusEffect(
    React.useCallback(() => {
      const paramTab = route?.params?.tab;
      if (paramTab === 'notes' || paramTab === 'flashcards') {
        setLibraryTab(paramTab);
      }
    }, [route?.params?.tab, setLibraryTab])
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 border-b border-lantern-border bg-lantern-surface">
        <ScreenHeader
          title="Library"
          subtitle="Notes and flashcard decks in one place"
          className="pb-2"
        />
        <View className="flex-row gap-1 mb-0">
          {tabs.map(({ id, label, icon }) => {
            const active = tab === id;
            return (
              <Pressable
                key={id}
                onPress={() => setLibraryTab(id)}
                className={`flex-row items-center gap-2 px-4 py-2.5 rounded-t-xl border border-b-0 ${
                  active
                    ? 'bg-lantern-background border-lantern-border'
                    : 'border-transparent'
                }`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={icon}
                  size={16}
                  color={active ? '#4f46e5' : '#64748b'}
                />
                <Text
                  className={`text-sm font-medium ${
                    active ? 'text-lantern-primary' : 'text-lantern-text-secondary'
                  }`}
                >
                  {label}
                </Text>
                {id === 'flashcards' && dueCardsCount > 0 ? (
                  <View className="min-w-[18px] h-[18px] px-1 rounded-full bg-lantern-error items-center justify-center">
                    <Text className="text-[10px] font-bold text-white">
                      {dueCardsCount > 99 ? '99+' : dueCardsCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row flex-wrap gap-2 pb-2">
          <View className="px-2.5 py-1 rounded-full bg-lantern-primary-background">
            <Text className="text-xs font-medium text-lantern-primary">{notes.length} notes</Text>
          </View>
          <View className="px-2.5 py-1 rounded-full bg-lantern-accent-background">
            <Text className="text-xs font-medium text-lantern-accent">{decks.length} decks</Text>
          </View>
        </View>
      </View>
      <View className="flex-1 bg-lantern-background">
        {tab === 'notes' ? (
          <NotesScreen navigation={navigation} embedded />
        ) : (
          <FlashcardsScreen navigation={navigation} embedded />
        )}
      </View>
    </SafeAreaView>
  );
}

export default LibraryScreen;
