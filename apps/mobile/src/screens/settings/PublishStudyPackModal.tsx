import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SCREEN_KEYBOARD_BEHAVIOR } from '../../components/layout';
import { CampusPicker } from '../marketplace/CampusPicker';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';
import { fetchMarketplaceCampuses, publishStudyPack } from '../../services/api';
import { useTheme } from '../../theme';
import {
  RIGHTS_ATTESTATION_TEXT,
  SOURCES_CITED_MAX,
  normalizeSourcesCited,
} from '@lantern/shared/moderation';
import {
  summarizeStudyPackCounts,
  MARKETPLACE_DEFAULT_CREATOR_FEE_BPS,
  type StudyPackContentInput,
} from '@lantern/shared/marketplace';
import { LEGAL_DOCUMENT_TITLES } from '@lantern/shared/legal';
import { openSellerTerms } from '../../components/moderation/RightsAttestationCheckbox';

type Campus = Awaited<ReturnType<typeof fetchMarketplaceCampuses>>[number];

interface Props {
  visible: boolean;
  /** Pre-built content (from a deck, a note, or an AI draft) — shown for counts. */
  content: StudyPackContentInput;
  onClose: () => void;
  defaultTitle?: string;
  defaultCourseId?: string | null;
  defaultTopicId?: string | null;
  defaultDescription?: string;
  defaultPrice?: number | null;
  /** When set, publish consumes this ready AI draft server-side and marks it published. */
  draftId?: string | null;
  onPublished?: (listingId?: string) => void;
}

function countContent(content: StudyPackContentInput) {
  const guideWords = (content.guide?.markdown || '').trim()
    ? (content.guide!.markdown as string).trim().split(/\s+/).length
    : 0;
  return {
    guideWords,
    summaries: content.summaries?.length || 0,
    flashcards: content.flashcards?.length || 0,
    questions: content.questions?.length || 0,
  };
}

/**
 * Mobile counterpart of the web PublishStudyPackModal: turns a deck / note /
 * AI draft into a marketplace study pack. Content is built by the caller; the
 * server freezes a snapshot on publish.
 */
