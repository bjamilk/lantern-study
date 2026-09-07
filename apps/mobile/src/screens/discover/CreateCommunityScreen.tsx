/**
 * Start a community (Campus stack).
 *
 * A purpose picker with one plain line each, a name, an optional description,
 * and — for an event — a when and a where. What the server can actually keep
 * is decided in `createCommunityForm.ts`; this screen only draws it and says,
 * out loud, that the room will be public.
 *
 * It lives on the CAMPUS stack: community screens never move to the Chat tab
 * (founder rule), so Back returns to the Communities segment and the Campus
 * tab stays lit the whole way.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { BackButton, FeatureDisc, useFeatureAccent } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { useTheme } from '../../theme';
import { createCommunity } from '../../services/api';
import { useCommunityStore } from '../../stores/communityStore';
import { RequestError } from '../../components/RequestError';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_NAME_MAX,
  COMMUNITY_PURPOSES,
  CREATE_COMMUNITY_EVENT_NOTE,
  CREATE_COMMUNITY_MODERATION_NOTE,
  CREATE_COMMUNITY_SUBMIT,
  CREATE_COMMUNITY_TITLE,
  CREATE_COMMUNITY_VISIBILITY_NOTE,
  EMPTY_CREATE_COMMUNITY_DRAFT,
  buildCreateCommunityRequest,
  purposeIcon,
  validateCreateCommunity,
  type CreateCommunityDraft,
} from './createCommunityForm';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  replace?: (screen: string, params?: Record<string, unknown>) => void;
};

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="px-4 pt-4">
      <Text className="text-caption font-semibold uppercase text-lantern-text-tertiary mb-1">
        {label}
      </Text>
      {children}
      {error ? (
        <Text className="mt-1 text-caption text-lantern-error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function CreateCommunityScreen({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  const campusAccent = useFeatureAccent('campus');
  const bottomPadding = useScreenBottomPadding();
  const loadMine = useCommunityStore((s) => s.loadMine);

  const [draft, setDraft] = useState<CreateCommunityDraft>(EMPTY_CREATE_COMMUNITY_DRAFT);
  // Errors are shown only after a submit attempt: a form that turns red while
  // you are still typing the third character of a name is a form that scolds.
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const errors = useMemo(() => validateCreateCommunity(draft), [draft]);
  const shown = submitted ? errors : {};
  const isEvent = draft.purposeId === 'event';

  const set = useCallback(
    (patch: Partial<CreateCommunityDraft>) => setDraft((current) => ({ ...current, ...patch })),
    []
  );

  const submit = useCallback(async () => {
    setSubmitted(true);
    const body = buildCreateCommunityRequest(draft);
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCommunity(body);
      // The membership list is what the segment draws "Your communities" from,
      // and the creator is a member of what they just made.
      await loadMine(true).catch(() => undefined);
      // `replace`, so Back from the new community returns to Communities
      // rather than to a form that would create a second room on a re-submit.
      const go = navigation.replace ?? navigation.navigate;
      go('CommunityDetail', { slug: created.slug });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [draft, loadMine, navigation]);

  return (
    <Screen keyboard>
      <View className="flex-row items-center gap-2 px-2 pt-1 pb-1">
        <BackButton onPress={() => navigation.goBack()} />
        <Text className="flex-1 text-title font-bold text-lantern-text" numberOfLines={1}>
          {CREATE_COMMUNITY_TITLE}
        </Text>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: bottomPadding + 24 }}
      >
        <Field label="What is it for" error={shown.purposeId}>
          <View className="gap-2">
            {COMMUNITY_PURPOSES.map((purpose) => {
              const selected = draft.purposeId === purpose.id;
              return (
                <Pressable
                  key={purpose.id}
                  onPress={() => set({ purposeId: purpose.id })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${purpose.label}. ${purpose.hint}`}
                  style={{
                    minHeight: 56,
                    borderColor: selected ? campusAccent.ink : colors.border,
                    backgroundColor: selected ? campusAccent.tint : 'transparent',
                  }}
                  className="flex-row items-center gap-3 rounded-2xl border px-3 py-2"
                >
                  <FeatureDisc feature="groups" icon={purposeIcon(purpose)} size={32} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-body font-semibold text-lantern-text">{purpose.label}</Text>
                    <Text className="text-caption text-lantern-text-secondary">{purpose.hint}</Text>
                  </View>
                  {selected ? (
                    <AppIcon name="checkmark-circle" size={18} color={campusAccent.ink} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Name" error={shown.name}>
          <TextInput
            value={draft.name}
            onChangeText={(name) => set({ name })}
            maxLength={COMMUNITY_NAME_MAX}
            placeholder="Chess club"
            placeholderTextColor={colors.inputPlaceholder}
            accessibilityLabel="Community name"
            style={{ minHeight: 48 }}
            className="rounded-2xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
          />
        </Field>

        <Field label="What happens here (optional)" error={shown.description}>
          <TextInput
            value={draft.description}
            onChangeText={(description) => set({ description })}
            maxLength={COMMUNITY_DESCRIPTION_MAX}
            multiline
            placeholder="Who it is for, and what gets posted."
            placeholderTextColor={colors.inputPlaceholder}
            accessibilityLabel="Description"
            style={{ minHeight: 88, textAlignVertical: 'top' }}
            className="rounded-2xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
          />
        </Field>

        {isEvent ? (
          <>
            <Field label="When" error={shown.eventWhen}>
              <TextInput
                value={draft.eventWhen}
                onChangeText={(eventWhen) => set({ eventWhen })}
                placeholder="Fri 12 Sep, 4pm"
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="When the event happens"
                style={{ minHeight: 48 }}
                className="rounded-2xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
              />
            </Field>
            <Field label="Where" error={shown.eventWhere}>
              <TextInput
                value={draft.eventWhere}
                onChangeText={(eventWhere) => set({ eventWhere })}
                placeholder="Main auditorium"
                placeholderTextColor={colors.inputPlaceholder}
                accessibilityLabel="Where the event happens"
                style={{ minHeight: 48 }}
                className="rounded-2xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
              />
            </Field>
            <Text className="px-4 pt-2 text-caption text-lantern-text-secondary">
              {CREATE_COMMUNITY_EVENT_NOTE}
            </Text>
          </>
        ) : null}

        {/* Said before the room exists, not after: a student who needs a room
            kept in must find that out here. */}
        <View className="mx-4 mt-5 rounded-2xl border border-lantern-border p-3">
          <View className="flex-row items-center gap-2 mb-1">
            <AppIcon name="globe" size={16} color={colors.textSecondary} />
            <Text className="text-caption font-semibold uppercase text-lantern-text-tertiary">
              Who can see it
            </Text>
          </View>
          <Text className="text-caption text-lantern-text">{CREATE_COMMUNITY_VISIBILITY_NOTE}</Text>
          <Text className="mt-2 text-caption text-lantern-text-secondary">
            {CREATE_COMMUNITY_MODERATION_NOTE}
          </Text>
        </View>

        {error ? (
          <View className="mt-3">
            <RequestError error={error} variant="banner" onRetry={() => void submit()} />
          </View>
        ) : null}

        <View className="px-4 pt-5">
          <Pressable
            onPress={() => void submit()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={CREATE_COMMUNITY_SUBMIT}
            accessibilityState={{ disabled: busy, busy }}
            style={{ minHeight: 48, backgroundColor: colors.primaryFill }}
            className={`flex-row items-center justify-center rounded-2xl px-4 ${busy ? 'opacity-50' : ''}`}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text className="text-body font-semibold text-white">{CREATE_COMMUNITY_SUBMIT}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

export default CreateCommunityScreen;
