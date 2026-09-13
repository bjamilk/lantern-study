import React, { useEffect, useMemo, useState } from 'react';
import type { Community } from '@lantern/shared/network';
import { createCommunity } from '../../services/supabase';
import { AppIcon } from '../ui/AppIcon';
import { Button, Input, Modal, Textarea } from '../ui';
import RequestError from '../RequestError';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_NAME_MAX,
  COMMUNITY_PURPOSES,
  CREATE_COMMUNITY_MODERATION_NOTE,
  buildCreateCommunityRequest,
  communityPurpose,
  createCommunityVisibilityNote,
  validateCreateCommunity,
  type CreateCommunityDraft,
  type CreateCommunityErrors,
} from './createCommunityPlan';

/**
 * Start a community (spec §5.4) — the web half of the mobile sheet.
 *
 * Everything the form offers is something the server keeps: a name, a purpose
 * (stored as a tag, so Find can filter by it), a description, extra tags, and
 * — for an event — a when/where composed into the description in plain words.
 * Visibility is a real Public / Private control. Private rooms stay off Find;
 * join is invite-link or code from Manage.
 */
export interface CreateCommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired with the created community so the caller can list it and open it. */
  onCreated: (community: Community) => void;
}

const EMPTY: CreateCommunityDraft = {
  name: '',
  purposeId: null,
  description: '',
  tags: '',
  visibility: 'public',
  eventWhen: '',
  eventWhere: '',
};

