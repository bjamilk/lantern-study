import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  assertNoteUploadSize,
  formatFileSize,
  formatMaxNoteUploadLabel,
} from '@lantern/shared/utils/noteUpload';
import { useNotesStore } from '../../stores/notesStore';
import type { NoteFolder, StudyNote } from '../../services/notes';
import { uploadNotePdfViaApi, uploadPresentationViaApi } from '../../services/notes';
import { Button, Card, ScreenHeader } from '../../components/ui';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface Props {
  navigation: NavigationProp;
  embedded?: boolean;
}

type PendingImport = {
  uri: string;
  name: string;
  size: number;
  mode: 'pdf' | 'presentation';
};

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

export function NotesScreen({ navigation, embedded = false }: Props) {
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
  const [importingFile, setImportingFile] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

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

  const handlePickFile = async (mode: 'pdf' | 'presentation') => {
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
      const size = asset.size ?? 0;

      try {
        assertNoteUploadSize(size, fileName);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'File is too large');
        return;
      }

      setPendingImport({ uri: asset.uri, name: fileName, size, mode });
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open file picker');
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    try {
      setImportingFile(true);
      setError(null);

      const importResult =
        pendingImport.mode === 'pdf'
          ? await uploadNotePdfViaApi(
              pendingImport.uri,
              pendingImport.name,
              selectedFolderId || undefined
            )
          : await uploadPresentationViaApi(
              pendingImport.uri,
              pendingImport.name,
              selectedFolderId || undefined
            );

      setPendingImport(null);
      await loadNotes(selectedFolderId || undefined);
      navigation.navigate('NoteEditor', { noteId: importResult.note.id });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImportingFile(false);
    }
  };

  const Wrapper = embedded ? View : SafeAreaView;
  const wrapperProps = embedded ? { className: 'flex-1 bg-slate-50 dark:bg-slate-900' } : { className: 'flex-1 bg-slate-50 dark:bg-slate-900', edges: ['top'] as const };

  return (
    <Wrapper {...wrapperProps}>
      {!embedded && (
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
      )}

      <View className="px-4 mb-1.5 flex-row items-center gap-1.5">
        <Pressable
          onPress={() => setSelectedFolderId(null)}
          className={`shrink-0 px-2.5 py-2 rounded-lg ${
            !selectedFolderId
              ? 'bg-indigo-500'
              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600'
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              !selectedFolderId ? 'text-white' : 'text-slate-800 dark:text-slate-100'
            }`}
            numberOfLines={1}
          >
            All notes
          </Text>
        </Pressable>
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

      <View className="mx-4 mb-1.5">
        <Text className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          {formatMaxNoteUploadLabel()}
        </Text>
        {pendingImport ? (
          <Card className="border-indigo-200 dark:border-indigo-800 mb-2">
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100" numberOfLines={2}>
              {pendingImport.name}
            </Text>
            <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {formatFileSize(pendingImport.size)} · {formatMaxNoteUploadLabel()}
            </Text>
            <View className="flex-row gap-2 mt-3">
              <Button
                size="sm"
                loading={importingFile}
                onPress={() => void handleConfirmImport()}
                className="flex-1"
              >
                Upload
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={importingFile}
                onPress={() => setPendingImport(null)}
                className="flex-1"
              >
                Cancel
              </Button>
            </View>
          </Card>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={importingFile} onPress={() => void handlePickFile('pdf')}>
              Import PDF
            </Button>
            <Button size="sm" variant="secondary" disabled={importingFile} onPress={() => void handlePickFile('presentation')}>
              Import PowerPoint
            </Button>
          </View>
        )}
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
    </Wrapper>
  );
}

export default NotesScreen;
