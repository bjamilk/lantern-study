/**
 * Set settings on the phone — the web modal's fields, as a screen.
 *
 * Everything here was web-only: a set made on the phone could never be
 * renamed, described, made public, moved into a folder, given a study mode, or
 * deleted from the phone at all. The PATCH is the same one web sends.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  STUDY_SET_DESCRIPTION_MAX,
  STUDY_SET_MODES,
  STUDY_SET_TITLE_MAX,
  isValidStudySetTitle,
  normalizeStudySetTitle,
} from '@lantern/shared';
import type { StudySetMode } from '@lantern/shared/learning';
import type { StudyStackParamList } from '../../navigation/types';
import { AppIcon, Button, Card, ScreenHeader, T } from '../../components/ui';
import { CoverFailureLine, useCoverPicker } from '../../components/ui/CoverPicker';
import {
  MAX_STUDY_SET_COVER_BYTES,
  STUDY_SET_COVER_HINT,
} from '../../components/ui/coverPickerModel';
import { SetCoverSquare } from '../../components/study/SetCoverSquare';
import { setTileArt } from '../../components/study/setPresentation';
import { setTileSkin } from '../../components/study/setTileColors';
import { TILE_ICONS } from '../../components/study/StudySetCard';
import { useTheme } from '../../theme';
import { appAlert, confirmAsync } from '../../components/ui/appDialog';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';

type Props = NativeStackScreenProps<StudyStackParamList, 'StudySetSettings'>;

type Visibility = 'private' | 'public';

export function StudySetSettingsScreen({ navigation, route }: Props) {
  const { studySetId } = route.params;
  const studySet = useStudySetStore((s) => s.resolveSet(studySetId));
  const loadSets = useStudySetStore((s) => s.loadSets);
  const updateSet = useStudySetStore((s) => s.updateSet);
  const removeSet = useStudySetStore((s) => s.removeSet);
  const folders = useStudySetStore((s) => s.folders);
  const loadFolders = useStudySetStore((s) => s.loadFolders);
  const setCoverPath = useStudySetStore((s) => s.setCoverPath);
  const showToast = useToastStore((s) => s.showToast);
  const tabBarClearance = useTabBarClearance(16);
  const { isDark } = useTheme();

  /**
   * The set's picture, StudyFetch's way: ONE button into the system photo
   * picker, and Remove only once there is something to remove. No camera row
   * (the reference's block has none) and no sheet in front of a button that
   * already says what it does.
   *
   * The cover is applied the moment it is chosen, not on Save: the upload is
   * its own request against its own route, so making it wait for the text
   * fields would leave a student who pressed Back with a picture the server
   * had already stored.
   */
  const cover = useCoverPicker(
    { kind: 'study-set', id: studySetId },
    {
      hasCover: Boolean(studySet?.coverPath),
      allowCamera: false,
      maxBytes: MAX_STUDY_SET_COVER_BYTES,
      onApplied: (coverPath) => {
        setCoverPath(studySetId, coverPath);
        showToast(coverPath ? 'Set picture updated.' : 'Set picture removed.', 'success');
      },
    }
  );

  // The same art the hub card draws, so the preview IS the tile being replaced
  // rather than a generic placeholder standing in for it.
  const tileArt = setTileArt(studySetId, studySet?.title || '');
  const tileSkin = setTileSkin(tileArt.hue, isDark);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [mode, setMode] = useState<StudySetMode>('standard');
  const [folderId, setFolderId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // The fields are seeded once per set, not on every render of `studySet`:
  // re-seeding from the store would wipe what is being typed the moment any
  // other screen refreshed the list.
  const [seededFor, setSeededFor] = useState<string | null>(null);

  useEffect(() => {
    void loadSets().catch(() => undefined);
    void loadFolders().catch(() => undefined);
  }, [loadSets, loadFolders]);

  useEffect(() => {
    if (!studySet || seededFor === studySet.id) return;
    setTitle(studySet.title ?? '');
    setDescription(studySet.description ?? '');
    setVisibility(studySet.visibility === 'public' ? 'public' : 'private');
    setMode((studySet.mode as StudySetMode) ?? 'standard');
    setFolderId(studySet.folderId ?? '');
    setSeededFor(studySet.id);
  }, [studySet, seededFor]);

  const dirty = useMemo(() => {
    if (!studySet) return false;
    return (
      normalizeStudySetTitle(title) !== (studySet.title ?? '') ||
      (description.trim() || '') !== (studySet.description ?? '') ||
      visibility !== (studySet.visibility === 'public' ? 'public' : 'private') ||
      mode !== ((studySet.mode as StudySetMode) ?? 'standard') ||
      folderId !== (studySet.folderId ?? '')
    );
  }, [studySet, title, description, visibility, mode, folderId]);

  /**
   * Leaving with unsaved edits used to lose them in silence: the device pass
   * changed description, visibility and mode, pressed Back, and every edit was
   * gone with nothing said. Same `beforeRemove` guard the study screens use
   * (hooks/useConfirmBeforeExit), written out here because Save itself has to
   * leave — and it leaves in the same tick as the store write, before React has
   * re-rendered `dirty` to false, so the guard needs a bypass the hook has no
   * way to express.
   */
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const leavingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (leavingRef.current || !dirtyRef.current) return;
      e.preventDefault();
      appAlert(
        'Discard changes?',
        'Your edits to this set have not been saved yet.',
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              leavingRef.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation]);

  const save = async () => {
    const next = normalizeStudySetTitle(title);
    if (!isValidStudySetTitle(next)) {
      showToast(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer.`, 'error');
      return;
    }
    setSaving(true);
    try {
      await updateSet(studySetId, {
        title: next,
        description: description.trim() || null,
        visibility,
        mode,
        folderId: folderId || null,
      });
      showToast('Study set updated.', 'success');
      leavingRef.current = true;
      navigation.goBack();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update this set.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmAsync(
      'Delete this set?',
      'Your notes, decks and tests stay — they are just no longer filed here.',
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await removeSet(studySetId);
      showToast('Study set deleted.', 'success');
      // The set is gone; there are no edits left to rescue, so do not ask.
      leavingRef.current = true;
      navigation.navigate('StudyHub');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete this set.', 'error');
    }
  };

  if (!studySet) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
        <ScreenHeader title="Set settings" onBack={() => navigation.goBack()} />
        <View className="px-4">
          <T.Body tone="secondary">This set is not on this device yet. Pull to refresh on Study.</T.Body>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: 16, paddingTop: 8 }}
      >
        <ScreenHeader title="Set settings" onBack={() => navigation.goBack()} />

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Study set picture
          </T.Caption>
          <View className="flex-row items-center gap-3">
            <SetCoverSquare
              coverPath={studySet.coverPath}
              pendingUri={cover.pendingUri}
              size={44}
              radius={14}
              accessibilityLabel={`${studySet.title} picture`}
              fallback={
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: tileSkin.tint,
                  }}
                  className="items-center justify-center"
                  importantForAccessibility="no-hide-descendants"
                >
                  <AppIcon name={TILE_ICONS[tileArt.glyph]} size={22} color={tileSkin.ink} />
                </View>
              }
            />
            <View className="flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Button size="sm" onPress={cover.choose} disabled={cover.busy}>
                  {cover.busy ? 'Uploading…' : 'Upload picture'}
                </Button>
                {studySet.coverPath ? (
                  <Pressable
                    onPress={cover.remove}
                    disabled={cover.busy}
                    accessibilityRole="button"
                    accessibilityLabel="Remove picture"
                    hitSlop={8}
                  >
                    <T.Caption className="text-red-600 dark:text-red-300">Remove picture</T.Caption>
                  </Pressable>
                ) : null}
              </View>
              <T.Caption tone="tertiary" className="mt-1">
                {STUDY_SET_COVER_HINT}
              </T.Caption>
            </View>
          </View>
          <CoverFailureLine failure={cover.failure} onDismiss={cover.dismissFailure} />
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-1">
            Name
          </T.Caption>
          <TextInput
            value={title}
            onChangeText={(value) => setTitle(value.slice(0, STUDY_SET_TITLE_MAX))}
            placeholder="Study set name"
            placeholderTextColor="#94a3b8"
            maxLength={STUDY_SET_TITLE_MAX}
            accessibilityLabel="Study set name"
            className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface"
          />
          <T.Caption tone="secondary" className="mt-3 mb-1">
            Description
          </T.Caption>
          <TextInput
            value={description}
            onChangeText={(value) => setDescription(value.slice(0, STUDY_SET_DESCRIPTION_MAX))}
            placeholder="What is this set for?"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={3}
            accessibilityLabel="Study set description"
            className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface min-h-[80px]"
            style={{ textAlignVertical: 'top' }}
          />
          <T.Caption tone="tertiary" className="mt-1">
            {description.length}/{STUDY_SET_DESCRIPTION_MAX}
          </T.Caption>
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Who can see it
          </T.Caption>
          <View className="flex-row flex-wrap gap-2">
            {(['private', 'public'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setVisibility(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === value }}
                className={`px-3 py-2 rounded-full border ${
                  visibility === value
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : 'border-lantern-border'
                }`}
              >
                <T.Caption>{value === 'private' ? 'Private' : 'Public'}</T.Caption>
              </Pressable>
            ))}
          </View>
          <T.Caption tone="tertiary" className="mt-2">
            {/* Was "Anyone with the link can open this set." That is not true:
                `visibility` is written to the row and never read — the SELECT
                policy on study_sets is owner-only — so a public set is still
                openable by nobody but its owner. */}
            {visibility === 'public'
              ? 'Marked public, but set sharing is not built yet — only you can open it.'
              : 'Only you can open this set.'}
          </T.Caption>
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Study mode
          </T.Caption>
          <View className="gap-2">
            {STUDY_SET_MODES.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setMode(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === item.id }}
                accessibilityLabel={`${item.label}. ${item.promise}`}
                className={`px-3 py-2.5 rounded-xl border ${
                  mode === item.id
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : 'border-lantern-border'
                }`}
              >
                <T.Body>{item.label}</T.Body>
                <T.Caption tone="secondary">{item.promise}</T.Caption>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Folder
          </T.Caption>
          {folders.length === 0 ? (
            <T.Body tone="secondary">No folders yet. Sets stay in your library without one.</T.Body>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => setFolderId('')}
                accessibilityRole="button"
                accessibilityState={{ selected: folderId === '' }}
                className={`px-3 py-2 rounded-full border ${
                  folderId === '' ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border'
                }`}
              >
                <T.Caption>None</T.Caption>
              </Pressable>
              {folders.map((folder) => (
                <Pressable
                  key={folder.id}
                  onPress={() => setFolderId(folder.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: folderId === folder.id }}
                  className={`px-3 py-2 rounded-full border ${
                    folderId === folder.id
                      ? 'border-lantern-primary bg-lantern-primary-background'
                      : 'border-lantern-border'
                  }`}
                >
                  <T.Caption>{folder.title}</T.Caption>
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Danger zone
          </T.Caption>
          <T.Caption tone="secondary" className="mb-3">
            Deleting the set does not delete your materials. They stay in your library, unfiled.
          </T.Caption>
          <Button variant="danger" onPress={() => void remove()}>
            Delete study set
          </Button>
        </Card>
      </ScrollView>

      {/* Pinned, like SheetShell's footer: Save used to sit at the end of the
          scroll, below four cards, so the only control that keeps the student's
          work was the one control they could not see. The scroll area is the
          one child allowed to shrink. */}
      <View
        style={{
          flexShrink: 0,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: tabBarClearance,
        }}
        className="border-t border-lantern-border bg-lantern-background"
      >
        <Button onPress={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <T.Caption tone="tertiary" className="mt-2 text-center">
          {dirty ? 'You have unsaved changes.' : 'Everything here is saved.'}
        </T.Caption>
      </View>
    </SafeAreaView>
  );
}

export default StudySetSettingsScreen;
