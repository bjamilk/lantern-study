import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useNotesStore } from '../../stores/notesStore';
import type { NoteFolder, StudyNote } from '../../services/notes';
import { importYouTubeNote, uploadNotePdfViaApi, uploadPresentationViaApi } from '../../services/notes';
import { Button, Card, ScreenHeader } from '../../components/ui';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface Props {
  navigation: NavigationProp;
}

function sourceBadge(note: StudyNote): string {
  if (note.sourceType === 'youtube') return 'YouTube';
  if (note.sourceType === 'pdf') return 'PDF';
  if (note.sourceType === 'presentation') return 'Slides';
  if (note.sourceType === 'audio') return 'Audio';
  return 'Note';
}

function FolderChip({
  folder,
  isActive,
  onPress,
}: {
  folder: NoteFolder;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`shrink-0 px-3 py-2 rounded-lg flex-row items-center gap-1.5 ${
        isActive
          ? 'bg-indigo-500'
          : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600'
      }`}
    >
      {folder.color ? (
        <View className="w-2 h-2 rounded-full" style={{ backgroundColor: folder.color }} />
      ) : null}
      <Text
        className={`text-sm font-semibold ${
          isActive ? 'text-white' : 'text-slate-800 dark:text-slate-100'
        }`}
        numberOfLines={1}
      >
        {folder.name}
      </Text>
    </Pressable>
  );
}

