import React, { useEffect, useState } from 'react';
import type { CommunityDetail } from '@lantern/shared/network';
import { joinCommunity } from '../../services/supabase';
import { joinCommunityByCode } from '../../services/apiEndpoints';
import { useCommunityStore } from '../../stores/communityStore';
import { AppIcon } from '../ui/AppIcon';
import { Button, Input, Modal } from '../ui';
import RequestError from '../RequestError';
import { COMMUNITY_MANAGE_NOT_ENABLED, isManageFeatureOff } from './manageCommunity';
import {
  JOIN_BY_CODE_HINT,
  JOIN_BY_CODE_INVALID,
  JOIN_BY_CODE_NOT_FOUND,
  JOIN_BY_CODE_REFUSED,
  parseJoinTarget,
} from './joinByCode';

/**
 * Join by code (`/discover/join/:code`).
 *
 * An INVITE CODE is redeemed through `joinCommunityByCode` — the only way into
 * a private community — and the server answers every refusal (unknown,
 * expired, spent, revoked) with the SAME sentence, which this box shows as-is.
 * A public share link (`/discover/c/<slug>`) is not a code and never was: it
 * still resolves by slug and joins, so the links already in people's chats
 * keep working.
 *
 * Either way the community is resolved BEFORE the caller navigates: a bad
 * paste has to fail here, in the box the student is looking at, rather than
 * dumping them on a page that says "not found" with no way back to the paste.
 */
export interface JoinByCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Prefilled from the URL when arriving on `/discover/join/:code`. */
  initialCode?: string | null;
  /** Fired once the reader is a member (or already was) — the caller opens it. */
  onJoined: (community: CommunityDetail) => void;
}

export const JoinByCodeModal: React.FC<JoinByCodeModalProps> = ({
  isOpen,
  onClose,
  initialCode,
  onJoined,
}) => {
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const invalidate = useCommunityStore((s) => s.invalidate);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  // A code we cannot read is a form problem and keeps its own plain sentence;
  // a request that did not arrive is a network failure and keeps the shared
  // vocabulary. Collapsing the two used to blame the link for a dropped
  // connection.
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValue(initialCode ?? '');
    setFormError(null);
    setFailure(null);
    setBusy(false);
  }, [isOpen, initialCode]);

  /** A public share link: resolve the slug, join if needed, hand it back. */
  const joinBySlug = async (slug: string) => {
    const detail = await loadCommunity(slug);
    if (detail.isMember) {
      onJoined(detail);
      return;
    }
    await joinCommunity(detail.id);
    invalidate(detail.id);
    // Re-read so the caller opens a community that knows the reader is in it —
    // otherwise the page renders "Join" over a room they just joined.
    onJoined(await loadCommunity(slug));
  };

  const redeemCode = async (code: string) => {
    const result = await joinCommunityByCode(code);
    invalidate(result.communityId);
    onJoined(await loadCommunity(result.slug));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const target = parseJoinTarget(value);
    if (target.kind === 'unknown') {
      setFormError(JOIN_BY_CODE_INVALID);
      return;
    }
    setFormError(null);
    setFailure(null);
    setBusy(true);
    try {
      if (target.kind === 'code') await redeemCode(target.code);
      else await joinBySlug(target.slug);
      onClose();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = err instanceof Error ? err.message : '';
      if (isManageFeatureOff(err)) {
        // Pre-migration: invite codes are not switched on for this campus yet.
        setFormError(COMMUNITY_MANAGE_NOT_ENABLED);
      } else if (target.kind === 'code' && status === 404) {
        // The server's one refusal sentence, shown as-is. Which of the four
        // reasons it was is deliberately not knowable from here.
        setFormError(JOIN_BY_CODE_REFUSED);
      } else if (target.kind === 'slug' && /not found/i.test(message)) {
        // "Community not found" is the API's own 404 text; say the useful
        // thing about links instead of echoing a sentence about a page.
        setFormError(JOIN_BY_CODE_NOT_FOUND);
      } else {
        setFailure(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      loading={busy}
      maxWidthClass="max-w-md"
      ariaLabelledBy="join-by-code-title"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lantern-feature-campus-tint text-lantern-feature-campus-ink">
            <AppIcon name="link" size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="join-by-code-title" className="text-heading font-semibold text-lantern-text">
              Join with a link
            </h2>
            <p className="text-caption text-lantern-text-secondary">{JOIN_BY_CODE_HINT}</p>
          </div>
        </div>

        {failure ? (
          <RequestError
            variant="banner"
            error={failure}
            detail="You haven’t joined anything. Check your connection and try again."
            onRetry={() => setFailure(null)}
          />
        ) : null}

        <div className="space-y-1.5">
          <label className="block text-caption font-semibold text-lantern-text" htmlFor="join-by-code-input">
            Invite link or code
          </label>
          <Input
            id="join-by-code-input"
            value={value}
            autoFocus
            placeholder="lanternstudy.com/join/…"
            onChange={(event) => {
              setValue(event.target.value);
              if (formError) setFormError(null);
            }}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'join-by-code-error' : undefined}
          />
          {formError ? (
            <p id="join-by-code-error" role="alert" className="text-caption text-lantern-error">
              {formError}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={busy || !value.trim()}>
            Join
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default JoinByCodeModal;