export function PublishStudyPackModal({
  visible,
  content,
  onClose,
  defaultTitle,
  defaultCourseId,
  defaultTopicId,
  defaultDescription,
  defaultPrice,
  draftId,
  onPublished,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(defaultTitle || '');
  const [description, setDescription] = useState(defaultDescription || '');
  const [price, setPrice] = useState(defaultPrice != null && defaultPrice > 0 ? String(defaultPrice) : '');
  const [campusId, setCampusId] = useState('');
  const [courseId, setCourseId] = useState<string | null>(defaultCourseId ?? null);
  const [topicId, setTopicId] = useState<string | null>(defaultTopicId ?? null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [attested, setAttested] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(!!draftId);
  const [sourcesText, setSourcesText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(defaultTitle || '');
    setDescription(defaultDescription || '');
    setPrice(defaultPrice != null && defaultPrice > 0 ? String(defaultPrice) : '');
    setCampusId('');
    setCourseId(defaultCourseId ?? null);
    setTopicId(defaultTopicId ?? null);
    setAttested(false);
    setAiAssisted(!!draftId);
    setSourcesText('');
    void fetchMarketplaceCampuses('NG')
      .then((rows) => setCampuses(rows || []))
      .catch(() => setCampuses([]));
  }, [visible, defaultTitle, defaultCourseId, defaultTopicId, defaultDescription, defaultPrice, draftId]);

  const counts = useMemo(() => countContent(content), [content]);
  const hasContent =
    counts.guideWords > 0 || counts.summaries > 0 || counts.flashcards > 0 || counts.questions > 0;
  const countSummary = summarizeStudyPackCounts(counts);

  const priceValue = price.trim() === '' ? null : Number(price);
  const priceInvalid = price.trim() !== '' && (!Number.isFinite(priceValue!) || priceValue! < 0);
  const sources = normalizeSourcesCited(sourcesText);
  const sourcesError = sources.ok ? null : sources.error;
  const canSubmit =
    !busy && attested && !sourcesError && hasContent && !!title.trim() && !!campusId && !priceInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await publishStudyPack({
        title: title.trim(),
        description: description.trim() || undefined,
        price: priceValue && priceValue > 0 ? priceValue : null,
        campusId,
        courseId: courseId ?? null,
        // Never sent without its course — the server rejects a bare topic.
        topicId: courseId ? topicId : null,
        ...(draftId ? { draftId } : { content }),
        attestation: true,
        aiAssisted,
        sourcesCited: sources.ok ? sources.value : [],
      });
      Alert.alert(
        'Published',
        priceValue && priceValue > 0
          ? 'Buyers get this study pack instantly after payment.'
          : 'Published as a free download.'
      );
      onPublished?.(result.listing?.id);
      onClose();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not publish study pack');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  } as const;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* The sheet is anchored to the bottom edge and its price/sources fields
          and the Publish button sit at the end of it — exactly where the
          keyboard lands. Android 15+ (this app targets SDK 36) stopped
          honouring adjustResize, so nothing moves without this. The sheet's
          `maxHeight: '88%'` then resolves against the keyboard-free box. */}
      <KeyboardAvoidingView
        behavior={SCREEN_KEYBOARD_BEHAVIOR}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
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
              Sell as a Study Pack
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 13, color: hasContent ? colors.textSecondary : '#ef4444' }}>
              {hasContent
                ? `${countSummary}. Buyers get a copy in their Library instantly — on web and mobile.`
                : 'This has nothing to sell yet — add a guide, flashcards or questions first.'}
            </Text>
            {content.cover?.title ? (
              <Text style={{ fontSize: 12, color: colors.text }}>
                Cover: {content.cover.title}
                {content.cover.subtitle ? ` — ${content.cover.subtitle}` : ''}
              </Text>
            ) : null}
            {content.examChecklist && content.examChecklist.length > 0
              ? content.examChecklist.slice(0, 8).map((item) => (
                  <Text key={item} style={{ fontSize: 12, color: colors.textSecondary }}>
                    • {item}
                  </Text>
                ))
              : null}

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                maxLength={120}
                placeholder="e.g. Cell Biology — Complete Study Pack"
                placeholderTextColor={colors.textTertiary}
                style={inputStyle}
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
                style={{ ...inputStyle, minHeight: 72, textAlignVertical: 'top' }}
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
                style={{ ...inputStyle, borderColor: priceInvalid ? '#ef4444' : colors.border }}
              />
              {priceValue && priceValue > 0 ? (
                <Text style={{ fontSize: 11, color: colors.textTertiary }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>
                    You receive ₦
                    {Math.round(
                      priceValue * (1 - MARKETPLACE_DEFAULT_CREATOR_FEE_BPS / 10000)
                    ).toLocaleString()}
                  </Text>{' '}
                  · Lantern fee {(MARKETPLACE_DEFAULT_CREATOR_FEE_BPS / 100).toFixed(0)}%. Needs your
                  payout bank account set up first.
                </Text>
              ) : null}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Campus</Text>
              <CampusPicker
                campuses={campuses}
                value={campusId}
                onChange={setCampusId}
                emptyLabel="Choose the campus this pack fits"
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                Course (optional)
              </Text>
              <CoursePicker
                value={courseId}
                onChange={(course) => {
                  const nextCourseId = course?.id ?? null;
                  setTopicId(topicIdAfterCourseChange(topicId, courseId, nextCourseId));
                  setCourseId(nextCourseId);
                }}
                placeholder="Which course is this pack for?"
                title="Course for this study pack"
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                Topic (optional)
              </Text>
              <TopicPicker
                courseId={courseId}
                value={topicId}
                onChange={(topic) => setTopicId(topic?.id ?? null)}
                placeholder="Which part of the syllabus?"
                title="Topic for this study pack"
              />
            </View>

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
                  Recorded with your listing. Tick it if AI generated or rewrote some of this.
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
                placeholder={`One per line — textbook, slides, my own notes… (up to ${SOURCES_CITED_MAX})`}
                placeholderTextColor={colors.textTertiary}
                style={{
                  ...inputStyle,
                  borderColor: sourcesError ? '#ef4444' : colors.border,
                  minHeight: 64,
                  textAlignVertical: 'top',
                }}
              />
              {sourcesError ? (
                <Text style={{ fontSize: 11, color: '#ef4444' }}>{sourcesError}</Text>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Switch value={attested} onValueChange={setAttested} accessibilityLabel="Rights attestation" />
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
              paddingBottom: insets.bottom + 16,
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
                  ? 'Publishing…'
                  : priceValue && priceValue > 0
                    ? `Publish · ₦${priceValue.toLocaleString()}`
                    : 'Publish free'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default PublishStudyPackModal;