function NoteCard({ note, onPress }: { note: StudyNote; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="mb-3 active:opacity-90">
      <Card className="border-slate-200 dark:border-slate-700">
        <View className="flex-row items-start justify-between gap-2 mb-2">
          <Text className="flex-1 text-base font-semibold text-slate-900 dark:text-slate-100" numberOfLines={2}>
            {note.title}
          </Text>
          <View className="bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full shrink-0">
            <Text className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-200">
              {sourceBadge(note)}
            </Text>
          </View>
        </View>
        <Text className="text-sm text-slate-600 dark:text-slate-400" numberOfLines={3}>
          {note.summary || note.body || 'Empty note'}
        </Text>
        {note.updatedAt ? (
          <Text className="text-xs text-slate-400 dark:text-slate-500 mt-3">
            Updated {new Date(note.updatedAt).toLocaleDateString()}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

export function NotesScreen({ navigation }: Props) {
  const {
    folders,
    notes,
    isLoading,
    error,
    selectedFolderId,
    loadFolders,
    loadNotes,
    createNote,
    createFolder,
    setSelectedFolderId,
    setError,
  } = useNotesStore();

  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [importingYoutube, setImportingYoutube] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  const loadData = useCallback(async () => {
    await Promise.all([loadFolders(), loadNotes(selectedFolderId || undefined)]);
  }, [loadFolders, loadNotes, selectedFolderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadNotes(selectedFolderId || undefined);
  }, [selectedFolderId, loadNotes]);

  const filteredNotes = useMemo(() => {
    let list = notes;
    if (selectedFolderId) {
      list = list.filter(n => n.folderId === selectedFolderId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
      );
    }
    return list;
  }, [notes, selectedFolderId, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCreateNote = async () => {
    const note = await createNote({
      title: 'Untitled Note',
      body: '',
      folderId: selectedFolderId || undefined,
    });
    navigation.navigate('NoteEditor', { noteId: note.id });
  };

  const handleCreateFolder = async () => {
    const name = `Folder ${folders.length + 1}`;
    await createFolder(name);
  };

  const handleYouTubeImport = async () => {
    const url = youtubeUrl.trim();
    if (!url) return;
    setImportingYoutube(true);
    setError(null);
    try {
      const note = await importYouTubeNote(url, selectedFolderId || undefined);
      setYoutubeUrl('');
      await loadNotes(selectedFolderId || undefined);
      navigation.navigate('NoteEditor', { noteId: note.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'YouTube import failed');
    } finally {
      setImportingYoutube(false);
    }
  };

  const handleFileImport = async (mode: 'pdf' | 'presentation') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type:
          mode === 'pdf'
            ? 'application/pdf'
            : [
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'application/vnd.ms-powerpoint',
              ],
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const fileName = asset.name || (mode === 'pdf' ? 'document.pdf' : 'slides.pptx');
      setImportingFile(true);
      setError(null);

      const base64Data = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
      const importResult =
        mode === 'pdf'
          ? await uploadNotePdfViaApi(fileName, base64Data, selectedFolderId || undefined)
          : await uploadPresentationViaApi(fileName, base64Data, selectedFolderId || undefined);

      await loadNotes(selectedFolderId || undefined);
      navigation.navigate('NoteEditor', { noteId: importResult.note.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImportingFile(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <ScreenHeader
        title="Notes"
        subtitle="Capture lectures and turn notes into study tools"
        className="pb-2"
        right={
          <View className="flex-row gap-1.5">
            <Button size="sm" variant="secondary" onPress={handleCreateFolder}>
              Folder
            </Button>
            <Button size="sm" onPress={handleCreateNote}>
              + Note
            </Button>
          </View>
        }
      />

      <View className="px-4 mb-1.5 flex-row items-center gap-1.5">
        <Button
          size="sm"
          variant={!selectedFolderId ? 'primary' : 'secondary'}
          onPress={() => setSelectedFolderId(null)}
        >
          All notes
        </Button>
        {folders.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerClassName="gap-1.5 items-center"
          >
            {folders.map(folder => (
              <FolderChip
                key={folder.id}
                folder={folder}
                isActive={selectedFolderId === folder.id}
                onPress={() => setSelectedFolderId(folder.id)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View className="mx-4 mb-1.5 flex-row items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <Ionicons name="search" size={16} color="#94a3b8" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search notes..."
          placeholderTextColor="#94a3b8"
          className="flex-1 text-sm text-slate-800 dark:text-slate-100 py-0.5"
        />
      </View>

      <View className="mx-4 mb-1.5 flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <Ionicons name="logo-youtube" size={16} color="#ef4444" />
          <TextInput
            value={youtubeUrl}
            onChangeText={setYoutubeUrl}
            placeholder="Paste YouTube URL..."
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            className="flex-1 text-sm text-slate-800 dark:text-slate-100 py-0.5"
          />
        </View>
        <Button size="sm" loading={importingYoutube} disabled={!youtubeUrl.trim()} onPress={() => void handleYouTubeImport()}>
          Import
        </Button>
      </View>

      <View className="mx-4 mb-1.5 flex-row flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={importingFile} onPress={() => void handleFileImport('pdf')}>
          Import PDF
        </Button>
        <Button size="sm" variant="secondary" loading={importingFile} onPress={() => void handleFileImport('presentation')}>
          Import PowerPoint
        </Button>
      </View>

      {error ? (
        <Pressable
          onPress={() => setError(null)}
          className="mx-4 mb-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800"
        >
          <Text className="text-xs text-red-700 dark:text-red-300">{error}</Text>
        </Pressable>
      ) : null}

      {isLoading && notes.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={filteredNotes}
          keyExtractor={item => item.id}
          contentContainerClassName="px-4 pb-8"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
          }
          ListEmptyComponent={
            <Card className="items-center py-10 border-slate-200 dark:border-slate-700">
              <Ionicons name="document-text-outline" size={40} color="#818cf8" />
              <Text className="text-sm text-slate-600 dark:text-slate-300 text-center mt-3 px-4">
                No notes yet. Create one to get started.
              </Text>
              <Button className="mt-4" size="sm" onPress={handleCreateNote}>
                New note
              </Button>
            </Card>
          }
          renderItem={({ item }) => (
            <NoteCard
              note={item}
              onPress={() => navigation.navigate('NoteEditor', { noteId: item.id })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

export default NotesScreen;
