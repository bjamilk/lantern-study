/**
 * "Learn from this note" — mobile's counterpart of the web Learn panel, and
 * the end of the note editor's split personality.
 *
 * The editor used to carry TWO learn surfaces: a "Turn into" tile grid near
 * the top, and a "Learn from this note" card of small buttons at the bottom
 * offering the same four generations again — the same credits, the same
 * handlers, two different visual languages, and only one of them priced. The
 * contextual row's Learn item scrolled to the second one, so the tiles that
 * actually printed their cost were the ones a student was scrolled away from.
 *
 * This is one panel. Every door is a tile, every tile prints what it costs
 * through `formatCreditCost` over the constants the SERVER charges
 * (`aiCredits.ts`), and a door that cannot run says why before it is pressed
 * rather than after a spinner.
 *
 * Three doors are not generations and are labelled as such: Ask Lantern and
 * Walk me through open something (the companion, the walk-through) and Record
 * puts a lecture INTO this note rather than making a new thing out of it.
 *
 * The panel owns no state and calls no API. Every handler belongs to
 * `NoteEditorScreen`, which still owns the note, the credits and the jobs —
 * this file owns the arrangement and the honesty of the labels.
 */

import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Body, Caption, Card, FeatureDisc, Heading } from '../ui';
import type { AppIconName } from '../ui';
import type { FeatureKey } from '@lantern/shared/design';
import AIUsageBadge from '../AIUsageBadge';
import { useTheme } from '../../theme';
import { typeScale } from '../../design/typeScale';
import {
  AI_CREDIT_COSTS,
  MAX_NARRATION_PAGES,
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
  getNarrationCreditCost,
  narratedPageCount,
} from '@lantern/shared/utils/aiCredits';
import {
  SMART_NOTE_FILTER_LABELS,
  SMART_NOTES_GUIDANCE_MAX_CHARS,
  listSmartNoteFilters,
  smartNoteFilterSelected,
  type SmartNoteFilterId,
  type SmartNoteSourceId,
  type SmartNotesDepth,
} from '@lantern/shared/utils/smartNotes';
import { NOTES_STUDIO_DEPTHS } from '@lantern/shared';

/**
 * One door out of this note: a neutral tile carrying its feature's disc, what
 * it makes, and what it costs.
 *
 * The cost is printed, always, from the same constants the server charges — a
 * number typed in here is how the counter starts lying. A tile whose cost the
 * student cannot cover is disabled and says so, rather than failing at the far
 * end of a spinner.
 */
