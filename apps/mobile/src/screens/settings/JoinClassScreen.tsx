/**
 * Root stack -> JoinClass. Takes a lecturer's join code (optionally prefilled
 * from a route param), previews the class it names, then joins it.
 *
 * Exports: JoinClassScreen (default).
 * Touches: services/api previewClassByCode and joinClassByCode; code shape and
 * copy from @lantern/shared/academic (canonicalizeJoinCode, isValidJoinCode,
 * classSubjectLine).
 * Note: the preview runs on every keystroke that forms a valid code, but
 * joining is an explicit button press; the code is canonicalised on input so
 * what is previewed is what is sent.
 */
import React, { useEffect, useState } from 'react';
import { useTheme } from '../../theme';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { canonicalizeJoinCode, classSubjectLine, isValidJoinCode } from '@lantern/shared/academic';
import type { ClassJoinPreview } from '@lantern/shared/types';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { Button } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { joinClassByCode, previewClassByCode } from '../../services/api';

interface JoinClassScreenProps {
  navigation: { goBack: () => void };
  route?: { params?: { code?: string } };
}

export default function JoinClassScreen({ navigation, route }: JoinClassScreenProps) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const initial = canonicalizeJoinCode(route?.params?.code ?? '');
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState<ClassJoinPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const normalised = canonicalizeJoinCode(value);
    if (!isValidJoinCode(normalised)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    previewClassByCode(normalised)
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setPreview(null);
          setError(err.message || 'That code is not valid');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <Screen bottom="none">
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-lantern-border">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2" accessibilityRole="button">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="text-title font-semibold text-lantern-text">Join a class</Text>
      </View>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 14, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-body text-lantern-text-secondary mb-4">
          Enter the code from your lecturer. You do not need Canvas or Google Classroom.
        </Text>
        <Text className="text-caption text-lantern-text-secondary mb-1">Join code</Text>
        <TextInput
          value={value}
          onChangeText={(next) => setValue(canonicalizeJoinCode(next))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          placeholder="ABC234"
          placeholderTextColor={colors.textTertiary}
          className="border border-lantern-border rounded-lantern px-3 py-3 font-mono tracking-widest text-title text-lantern-text mb-4"
        />
        {preview ? (
          <View className="mb-4">
            <Text className="text-title font-semibold text-lantern-text">{preview.title}</Text>
            <Text className="text-caption text-lantern-text-secondary">
              {classSubjectLine(preview.course, preview.topic)} · {preview.instructorName} · {preview.memberCount} already
              in
            </Text>
          </View>
        ) : null}
        {error ? <Text className="text-body text-lantern-error mb-3">{error}</Text> : null}
        <Button
          disabled={busy || !isValidJoinCode(value)}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await joinClassByCode(canonicalizeJoinCode(value));
              navigation.goBack();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not join');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Joining…' : 'Join class'}
        </Button>
        {busy ? <ActivityIndicator className="mt-3" /> : null}
      </ScrollView>
    </Screen>
  );
}
