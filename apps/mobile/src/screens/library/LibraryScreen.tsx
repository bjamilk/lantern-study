import React, { useEffect } from 'react';
import { View, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { featureAccents } from '@lantern/shared/design';
import { NotesScreen } from '../notes/NotesScreen';
import { FlashcardsScreen } from '../flashcards/FlashcardsScreen';
import { FeatureHero } from '../../components/ui';
import { useUIStore, type LibraryTab } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { refreshUserData } from '../../services/dataRefresh';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useTheme } from '../../theme';

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
  const userId = useAuthStore(s => s.user?.id);
  const decks = useFlashcardStore(s => s.decks);
  const notes = useNotesStore(s => s.notes);
  const { colors } = useTheme();
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

  // Decks and their due counts are only fetched at login bootstrap, so without
  // this a card reviewed on the web still reads as due here (and a deck created
  // elsewhere never appears) until the app is force-quit. Throttled internally.
  useFocusEffect(
    React.useCallback(() => {
      void refreshUserData(userId, { only: ['flashcards'] });
    }, [userId])
  );

  // Getting-started checklist: visiting the Library counts as "open library".
  useFocusEffect(
    React.useCallback(() => {
      const store = useFeatureTipStore.getState();
      if (!store.hydrated) {
        void store.hydrate().then(() => {
          useFeatureTipStore.getState().markChecklist('openLibrary');
        });
      } else {
        store.markChecklist('openLibrary');
      }
    }, [])
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 bg-lantern-background">
        <FeatureHero
          title="Library"
          subtitle="Notes and flashcard decks in one place"
          accentColor={featureAccents.library}
          right={<Ionicons name="library-outline" size={24} color={featureAccents.library} />}
          className="mb-2"
        >
          <View className="flex-row flex-wrap gap-2">
            <View className="px-2.5 py-1 rounded-full bg-lantern-primary-background">
              <Text className="text-xs font-medium text-lantern-primary">{notes.length} notes</Text>
            </View>
            <View className="px-2.5 py-1 rounded-full bg-lantern-accent-background">
              <Text className="text-xs font-medium text-lantern-accent">{decks.length} decks</Text>
            </View>
            {dueCardsCount > 0 ? (
              <View className="px-2.5 py-1 rounded-full bg-lantern-error/10">
                <Text className="text-xs font-medium text-lantern-error">{dueCardsCount} due</Text>
              </View>
            ) : null}
          </View>
        </FeatureHero>
        <View className="flex-row gap-1 border-b border-lantern-border mb-0">
          {tabs.map(({ id, label, icon }) => {
            const active = tab === id;
            return (
              <Pressable
                key={id}
                onPress={() => setLibraryTab(id)}
                className={`flex-row items-center gap-2 px-4 py-2.5 rounded-t-xl border border-b-0 min-h-[44px] ${
                  active
                    ? 'bg-lantern-surface border-lantern-border'
                    : 'border-transparent'
                }`}
                style={active ? { borderTopWidth: 3, borderTopColor: featureAccents.library } : undefined}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={icon}
                  size={16}
                  color={active ? featureAccents.library : colors.textTertiary}
                />
                <Text
                  className={`text-sm font-medium ${
                    active ? 'text-lantern-primary' : 'text-lantern-text-secondary'
                  }`}
                  style={active ? { color: featureAccents.library } : undefined}
                >
                  {label}
                </Text>
                {id === 'flashcards' && dueCardsCount > 0 ? (
                  <View className="bg-lantern-error min-w-[18px] h-[18px] px-1 rounded-full items-center justify-center">
                    <Text className="text-[10px] font-bold text-white">
                      {dueCardsCount > 99 ? '99+' : dueCardsCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View className="flex-1 min-h-0">
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
