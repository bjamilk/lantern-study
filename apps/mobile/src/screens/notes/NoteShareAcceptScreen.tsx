import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { acceptNoteShareLink, previewNoteShareLink } from '../../services/notes';
import { useNotesStore } from '../../stores/notesStore';
import { Button, Card } from '../../components/ui';
import { Screen } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type SharePreview = {
  noteId: string;
  title: string;
  role: 'viewer' | 'editor';
  owner?: { name?: string; username?: string };
  alreadyHasAccess?: boolean;
  currentAccessRole?: string;
  isOwner?: boolean;
};

interface Props {
  navigation: NavigationProp;
  route: { params: { token: string } };
}

export function NoteShareAcceptScreen({ navigation, route }: Props) {
  const { token } = route.params;
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadNotes = useNotesStore((state) => state.loadNotes);

  useEffect(() => {
    let active = true;
    void previewNoteShareLink(token)
      .then((result) => {
        if (active) setPreview(result as SharePreview);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'This share link is unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const result = (await acceptNoteShareLink(token)) as { note: { id: string } };
      await loadNotes();
      navigation.navigate('NoteEditor', { noteId: result.note.id });
    } catch (cause) {
      appAlert('Could not accept invite', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Screen>
      <View className="flex-row items-center px-4 py-3">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2" accessibilityLabel="Go back">
          <AppIcon name="arrow-back" size={24} color="#475569" />
        </Pressable>
        <Text className="ml-2 text-lg font-semibold text-lantern-text">Note invitation</Text>
      </View>
      <View className="flex-1 justify-center px-5">
        {loading ? (
          <ActivityIndicator size="large" color={brand.text} />
        ) : error ? (
          <Card className="items-center border-red-200">
            <AppIcon name="link" size={36} color="#ef4444" />
            <Text className="mt-3 text-center text-sm text-lantern-text">{error}</Text>
            <Button className="mt-4" size="sm" variant="secondary" onPress={() => navigation.goBack()}>
              Go back
            </Button>
          </Card>
        ) : preview ? (
          <Card className="border-lantern-primary/30">
            <AppIcon name="document-text" size={36} color={brand.text} />
            <Text className="mt-3 text-lg font-semibold text-lantern-text">{preview.title}</Text>
            <Text className="mt-2 text-sm text-lantern-text-secondary">
              {preview.owner?.name || preview.owner?.username || 'A Lantern Study member'} invited you as an{' '}
              {preview.role}.
            </Text>
            <Text className="mt-3 text-xs text-lantern-text-tertiary">
              {preview.role === 'editor'
                ? 'Editors can update this shared note.'
                : 'Viewers can read this shared note.'}
            </Text>
            {preview.alreadyHasAccess ? (
              <Button
                className="mt-5"
                size="sm"
                onPress={() => navigation.navigate('NoteEditor', { noteId: preview.noteId })}
              >
                Open note
              </Button>
            ) : (
              <Button className="mt-5" size="sm" loading={accepting} onPress={() => void handleAccept()}>
                Accept invitation
              </Button>
            )}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

export default NoteShareAcceptScreen;
