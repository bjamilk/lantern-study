/**
 * Seller-facing takedown notice + one-shot appeal (Phase 1 · E, contract §5):
 * shown on a moderated listing in My Listings and on the owner's listing
 * detail. Reads takedown_reason / appeal_* from the owner-only listing fields
 * and drives POST /marketplace/listings/:id/appeal. The note is written in the
 * app's own modal on both platforms.
 */
import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import {
  APPEAL_NOTE_MAX_LENGTH,
  LISTING_APPEAL_STATUS_LABELS,
  canAppealListing,
  listingAppealRefusal,
} from '@lantern/shared/moderation';
import {
  MARKETPLACE_LISTING_STATUS_LABELS,
  marketplaceListingModerationNotice,
} from '@lantern/shared/marketplace';
import { SUPPORT_EMAIL } from '@lantern/shared/contactForm';
import type { ListingAppealStatus } from '@lantern/shared/types';
import { useMarketplaceStore, type MarketplaceListing } from '../../stores';
import { Button } from '../ui';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';
import { appAlert } from '../ui/appDialog';

interface Props {
  listing: Pick<
    MarketplaceListing,
    'id' | 'status' | 'takedown_reason' | 'takedown_at' | 'appeal_status' | 'appeal_note' | 'appealed_at' | 'appeal_decided_at'
  >;
  /** Compact = inside a My Listings row; full = owner listing detail card. */
  compact?: boolean;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function ListingTakedownNotice({ listing, compact }: Props) {
  const { colors } = useTheme();
  const appealListing = useMarketplaceStore((s) => s.appealListing);
  const [busy, setBusy] = useState(false);
  const [androidPromptOpen, setAndroidPromptOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const appealStatus: ListingAppealStatus = listing.appeal_status ?? 'none';
  const canAppeal = canAppealListing({ status: listing.status, appeal_status: appealStatus });
  const refusal = listingAppealRefusal({ status: listing.status, appeal_status: appealStatus });
  const statusLabel = MARKETPLACE_LISTING_STATUS_LABELS[listing.status] ?? listing.status;

  const submitAppeal = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setNoteError('Tell us why the takedown is wrong.');
      return false;
    }
    if (trimmed.length > APPEAL_NOTE_MAX_LENGTH) {
      setNoteError(`Keep it under ${APPEAL_NOTE_MAX_LENGTH} characters.`);
      return false;
    }
    setBusy(true);
    setNoteError(null);
    try {
      await appealListing(listing.id, trimmed);
      appAlert('Appeal submitted', 'Our team will review it and let you know the outcome.');
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error && e.message ? e.message : 'Could not submit your appeal.';
      // The modal stays open with the error in place.
      setNoteError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startAppeal = () => {
    if (!canAppeal) {
      appAlert('Appeal unavailable', refusal ?? 'This listing cannot be appealed.');
      return;
    }
    setNote('');
    setNoteError(null);
    setAndroidPromptOpen(true);
  };

  const takedownAt = formatDate(listing.takedown_at);
  const appealedAt = formatDate(listing.appealed_at);
  const decidedAt = formatDate(listing.appeal_decided_at);

  return (
    <View
      className={
        compact
          ? 'mt-1'
          : 'mt-3 p-4 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
      }
    >
      <Text
        className={
          compact
            ? 'text-[11px] font-semibold text-red-700 dark:text-red-300'
            : 'text-sm font-semibold text-red-700 dark:text-red-300'
        }
      >
        {statusLabel}
        {compact ? ' · hidden from buyers' : ''}
      </Text>
      {!compact ? (
        <Text className="mt-1 text-sm text-red-700 dark:text-red-300">
          {marketplaceListingModerationNotice(listing.status)}
        </Text>
      ) : null}
      {listing.takedown_reason ? (
        <Text
          className={
            compact
              ? 'text-[11px] text-lantern-text-secondary mt-0.5'
              : 'mt-2 text-sm text-lantern-text'
          }
          numberOfLines={compact ? 2 : undefined}
        >
          Reason: {listing.takedown_reason}
          {takedownAt && !compact ? ` (${takedownAt})` : ''}
        </Text>
      ) : null}

      {appealStatus !== 'none' ? (
        <View className={compact ? 'mt-0.5' : 'mt-2'}>
          <Text
            className={`${compact ? 'text-[11px]' : 'text-sm'} font-semibold ${
              appealStatus === 'reversed'
                ? 'text-emerald-700 dark:text-emerald-300'
                : appealStatus === 'upheld'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {LISTING_APPEAL_STATUS_LABELS[appealStatus]}
            {appealStatus === 'requested' && appealedAt ? ` · ${appealedAt}` : ''}
            {appealStatus !== 'requested' && decidedAt ? ` · ${decidedAt}` : ''}
          </Text>
          {!compact && listing.appeal_note ? (
            <Text className="mt-1 text-xs text-lantern-text-secondary">Your note: {listing.appeal_note}</Text>
          ) : null}
        </View>
      ) : null}

      {canAppeal ? (
        compact ? (
          <Pressable
            onPress={startAppeal}
            disabled={busy}
            className="mt-1 self-start"
            accessibilityRole="button"
            accessibilityLabel="Appeal takedown"
          >
            <Text className="text-[11px] font-semibold text-lantern-primary-text">
              {busy ? 'Submitting appeal…' : 'Appeal'}
            </Text>
          </Pressable>
        ) : (
          <View className="mt-3 gap-2">
            <Button size="sm" variant="secondary" loading={busy} onPress={startAppeal}>
              Appeal takedown
            </Button>
            <Text className="text-xs text-lantern-text-secondary">
              One appeal per listing. Or write to {SUPPORT_EMAIL}.
            </Text>
          </View>
        )
      ) : !compact && refusal && appealStatus === 'none' ? (
        <Text className="mt-2 text-xs text-lantern-text-secondary">
          {refusal} Contact {SUPPORT_EMAIL} if you think this is a mistake.
        </Text>
      ) : null}

      {/* The appeal note is written here, in the app's own dialog style. */}
      <Modal
        visible={androidPromptOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setAndroidPromptOpen(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-5">
          <View className="w-full rounded-2xl bg-lantern-surface p-5">
            <View className="flex-row items-center gap-2 mb-2">
              <AppIcon name="chatbubble-ellipses" size={18} color={colors.primaryText} />
              <Text className="text-base font-semibold text-lantern-text flex-1">Appeal takedown</Text>
            </View>
            <Text className="text-xs text-lantern-text-secondary mb-3">
              Explain why this listing should be restored (for example, you own the rights or the report was mistaken).
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={APPEAL_NOTE_MAX_LENGTH}
              autoFocus
              placeholder="Your note to the moderation team"
              placeholderTextColor={colors.inputPlaceholder}
              textAlignVertical="top"
              className="min-h-[96px] p-3 rounded-xl border border-lantern-border text-lantern-text"
            />
            {noteError ? <Text className="text-xs text-red-500 mt-2">{noteError}</Text> : null}
            <View className="flex-row gap-2 mt-4">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={busy}
                onPress={() => setAndroidPromptOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={busy}
                onPress={() => {
                  void submitAppeal(note).then((ok) => {
                    if (ok) setAndroidPromptOpen(false);
                  });
                }}
              >
                Submit appeal
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default ListingTakedownNotice;
