import React, { useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotesScreen } from '../notes/NotesScreen';
import { FlashcardsScreen } from '../flashcards/FlashcardsScreen';
import { ScreenHeader } from '../../components/ui';

type Tab = 'notes' | 'flashcards';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { tab?: Tab } };
}

export function LibraryScreen({ navigation, route }: Props) {
  const [tab, setTab] = useState<Tab>(route?.params?.tab ?? 'notes');

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <View className="px-4 pt-2 pb-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <ScreenHeader title="Library" subtitle="Notes and flashcard decks" />
        <View className="flex-row gap-2 mt-2">
          {(['notes', 'flashcards'] as Tab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-lg items-center ${
                tab === t ? 'bg-indigo-500' : 'bg-slate-100 dark:bg-slate-800'
              }`}
            >
              <Text className={`text-sm font-semibold capitalize ${tab === t ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="flex-1">
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
