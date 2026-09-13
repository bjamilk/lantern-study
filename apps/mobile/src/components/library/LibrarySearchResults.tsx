/**
 * Grouped GET /library/search results for the Library screen: notes, decks
 * (matching flashcards nested under their deck) and offline bundles, with
 * snippets and deep links.
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { LibrarySearchMatchField, LibrarySearchResult } from '@lantern/shared/types';
import { isGeneratedFromNoteTitle } from '@lantern/shared';
import { useTheme } from '../../theme';
import { groupLibrarySearchResults, type LibraryDeckGroup } from '../../utils/libraryArchive';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

interface Props {
  results: LibrarySearchResult[];
  searching: boolean;
  error: string | null;
  query: string;
  /** False on the Flashcards tab — search does not include notes. */
  includeNotes?: boolean;
  courseLabel?: string | null;
  /** Topic inside `courseLabel`, when the tree has one selected. */
  topicLabel?: string | null;
  bottomPadding?: number;
  onOpenNote: (noteId: string) => void;
  onOpenDeck: (deckId: string, deckTitle?: string) => void;
  onOpenBundle: (bundleId: string, courseId: string | null) => void;
}

const MATCH_LABELS: Partial<Record<LibrarySearchMatchField, string>> = {
  attachment: 'in attachment',
  body: 'in body',
  summary: 'in summary',
  description: 'in description',
  front: 'on front',
  back: 'on back',
  groupName: 'in group',
};

function MatchBadge({ field }: { field?: LibrarySearchMatchField }) {
  const label = field ? MATCH_LABELS[field] : undefined;
  if (!label) return null;
  return (
    <View className="px-1.5 py-0.5 rounded-full bg-lantern-background-secondary self-start mt-1">
      <Text className="text-label text-lantern-text-secondary">{label}</Text>
    </View>
  );
}

function ResultRow({
  icon,
  title,
  snippet,
  matchedIn,
  indent,
  onPress,
  accessibilityLabel,
}: {
  icon: AppIconName;
  title: string;
  snippet?: string;
  matchedIn?: LibrarySearchMatchField;
  indent?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={`flex-row items-start gap-2 px-3 py-2.5 rounded-xl border border-lantern-border bg-lantern-surface mb-2 active:opacity-90 ${
        indent ? 'ml-6' : ''
      }`}
    >
      <AppIcon name={icon} size={18} color={colors.primaryText} style={{ marginTop: 1 }} />
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
          {title || 'Untitled'}
        </Text>
        {snippet ? (
          <Text className="text-xs text-lantern-text-secondary mt-0.5" numberOfLines={2}>
            {snippet}
          </Text>
        ) : null}
        <MatchBadge field={matchedIn} />
      </View>
      <AppIcon name="chevron-forward" size={16} color={colors.textTertiary} style={{ marginTop: 2 }} />
    </Pressable>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <Text className="text-[11px] font-bold uppercase tracking-wider text-lantern-text-tertiary mb-1.5 mt-1">
      {label} · {count}
    </Text>
  );
}

export function LibrarySearchResults({
  results,
  searching,
  error,
  query,
  includeNotes = true,
  courseLabel,
  topicLabel,
  bottomPadding = 24,
  onOpenNote,
  onOpenDeck,
  onOpenBundle,
}: Props) {
  const { colors } = useTheme();
  const grouped = useMemo(() => {
    const rows = includeNotes
      ? results
      : results.filter(
          (row) => !isGeneratedFromNoteTitle(row.title) && !isGeneratedFromNoteTitle(row.deckTitle)
        );
    return groupLibrarySearchResults(rows);
  }, [results, includeNotes]);
  const scopeLabel = topicLabel ? (courseLabel ? `${courseLabel} · ${topicLabel}` : topicLabel) : courseLabel;

  const renderDeckGroup = (group: LibraryDeckGroup) => (
    <View key={group.deckId}>
      <ResultRow
        icon="layers"
        title={group.title}
        snippet={group.deck?.snippet || (group.cards.length ? `${group.cards.length} matching ${group.cards.length === 1 ? 'card' : 'cards'}` : undefined)}
        matchedIn={group.deck?.matchedIn}
        onPress={() => onOpenDeck(group.deckId, group.title)}
        accessibilityLabel={`Open deck ${group.title}`}
      />
      {group.cards.map(card => (
        <ResultRow
          key={card.id}
          icon="albums"
          title={card.title}
          snippet={card.snippet}
          matchedIn={card.matchedIn}
          indent
          onPress={() => onOpenDeck(group.deckId, group.title)}
          accessibilityLabel={`Open card ${card.title} in ${group.title}`}
        />
      ))}
    </View>
  );

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottomPadding }}
    >
      <View className="flex-row items-center gap-2 mb-2">
        {searching ? <ActivityIndicator size="small" color={colors.primaryText} /> : null}
        <Text className="text-xs text-lantern-text-secondary flex-1" numberOfLines={2}>
          {searching
            ? `Searching for “${query.trim()}”…`
            : `${grouped.total} ${grouped.total === 1 ? 'result' : 'results'} for “${query.trim()}”`}
          {scopeLabel ? ` in ${scopeLabel}` : ''}
        </Text>
      </View>

      {error ? (
        <View className="px-3 py-2 rounded-xl bg-lantern-error/10 border border-lantern-error/30 mb-2">
          <Text className="text-xs text-lantern-error">{error}</Text>
        </View>
      ) : null}

      {!searching && !error && grouped.total === 0 ? (
        <View className="items-center py-10 px-6">
          <AppIcon name="search" size={36} color={colors.textTertiary} />
          <Text className="text-sm text-lantern-text-secondary text-center mt-3">
            Nothing matched{scopeLabel ? ` in ${scopeLabel}` : ''}. {includeNotes
              ? 'Notes (including attachment text), decks, flashcards and offline bundles are searched.'
              : 'Decks, flashcards and offline bundles are searched.'}
          </Text>
          {/* A topic is the narrowest filter, so it is the first thing to widen —
              matches web's "Try widening the filter to the whole course." */}
          {topicLabel ? (
            <Text className="text-xs text-lantern-text-tertiary text-center mt-2">
              Try widening the filter to the whole course.
            </Text>
          ) : null}
        </View>
      ) : null}

      {grouped.notes.length > 0 ? (
        <>
          <SectionTitle label="Notes" count={grouped.notes.length} />
          {grouped.notes.map(note => (
            <ResultRow
              key={note.id}
              icon="document-text"
              title={note.title}
              snippet={note.snippet}
              matchedIn={note.matchedIn}
              onPress={() => onOpenNote(note.id)}
              accessibilityLabel={`Open note ${note.title}`}
            />
          ))}
        </>
      ) : null}

      {grouped.decks.length > 0 ? (
        <>
          <SectionTitle label="Flashcards" count={grouped.decks.length} />
          {grouped.decks.map(renderDeckGroup)}
        </>
      ) : null}

      {grouped.bundles.length > 0 ? (
        <>
          <SectionTitle label="Offline bundles" count={grouped.bundles.length} />
          {grouped.bundles.map(bundle => (
            <ResultRow
              key={bundle.id}
              icon={bundle.id.startsWith('qbank-') ? 'bag-handle' : 'cloud-download'}
              title={bundle.title}
              snippet={bundle.snippet}
              matchedIn={bundle.matchedIn}
              onPress={() => onOpenBundle(bundle.id, bundle.courseId)}
              accessibilityLabel={`Open offline bundle ${bundle.title}`}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

export default LibrarySearchResults;