export function NoteLearnOption({
  feature,
  icon,
  label,
  cost,
  hint,
  disabled,
  disabledReason,
  onPress,
}: {
  feature: FeatureKey;
  icon: AppIconName;
  label: string;
  /** Printed cost, or null for a door that spends no credit up front. */
  cost: string | null;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
  onPress: () => void;
}) {
  const detail = disabled && disabledReason ? disabledReason : (hint ?? cost ?? '');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={[label, detail].filter(Boolean).join('. ')}
      style={{ minHeight: 64, flexBasis: '48%' }}
      className={`flex-1 flex-row items-center gap-2.5 p-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface active:opacity-90 ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <FeatureDisc feature={feature} icon={icon} size={32} />
      <View className="flex-1 min-w-0">
        <Body style={{ fontWeight: '600' }} numberOfLines={1} importantForAccessibility="no">
          {label}
        </Body>
        {detail ? (
          <Caption tone="secondary" numberOfLines={2} importantForAccessibility="no">
            {detail}
          </Caption>
        ) : null}
      </View>
    </Pressable>
  );
}

export interface NoteLearnPanelProps {
  /** Smart-notes guidance and depth: the panel renders them, the screen owns them. */
  guidance: string;
  onGuidanceChange: (value: string) => void;
  depth: SmartNotesDepth;
  onDepthChange: (depth: SmartNotesDepth) => void;

  /** True when the note has enough content for the generators to work from. */
  canGenerate: boolean;
  /** True when one AI use is more than the student has left today. */
  shortForOneCredit: boolean;
  /** True when the CHOSEN smart-notes depth costs more than is left today. */
  shortForSmartNote: boolean;
  /** A generation this screen started is already running. */
  isAILoading: boolean;
  summarizing: boolean;

  /**
   * Why recording cannot start here, or null when it can. One predicate
   * decided in `lectureStatusCopy`, never three booleans read off a store.
   */
  recordBlockedReason: string | null;

  /**
   * The document this note is, when it is one — a PDF or a slide deck. `null`
   * on a typed note, a photo note or a video: those have no pages, so the
   * walk-through door is shown disabled with that as its reason rather than
   * hidden, which would leave the student wondering where the feature went.
   */
  walkthroughAttachmentId: string | null;
  /** True while the document's text is still being extracted. */
  walkthroughPending?: boolean;

  /**
   * How many pages the document has, when this note carries one and anybody
   * has counted them. It prices the "Read it to me" door: the cost is two
   * bands over the page count, and printing the wrong band would misquote the
   * one metered action in that feature. `0` means nobody has counted yet, and
   * the tile quotes the cheap band against the 40-page cap — the honest thing
   * to say before the pages are known, and never more than the student pays.
   */
  documentPageCount?: number;
  /**
   * True when this document has already been read once. A script is written
   * once and replayed forever, so the door stops quoting a price and stops
   * caring whether the student has credits left.
   */
  narrationReady?: boolean;

  onFlashcards: () => void;
  onTest: () => void;
  onSmartNotes: () => void;
  /** True after Smart notes is selected — depth, guidance, and Write appear. */
  smartNoteOpen?: boolean;
  sources?: SmartNoteSourceId[];
  selectedSources?: SmartNoteSourceId[];
  onToggleFilter?: (id: SmartNoteFilterId) => void;
  onWriteSmartNotes?: () => void;
  writeDisabled?: boolean;
  /** Hide Walk / Read when those doors already live on the Materials tab. */
  hideDocumentActions?: boolean;
  onRecord: () => void;
  onChat: () => void;
  onWalkthrough: () => void;
  onReadAloud: () => void;
}

export function SmartNoteComposeFields({
  sources,
  selectedSources,
  onToggleFilter,
  guidance,
  onGuidanceChange,
  depth,
  onDepthChange,
  summarizing,
  shortForSmartNote,
  writeDisabled,
  onWrite,
}: {
  sources: SmartNoteSourceId[];
  selectedSources: SmartNoteSourceId[];
  onToggleFilter?: (id: SmartNoteFilterId) => void;
  guidance: string;
  onGuidanceChange: (value: string) => void;
  depth: SmartNotesDepth;
  onDepthChange: (value: SmartNotesDepth) => void;
  summarizing?: boolean;
  shortForSmartNote?: boolean;
  writeDisabled?: boolean;
  onWrite?: () => void;
}) {
  const { colors } = useTheme();
  const filters = listSmartNoteFilters(sources);

  return (
    <View>
      {filters.length > 0 ? (
        <View className="mb-3">
          <Caption tone="secondary" className="mb-1.5">
            Synthesize from
          </Caption>
          <View className="flex-row flex-wrap gap-1">
            {filters.map((id) => {
              const on = smartNoteFilterSelected(id, selectedSources, sources);
              return (
                <Pressable
                  key={id}
                  onPress={() => onToggleFilter?.(id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={SMART_NOTE_FILTER_LABELS[id]}
                  className={`min-h-[44px] justify-center rounded-full border px-3 ${
                    on
                      ? 'bg-lantern-primary-fill border-lantern-primary'
                      : 'bg-lantern-background border-lantern-border'
                  }`}
                >
                  <Caption
                    importantForAccessibility="no"
                    style={{ fontWeight: '600', color: on ? '#ffffff' : colors.textSecondary }}
                  >
                    {SMART_NOTE_FILTER_LABELS[id]}
                  </Caption>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <Caption tone="secondary" className="mb-1.5">
        Smart notes options
      </Caption>
      <TextInput
        className="w-full px-3 py-2 mb-2 rounded-lg border border-lantern-border bg-lantern-background text-lantern-text"
        style={typeScale.body}
        placeholder="Optional: what should it focus on?"
        placeholderTextColor={colors.textTertiary}
        value={guidance}
        onChangeText={onGuidanceChange}
        maxLength={SMART_NOTES_GUIDANCE_MAX_CHARS}
        accessibilityLabel="Guidance for smart notes"
      />
      <View className="flex-row gap-1">
        {NOTES_STUDIO_DEPTHS.map(({ id: value, label }) => (
          <Pressable
            key={value}
            onPress={() => onDepthChange(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: depth === value }}
            accessibilityLabel={`${label}. ${formatCreditCost(SMART_NOTES_CREDIT_COST[value])}`}
            className={`flex-1 px-2 py-1.5 rounded-lg border items-center ${
              depth === value
                ? 'bg-lantern-primary-fill border-lantern-primary'
                : 'bg-lantern-background border-lantern-border'
            }`}
          >
            <Caption
              importantForAccessibility="no"
              style={{ fontWeight: '600', color: depth === value ? '#ffffff' : colors.textSecondary }}
            >
              {`${label} · ${SMART_NOTES_CREDIT_COST[value]}`}
            </Caption>
          </Pressable>
        ))}
      </View>

      {onWrite ? (
        <View className="mt-3">
          <NoteLearnOption
            feature="ai"
            icon="sparkles"
            label="Write"
            cost={formatCreditCost(SMART_NOTES_CREDIT_COST[depth])}
            disabled={summarizing || shortForSmartNote || writeDisabled}
            disabledReason={
              shortForSmartNote
                ? 'Not enough credits left today'
                : writeDisabled
                  ? 'Select a source with enough text'
                  : undefined
            }
            onPress={onWrite}
          />
        </View>
      ) : null}
      <View className="mt-3">
        <AIUsageBadge variant="inline" cost={SMART_NOTES_CREDIT_COST[depth]} />
      </View>
    </View>
  );
}

export function NoteLearnPanel({
  guidance,
  onGuidanceChange,
  depth,
  onDepthChange,
  canGenerate,
  shortForOneCredit,
  shortForSmartNote,
  isAILoading,
  summarizing,
  recordBlockedReason,
  walkthroughAttachmentId,
  walkthroughPending,
  documentPageCount = 0,
  narrationReady = false,
  onFlashcards,
  onTest,
  onSmartNotes,
  smartNoteOpen = false,
  sources = [],
  selectedSources = [],
  onToggleFilter,
  onWriteSmartNotes,
  writeDisabled = false,
  hideDocumentActions = false,
  onRecord,
  onChat,
  onWalkthrough,
  onReadAloud,
}: NoteLearnPanelProps) {
  const { colors } = useTheme();

  const generationBlocked = shortForOneCredit
    ? 'No credits left today'
    : !canGenerate
      ? 'Needs more content in the note'
      : undefined;

  const walkthroughBlocked = !walkthroughAttachmentId
    ? 'Only PDFs and slide decks have pages'
    : walkthroughPending
      ? 'Still reading the document'
      : undefined;

  /**
   * "Read it to me" — the price and why it might be closed.
   *
   * A script that already exists is replayed for free, so once `narrationReady`
   * is true the door prints no cost and an empty credit counter stops mattering:
   * blocking a reading the student already paid for would be charging twice for
   * one thing. Everything about the price comes from `getNarrationCreditCost`
   * over the count the SERVER charges from — the two numbers must not be typed
   * anywhere else.
   */
  const narrationPages = narratedPageCount(documentPageCount) || MAX_NARRATION_PAGES;
  const narrationCost = formatCreditCost(getNarrationCreditCost(documentPageCount));
  const narrationBlocked = walkthroughBlocked
    ? walkthroughBlocked
    : !narrationReady && shortForOneCredit
      ? 'Not enough AI uses left today'
      : undefined;

  return (
    <Card className="border-lantern-border">
      <Heading className="mb-0.5">Study tools</Heading>
      <Caption tone="secondary" className="mb-3">
        These make a new thing — your note stays as it is
      </Caption>

      <View className="flex-row flex-wrap gap-2">
        {hideDocumentActions ? null : (
          <>
        <NoteLearnOption
          feature="notes"
          icon="book"
          label="Walk me through"
          cost={null}
          hint="Page by page, free"
          disabled={Boolean(walkthroughBlocked)}
          disabledReason={walkthroughBlocked}
          onPress={onWalkthrough}
        />
        <NoteLearnOption
          feature="notes"
          icon="volume-medium"
          label="Read it to me"
          cost={narrationReady ? null : narrationCost}
          hint={
            narrationReady
              ? 'Already read — play it again free'
              : `${narrationCost} · up to ${narrationPages} pages`
          }
          disabled={Boolean(narrationBlocked)}
          disabledReason={narrationBlocked}
          onPress={onReadAloud}
        />
          </>
        )}
        <NoteLearnOption
          feature="flashcards"
          icon="albums"
          label="Flashcards"
          cost={formatCreditCost(AI_CREDIT_COSTS.generate_flashcards)}
          disabled={isAILoading || !canGenerate || shortForOneCredit}
          disabledReason={generationBlocked}
          onPress={onFlashcards}
        />
        <NoteLearnOption
          feature="tests"
          icon="document-text"
          label="Test"
          cost={formatCreditCost(AI_CREDIT_COSTS.generate_questions)}
          disabled={!canGenerate || shortForOneCredit}
          disabledReason={generationBlocked}
          onPress={onTest}
        />
        <NoteLearnOption
          feature="ai"
          icon="sparkles"
          label="Smart notes"
          cost={formatCreditCost(SMART_NOTES_CREDIT_COST[depth])}
          disabled={summarizing || shortForSmartNote}
          disabledReason={shortForSmartNote ? 'Not enough credits left today' : undefined}
          onPress={onSmartNotes}
        />
        <NoteLearnOption
          feature="ai"
          icon="chatbubble-ellipses"
          label="Ask Lantern"
          cost={null}
          // Opening the companion costs nothing; the message you send it does,
          // and the companion prints that itself.
          hint="Opens Ask Lantern"
          onPress={onChat}
        />
        <NoteLearnOption
          feature="recording"
          icon="mic"
          label="Record"
          cost={null}
          // The exception to the line at the top of the panel, said plainly
          // rather than left to be discovered: a recording lands IN this note.
          // Nothing is charged to start; the transcript costs when you stop.
          hint="Records into this note"
          disabled={recordBlockedReason !== null}
          disabledReason={recordBlockedReason ?? undefined}
          onPress={onRecord}
        />
      </View>

      {smartNoteOpen ? (
        <View className="mt-4">
          <SmartNoteComposeFields
            sources={sources}
            selectedSources={selectedSources}
            onToggleFilter={onToggleFilter}
            guidance={guidance}
            onGuidanceChange={onGuidanceChange}
            depth={depth}
            onDepthChange={onDepthChange}
            summarizing={summarizing}
            shortForSmartNote={shortForSmartNote}
            writeDisabled={writeDisabled}
            onWrite={onWriteSmartNotes}
          />
        </View>
      ) : null}
    </Card>
  );
}

export default NoteLearnPanel;
