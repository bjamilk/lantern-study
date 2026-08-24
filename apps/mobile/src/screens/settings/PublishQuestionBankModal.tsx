import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CampusPicker } from '../marketplace/CampusPicker';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';
import {
  fetchMarketplaceCampuses,
  fetchMyQuestionBanks,
  publishQuestionBank,
  updateQuestionBankContent,
} from '../../services/api';
import type { OfflineTest } from '../../stores/offlineStore';
import { useTheme } from '../../theme';
import {
  RIGHTS_ATTESTATION_TEXT,
  SOURCES_CITED_MAX,
  normalizeSourcesCited,
} from '@lantern/shared/moderation';
import { LEGAL_DOCUMENT_TITLES } from '@lantern/shared/legal';
import { openSellerTerms } from '../../components/moderation/RightsAttestationCheckbox';

type MyBank = Awaited<ReturnType<typeof fetchMyQuestionBanks>>[number];
type Campus = Awaited<ReturnType<typeof fetchMarketplaceCampuses>>[number];

interface Props {
  test: OfflineTest | null;
  onClose: () => void;
  onPublished?: () => void;
}

/**
 * Mobile counterpart of the web publish modal: turns a downloaded offline test
 * into a marketplace question bank, or updates the listing already published
 * from the same group.
 */
