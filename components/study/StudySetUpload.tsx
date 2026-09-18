import React, { useMemo, useRef, useState } from 'react';
import type { StudyUploadSource } from '@lantern/shared';
import { useAiJobStore } from '../../stores/aiJobStore';
import { Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import {
  UPLOAD_ACCEPT,
  UPLOAD_DOORS_MORE,
  UPLOAD_DOORS_PRIMARY,
  UPLOAD_DOOR_UNAVAILABLE,
  UPLOAD_GENERATED,
  type UploadDoor,
} from './uploadDoors';

/**
 * Upload Materials — the `/study/sets/:id/add` page.
 *
 * WHY A PAGE AND NOT A MODAL. Measured off the reference on 2026-09-17
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Upload
 * Materials): `/addMaterial` is a full page inside the set room's chrome, not
 * an overlay. Eleven doors, a checklist of what gets generated and two
 * invitations do not fit a dialog, and a dialog cannot be linked to, resumed
 * or reached with Back — which is the whole reason the room's tools are
 * nested routes.
 *
 * The MODAL IS NOT REPLACED. It is still where every upload actually happens:
 * this page's doors open it focused on one source, and the dropzone hands it
 * `initialFiles`. So the accepted types, the 25 MB limit, the progress bar and
 * the generator pipeline stay one implementation. It also still serves the
 * dashboard's Import door, which has no set to be a page inside.
 *
 * Touches: `CourseWorkspace` (owns the modal and the handlers below),
 * `uploadDoors` (which doors exist and what they open).
 *
 * Gotchas:
 *  - The dropzone is a real `<input type="file">` behind a `<label>`, never a
 *    div with a click handler: that is what makes it reachable by Tab and
 *    operable by Space, and it is why `htmlFor`/`id` must stay paired.
 *  - Drag-and-drop is an ADDITION to that input, not a replacement. A drop
 *    cannot be performed from a keyboard, so nothing may be reachable only
 *    that way.
 *  - A door Lantern cannot back is `disabled` AND `aria-describedby` the
 *    reason. Do not hide it (the founder wants the flow visible) and do not
 *    leave it live (a control that does nothing is worse than one that says
 *    why).
 */

type JobFilter = 'all' | 'processing' | 'done' | 'failed';

interface StudySetUploadProps {
  studySetId: string;
  courseId?: string;
  /** Open the import modal, focused on one source when a door named it. */
  onImport: (source?: StudyUploadSource) => void;
  /** Open the lecture recorder. */
  onRecord: () => void;
  /** Files chosen or dropped here — handed to the modal's own handlers. */
  onFiles: (files: File[]) => void;
  /** "No Material": start from a topic instead of an upload. */
  onNoMaterial: () => void;
  /** Copy this set's share link (the existing share flow). */
  onCopyLink: () => void;
}

/** One door in the grid: a white r12 hairline card, 20px icon, 14/500 label. */
const DoorButton: React.FC<{ door: UploadDoor; onOpen: (door: UploadDoor) => void }> = ({
  door,
  onOpen,
}) => {
  const reasonId = `upload-door-${door.id}-reason`;
  if (!door.available) {
    return (
      <div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-describedby={reasonId}
          title={UPLOAD_DOOR_UNAVAILABLE}
          className="flex w-full min-h-[44px] items-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-4 py-3 text-left opacity-60"
        >
          <AppIcon name={door.icon} size={20} aria-hidden="true" className="text-lantern-text-tertiary" />
          <span className="text-body font-medium text-lantern-text-secondary">{door.label}</span>
        </button>
        <p id={reasonId} className="mt-1 px-1 text-caption text-lantern-text-secondary">
          {UPLOAD_DOOR_UNAVAILABLE}
          {door.reason ? ` — ${door.reason}` : ''}
        </p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(door)}
      className="flex w-full min-h-[44px] items-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-4 py-3 text-left transition-colors hover:bg-lantern-background-secondary"
    >
      <AppIcon name={door.icon} size={20} aria-hidden="true" className="text-lantern-feature-sets-ink" />
      <span className="text-body font-medium text-lantern-text">{door.label}</span>
    </button>
  );
};

export const StudySetUpload: React.FC<StudySetUploadProps> = ({
  onImport,
  onRecord,
  onFiles,
  onNoMaterial,
  onCopyLink,
}) => {
  const jobs = useAiJobStore((s) => s.jobs);
  const [filter, setFilter] = useState<JobFilter>('all');
  const [showMore, setShowMore] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const recent = useMemo(() => {
    const rows = jobs.filter((job) => {
      if (filter === 'processing') return job.status === 'running';
      if (filter === 'done') return job.status === 'succeeded';
      if (filter === 'failed') return job.status === 'failed' || job.status === 'orphaned';
      return true;
    });
    return rows.slice(0, 8);
  }, [filter, jobs]);

  const openDoor = (door: UploadDoor) => {
    const action = door.action;
    if (!action) return;
    if (action.kind === 'import') onImport(action.source);
    else if (action.kind === 'record') onRecord();
    else onNoMaterial();
  };

  const takeFiles = (list: FileList | null) => {
    const files = Array.from(list || []);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
      <Card padding="md">
        <h2 className="font-display text-title text-lantern-text">Let’s build your study set</h2>
        <p className="mt-1 text-body text-lantern-text-secondary">
          Drop any class materials below — slides, PDFs, photographed notes — and Lantern turns
          them into flashcards, quizzes and a study plan.
        </p>
      </Card>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          takeFiles(event.dataTransfer?.files ?? null);
        }}
      >
        <label
          htmlFor="study-set-upload-input"
          data-testid="upload-dropzone"
          className={`flex min-h-[12rem] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-lantern-primary-fill ${
            dragging
              ? 'border-lantern-text bg-lantern-background-secondary'
              : 'border-lantern-border hover:bg-lantern-background-secondary'
          }`}
        >
          <span
            aria-hidden="true"
            className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-lantern-feature-sets-tint"
          >
            <AppIcon name="cloud-upload" size={24} className="text-lantern-feature-sets-ink" />
          </span>
          <span className="block font-display text-heading text-lantern-text">
            Upload any files from class
          </span>
          <span className="mt-1 block text-caption text-lantern-text-secondary">
            Click to upload or drag and drop files — PDF, PowerPoint or photos, max 25 MB each
          </span>
          <input
            id="study-set-upload-input"
            ref={inputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              takeFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      <section aria-labelledby="upload-doors-heading">
        <h3 id="upload-doors-heading" className="sr-only">
          Other ways to add material
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {UPLOAD_DOORS_PRIMARY.map((door) => (
            <DoorButton key={door.id} door={door} onOpen={openDoor} />
          ))}
        </div>
        <button
          type="button"
          aria-expanded={showMore}
          aria-controls="upload-doors-more"
          onClick={() => setShowMore((was) => !was)}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-body font-medium text-lantern-text-secondary hover:text-lantern-text hover:underline"
        >
          <AppIcon name={showMore ? 'chevron-down' : 'chevron-forward'} size={16} aria-hidden="true" />
          View more upload types
        </button>
        {showMore ? (
          <div id="upload-doors-more" className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {UPLOAD_DOORS_MORE.map((door) => (
              <DoorButton key={door.id} door={door} onOpen={openDoor} />
            ))}
          </div>
        ) : (
          <div id="upload-doors-more" hidden />
        )}
      </section>

      <section className="rounded-2xl bg-lantern-feature-ai-tint/40 p-4">
        <h3 className="font-display text-heading text-lantern-text">
          Ask your friends to help upload materials
        </h3>
        <p className="mt-1 text-body text-lantern-text-secondary">
          Share this link with your classmates.
        </p>
        <button
          type="button"
          onClick={onCopyLink}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-3 py-2 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary"
        >
          <AppIcon name="link" size={16} aria-hidden="true" />
          Copy link
        </button>
      </section>

      <section className="rounded-2xl bg-lantern-feature-recording-tint/40 p-4">
        <h3 className="font-display text-heading text-lantern-text">
          Are you in class? Start a live lecture
        </h3>
        <p className="mt-1 text-body text-lantern-text-secondary">
          Record your lecture in real time and Lantern writes the notes from it.
        </p>
        <button
          type="button"
          onClick={onRecord}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-lantern-text px-3 py-2 text-body font-semibold text-lantern-surface hover:opacity-90"
        >
          <AppIcon name="mic" size={16} aria-hidden="true" />
          Start recording
        </button>
      </section>

      <section className="rounded-2xl bg-lantern-feature-sets-tint/40 p-4">
        <h3 className="font-display text-heading text-lantern-text">What is generated</h3>
        <ul className="mt-2 space-y-2">
          {UPLOAD_GENERATED.map((row) => (
            <li key={row.title} className="flex items-start gap-2">
              <AppIcon
                name="checkmark-circle"
                size={20}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-lantern-success"
              />
              <span>
                <span className="block text-body font-medium text-lantern-text">{row.title}</span>
                <span className="block text-caption text-lantern-text-secondary">{row.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-heading">Recent uploads</h3>
          <div className="flex flex-wrap gap-1">
            {(['all', 'processing', 'done', 'failed'] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`min-h-[36px] rounded-full border px-2.5 text-caption capitalize ${
                  filter === id
                    ? 'border-transparent bg-lantern-text text-lantern-surface'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">Nothing processing yet.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((job) => (
              <Card key={job.id} padding="md">
                <p className="truncate text-body font-semibold">{job.title}</p>
                <p className="text-caption capitalize text-lantern-text-secondary">{job.status}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default StudySetUpload;
