/**
 * The Study hub's folder row: `All`, one chip per folder, and `Create folder`.
 *
 * Web's hub has had exactly this since folders shipped; the phone had the
 * folders themselves and no way to see or use them. The chips are the SAME
 * object as the set room's segments — `useSegmentSkin`, ink fill, inverse
 * label, hairline outline when idle — because "a row of pills where one is on"
 * should not be two different-looking controls two screens apart.
 *
 * WHY THE CREATE INPUT IS A ROW OF ITS OWN. The pills scroll horizontally, and
 * a text field inside a horizontal scroller is a field you cannot reliably put
 * a caret in: the drag that places the cursor is the same gesture that scrolls
 * the row. So `Create folder` is a pill in the row, and pressing it reveals a
 * full-width field UNDER the row — which is also the only shape that has room
 * for a folder name at the largest font-size setting.
 *
 * Presentational. It decides nothing about which sets a folder holds; that is
 * `folderFilter.ts`, and this file draws what that returns.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { StudySetFolder } from '@lantern/shared/types';
import { AppIcon, T, useSegmentSkin } from '../ui';
import { useTheme } from '../../theme';
import {
  FOLDER_TITLE_MAX,
  folderChips,
  isValidFolderTitle,
  normalizeFolderTitle,
  type FolderSelection,
} from './folderFilter';

export interface FolderChipsProps {
  folders: readonly StudySetFolder[];
  /** `ALL_FOLDERS` or a folder id. A stale id resolves to `All` for you. */
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  /**
   * Make the folder. Rejecting is expected — the caller reports it; this row
   * only keeps the field open so the typed name is not thrown away with it.
   */
  onCreate: (title: string) => Promise<unknown>;
}

export function FolderChips({ folders, selection, onSelect, onCreate }: FolderChipsProps) {
  const { colors } = useTheme();
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const chips = folderChips(folders, selection);

  useEffect(() => {
    // `autoFocus` fires once on mount; this field is revealed, not mounted
    // fresh each time in a way we can rely on, so focus is asked for whenever
    // the form opens.
    if (formOpen) inputRef.current?.focus();
  }, [formOpen]);

  const close = () => {
    setFormOpen(false);
    setTitle('');
  };

  const submit = async () => {
    const name = normalizeFolderTitle(title);
    if (!isValidFolderTitle(name) || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      close();
    } catch {
      // Left open, with the name still in it: the student's next move is to
      // press the button again, not to retype what they just typed. The
      // failure itself is the caller's to announce.
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mb-3">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Edge-to-edge inside the screen's 16 dp padding, so the last pill
        // scrolls clear of the right edge instead of sitting half under it.
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
        className="-mr-4"
        keyboardShouldPersistTaps="handled"
      >
        {chips.map((chip) => (
          <FolderChip
            key={chip.id}
            label={chip.label}
            selected={chip.selected}
            accessibilityLabel={
              chip.label === 'All' ? 'Show all study sets' : `Show the ${chip.label} folder`
            }
            onPress={() => onSelect(chip.id)}
            testID={`study-hub-folder-${chip.id}`}
          />
        ))}

        {/* The create control sits at the END of the row, after the folders it
            will join — not in the toolbar above, where it would compete with
            "New study set" and invite the wrong one. */}
        <Pressable
          onPress={() => (formOpen ? close() : setFormOpen(true))}
          accessibilityRole="button"
          accessibilityLabel="Create folder"
          accessibilityState={{ expanded: formOpen }}
          testID="study-hub-create-folder"
          style={{ borderColor: colors.border }}
          className="min-h-[40px] px-4 rounded-full border border-dashed flex-row items-center gap-1 active:opacity-70"
        >
          <AppIcon name="add" size={14} color={colors.textSecondary} importantForAccessibility="no" />
          <T.Caption tone="secondary" numberOfLines={1}>
            Create folder
          </T.Caption>
        </Pressable>
      </ScrollView>

      {formOpen ? (
        <View className="flex-row items-center gap-2 mt-2">
          <TextInput
            ref={inputRef}
            value={title}
            onChangeText={setTitle}
            placeholder="Folder name"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel="Folder name"
            maxLength={FOLDER_TITLE_MAX}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            testID="study-hub-folder-name"
            style={{ color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }}
            className="flex-1 min-h-[44px] rounded-full border px-4 text-body"
          />
          <Pressable
            onPress={() => void submit()}
            disabled={!isValidFolderTitle(title) || busy}
            accessibilityRole="button"
            accessibilityLabel="Save folder"
            accessibilityState={{ disabled: !isValidFolderTitle(title) || busy }}
            testID="study-hub-folder-save"
            style={{
              backgroundColor: colors.primaryFill,
              // Dimmed rather than hidden: a button that disappears while you
              // are aiming at it is worse than one that says "not yet".
              opacity: isValidFolderTitle(title) && !busy ? 1 : 0.5,
            }}
            className="min-h-[44px] px-4 rounded-full items-center justify-center active:opacity-80"
          >
            <T.Caption style={{ color: colors.textInverse, fontWeight: '600' }}>Save</T.Caption>
          </Pressable>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Cancel creating a folder"
            hitSlop={8}
            className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-60"
          >
            <AppIcon
              name="close"
              size={18}
              color={colors.textSecondary}
              importantForAccessibility="no"
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FolderChip({
  label,
  selected,
  accessibilityLabel,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}) {
  const skin = useSegmentSkin(selected);
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{
        backgroundColor: skin.backgroundColor,
        borderColor: selected ? skin.backgroundColor : colors.border,
      }}
      className="min-h-[40px] px-4 rounded-full border items-center justify-center active:opacity-80"
    >
      {/* `pointerEvents="none"` matches the set room's segments: the label must
          never eat the press meant for the pill. */}
      <View pointerEvents="none">
        <T.Caption style={{ color: skin.color, fontWeight: '600' }} numberOfLines={1}>
          {label}
        </T.Caption>
      </View>
    </Pressable>
  );
}

export default FolderChips;