export function PublishQuestionBankModal({ test, onClose, onPublished }: Props) {
  const { colors } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [campusId, setCampusId] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [attested, setAttested] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(false);
  /** One source per line → sourcesCited[] (Phase 1 · E provenance). */
  const [sourcesText, setSourcesText] = useState('');
  const [busy, setBusy] = useState(false);
  const [existingBank, setExistingBank] = useState<MyBank | null>(null);
  const [mode, setMode] = useState<'new' | 'update'>('new');

  useEffect(() => {
    if (!test) return;
    setTitle(test.testName || test.groupName || '');
    setDescription('');
    setPrice('');
    setCampusId('');
    setCourseId(null);
    setTopicId(null);
    setAttested(false);
    setAiAssisted(false);
    setSourcesText('');
    setExistingBank(null);
    setMode('new');

    void fetchMarketplaceCampuses('NG')
      .then((rows) => setCampuses(rows || []))
      .catch(() => setCampuses([]));

    void fetchMyQuestionBanks()
      .then((mine) => {
        const match = (mine || []).find(
          (bank) => bank.sourceGroupId && bank.sourceGroupId === test.groupId
        );
        if (match) {
          setExistingBank(match);
          setMode('update');
        }
      })
      .catch(() => setExistingBank(null));
  }, [test]);

  if (!test) return null;

  const questionCount = test.questions?.length || 0;
  const priceValue = price.trim() === '' ? null : Number(price);
  const priceInvalid = price.trim() !== '' && (!Number.isFinite(priceValue!) || priceValue! < 0);
  const isUpdate = mode === 'update' && !!existingBank;
  const sources = normalizeSourcesCited(sourcesText);
  const sourcesError = sources.ok ? null : sources.error;
  const canSubmit =
    !busy &&
    attested &&
    !sourcesError &&
    questionCount > 0 &&
    (isUpdate || (!!title.trim() && !!campusId && !priceInvalid));
  // The API requires attestation: true on publish AND republish (400 without it).
  const provenance = {
    attestation: true as const,
    aiAssisted,
    sourcesCited: sources.ok ? sources.value : [],
  };

  const content = {
    config: {
      groupId: test.groupId,
      groupName: test.groupName,
      numberOfQuestions: questionCount,
      allowedQuestionTypes: test.questionTypes,
    } as Record<string, unknown>,
    questions: test.questions as unknown[],
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (isUpdate && existingBank) {
        const result = await updateQuestionBankContent(existingBank.listingId, content, provenance);
        Alert.alert(
          'Question bank updated',
          `"${existingBank.title}" is now version ${result.version}. Buyers will see an update.`
        );
      } else {
        await publishQuestionBank({
          title: title.trim(),
          description: description.trim() || undefined,
          price: priceValue && priceValue > 0 ? priceValue : null,
          campusId,
          groupId: test.groupId || null,
          courseId: courseId ?? null,
          // Never sent without its course — the server rejects a bare topic.
          topicId: courseId ? topicId : null,
          content,
          ...provenance,
        });
        Alert.alert(
          'Published',
          priceValue && priceValue > 0
            ? 'Buyers get this bank instantly after payment.'
            : 'Published as a free download.'
        );
      }
      onPublished?.();
      onClose();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not publish question bank');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!test} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '88%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Ionicons name="storefront-outline" size={20} color={colors.primary} />
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.text }}>
              Publish to Marketplace
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>
              {questionCount} question{questionCount !== 1 ? 's' : ''} from {test.groupName}.
              Buyers get a copy in their Offline Mode instantly.
            </Text>

            {existingBank ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.primary + '55',
                  borderRadius: 12,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 13, color: colors.text }}>
                  You already published "{existingBank.title}" (v{existingBank.version}) from this
                  group.
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => setMode('update')}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 8,
                      backgroundColor: mode === 'update' ? colors.primary : colors.background,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '600',
                        color: mode === 'update' ? '#fff' : colors.textSecondary,
                      }}
                    >
                      Update to v{existingBank.version + 1}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMode('new')}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 8,
                      backgroundColor: mode === 'new' ? colors.primary : colors.background,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '600',
                        color: mode === 'new' ? '#fff' : colors.textSecondary,
                      }}
                    >
                      Publish separately
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {!isUpdate ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Title</Text>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    maxLength={120}
                    placeholder="e.g. GST 101 Past Questions"
                    placeholderTextColor={colors.textTertiary}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: colors.text,
                    }}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                    Description (optional)
                  </Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={3}
                    maxLength={1000}
                    placeholder="What's covered…"
                    placeholderTextColor={colors.textTertiary}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: colors.text,
                      minHeight: 72,
                      textAlignVertical: 'top',
                    }}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                    Price (₦) — leave empty for free
                  </Text>
                  <TextInput
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="numeric"
                    placeholder="Free"
                    placeholderTextColor={colors.textTertiary}
                    style={{
                      borderWidth: 1,
                      borderColor: priceInvalid ? '#ef4444' : colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: colors.text,
                    }}
                  />
                  {priceValue && priceValue > 0 ? (
                    <Text style={{ fontSize: 11, color: colors.textTertiary }}>
                      Paid banks need your payout bank account set up first.
                    </Text>
                  ) : null}
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Campus</Text>
                  <CampusPicker
                    campuses={campuses}
                    value={campusId}
                    onChange={setCampusId}
                    emptyLabel="Choose the campus this bank fits"
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Course (optional)</Text>
                  <CoursePicker
                    value={courseId}
                    onChange={course => {
                      const nextCourseId = course?.id ?? null;
                      setTopicId(topicIdAfterCourseChange(topicId, courseId, nextCourseId));
                      setCourseId(nextCourseId);
                    }}
                    placeholder="Which course is this bank for? e.g. GST 101"
                    title="Course for this question bank"
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Topic (optional)</Text>
                  <TopicPicker
                    courseId={courseId}
                    value={topicId}
                    onChange={topic => setTopicId(topic?.id ?? null)}
                    placeholder="Which part of the syllabus?"
                    title="Topic for this question bank"
                  />
                </View>
              </>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Switch
                value={aiAssisted}
                onValueChange={setAiAssisted}
                accessibilityLabel="This pack was AI-assisted"
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                  This pack was AI-assisted
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  Recorded with your listing. Tick it if AI generated or rewrote questions.
                </Text>
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                Sources (optional)
              </Text>
              <TextInput
                value={sourcesText}
                onChangeText={setSourcesText}
                multiline
                numberOfLines={3}
                placeholder={`One per line — textbook, lecturer's slides, past paper year… (up to ${SOURCES_CITED_MAX})`}
                placeholderTextColor={colors.textTertiary}
                style={{
                  borderWidth: 1,
                  borderColor: sourcesError ? '#ef4444' : colors.border,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.text,
                  minHeight: 64,
                  textAlignVertical: 'top',
                }}
              />
              {sourcesError ? (
                <Text style={{ fontSize: 11, color: '#ef4444' }}>{sourcesError}</Text>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Switch
                value={attested}
                onValueChange={setAttested}
                accessibilityLabel="Rights attestation"
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  {RIGHTS_ATTESTATION_TEXT}
                </Text>
                <Pressable onPress={openSellerTerms} hitSlop={6} accessibilityRole="link">
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>
                    Read the {LEGAL_DOCUMENT_TITLES['seller-terms']}
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>

          <View
            style={{
              flexDirection: 'row',
              gap: 10,
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              onPress={onClose}
              disabled={busy}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void submit()}
              disabled={!canSubmit}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: canSubmit ? colors.primary : colors.primary + '66',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                {busy
                  ? isUpdate
                    ? 'Updating…'
                    : 'Publishing…'
                  : isUpdate && existingBank
                    ? `Update to v${existingBank.version + 1}`
                    : priceValue && priceValue > 0
                      ? `Publish · ₦${priceValue.toLocaleString()}`
                      : 'Publish free'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default PublishQuestionBankModal;