export const CreateCommunityModal: React.FC<CreateCommunityModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [draft, setDraft] = useState<CreateCommunityDraft>(EMPTY);
  const [errors, setErrors] = useState<CreateCommunityErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  // A failed request is not a failed form: it keeps the shared network
  // vocabulary and leaves everything the student typed on screen.
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(EMPTY);
    setErrors({});
    setSubmitted(false);
    setFailure(null);
    setBusy(false);
  }, [isOpen]);

  const purpose = useMemo(() => communityPurpose(draft.purposeId), [draft.purposeId]);
  const isEvent = purpose?.id === 'event';

  const patch = (next: Partial<CreateCommunityDraft>) => {
    setDraft((prev) => {
      const merged = { ...prev, ...next };
      // Re-validate as you fix, but only once the form has been submitted —
      // marking a field red before anyone has tried to submit is a scold.
      if (submitted) setErrors(validateCreateCommunity(merged));
      return merged;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    const found = validateCreateCommunity(draft);
    setErrors(found);
    const body = buildCreateCommunityRequest(draft);
    if (!body) return;
    setBusy(true);
    setFailure(null);
    try {
      const created = await createCommunity(body);
      onCreated(created);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const fieldClass = 'space-y-1.5';
  const labelClass = 'block text-caption font-semibold text-lantern-text';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      loading={busy}
      maxWidthClass="max-w-lg"
      ariaLabelledBy="create-community-title"
      panelClassName="max-h-[90vh] overflow-y-auto"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lantern-feature-campus-tint text-lantern-feature-campus-ink">
            <AppIcon name="people" size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="create-community-title" className="text-heading font-semibold text-lantern-text">
              Start a community
            </h2>
            <p className="text-caption text-lantern-text-secondary">
              A place for people on your campus — a course, a club, a hostel, a week of events.
            </p>
          </div>
        </div>

        {failure ? (
          <RequestError
            variant="banner"
            error={failure}
            detail="The community wasn’t created. Nothing you typed was lost — try again."
            onRetry={() => setFailure(null)}
          />
        ) : null}

        <div className={fieldClass}>
          <label className={labelClass} htmlFor="create-community-name">
            Name
          </label>
          <Input
            id="create-community-name"
            value={draft.name}
            maxLength={COMMUNITY_NAME_MAX}
            placeholder="Pharmacy 300L, Chess Club, Faculty Week"
            onChange={(event) => patch({ name: event.target.value })}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'create-community-name-error' : undefined}
          />
          {errors.name ? (
            <p id="create-community-name-error" role="alert" className="text-caption text-lantern-error">
              {errors.name}
            </p>
          ) : null}
        </div>

        <fieldset className={fieldClass}>
          <legend className={labelClass}>What is it for?</legend>
          <div className="flex flex-wrap gap-2">
            {COMMUNITY_PURPOSES.map((option) => {
              const active = draft.purposeId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => patch({ purposeId: option.id })}
                  aria-pressed={active}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-caption font-semibold transition-colors sm:min-h-[36px] ${
                    active
                      ? 'border-transparent bg-lantern-primary text-white'
                      : 'border-lantern-border bg-lantern-background text-lantern-text-secondary hover:border-lantern-primary/40'
                  }`}
                >
                  <AppIcon name={option.icon} size={16} />
                  {option.label}
                </button>
              );
            })}
          </div>
          {purpose ? (
            <p className="text-caption text-lantern-text-tertiary">{purpose.hint}</p>
          ) : null}
          {errors.purposeId ? (
            <p role="alert" className="text-caption text-lantern-error">
              {errors.purposeId}
            </p>
          ) : null}
        </fieldset>

        {isEvent ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="create-community-when">
                When
              </label>
              <Input
                id="create-community-when"
                type="datetime-local"
                value={draft.eventWhen ?? ''}
                onChange={(event) => patch({ eventWhen: event.target.value })}
              />
            </div>
            <div className={fieldClass}>
              <label className={labelClass} htmlFor="create-community-where">
                Where
              </label>
              <Input
                id="create-community-where"
                value={draft.eventWhere ?? ''}
                placeholder="Main auditorium"
                onChange={(event) => patch({ eventWhere: event.target.value })}
              />
            </div>
            <p className="text-caption text-lantern-text-tertiary sm:col-span-2">
              Date and place are saved on the event so it lists soonest-first.
            </p>
          </div>
        ) : null}

        <div className={fieldClass}>
          <label className={labelClass} htmlFor="create-community-description">
            Description <span className="font-normal text-lantern-text-tertiary">(optional)</span>
          </label>
          <Textarea
            id="create-community-description"
            rows={3}
            value={draft.description}
            maxLength={COMMUNITY_DESCRIPTION_MAX}
            placeholder="Who is this for, and what happens here?"
            onChange={(event) => patch({ description: event.target.value })}
            aria-invalid={errors.description ? true : undefined}
          />
          {errors.description ? (
            <p role="alert" className="text-caption text-lantern-error">
              {errors.description}
            </p>
          ) : null}
        </div>

        <div className={fieldClass}>
          <label className={labelClass} htmlFor="create-community-tags">
            Tags <span className="font-normal text-lantern-text-tertiary">(optional)</span>
          </label>
          <Input
            id="create-community-tags"
            value={draft.tags}
            placeholder="past-questions, 300l"
            onChange={(event) => patch({ tags: event.target.value })}
          />
          <p className="text-caption text-lantern-text-tertiary">
            Separate with commas. Tags are how people find this room in search.
          </p>
        </div>

        <fieldset className={fieldClass}>
          <legend className={labelClass}>Who can see it</legend>
          <div className="flex flex-wrap gap-2">
            {(['public', 'private'] as const).map((visibility) => {
              const active = draft.visibility === visibility;
              return (
                <button
                  key={visibility}
                  type="button"
                  onClick={() => patch({ visibility })}
                  aria-pressed={active}
                  className={`min-h-[36px] rounded-full border px-3 text-caption ${
                    active
                      ? 'border-lantern-ink bg-lantern-ink text-lantern-surface'
                      : 'border-lantern-border bg-transparent text-lantern-text-secondary hover:text-lantern-text'
                  }`}
                >
                  {visibility === 'public' ? 'Public' : 'Private'}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5 rounded-lantern bg-lantern-background-secondary p-3">
          <p className="flex items-start gap-2 text-caption text-lantern-text-secondary">
            <AppIcon name="people" size={16} className="mt-0.5 shrink-0 text-lantern-text-tertiary" />
            {createCommunityVisibilityNote(draft.visibility)}
          </p>
          <p className="flex items-start gap-2 text-caption text-lantern-text-secondary">
            <AppIcon name="shield" size={16} className="mt-0.5 shrink-0 text-lantern-text-tertiary" />
            {CREATE_COMMUNITY_MODERATION_NOTE}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Create community
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateCommunityModal;
