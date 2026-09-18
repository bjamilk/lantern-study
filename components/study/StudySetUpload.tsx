import React, { useMemo, useState } from 'react';
import type { StudyUploadSource } from '@lantern/shared';
import { useAiJobStore } from '../../stores/aiJobStore';
import { Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_FILL } from '../ui/featureClasses';
import { LanternBrandIcon } from '../ui/LanternBrandIcon';
import {
  UPLOAD_ACCEPT,
  UPLOAD_DOORS_MORE,
  UPLOAD_DOORS_PRIMARY,
  UPLOAD_GENERATED,
  type UploadDoor,
} from './uploadDoors';

/**
 * Upload Materials — the `/study/sets/:id/add` page.
 *
 * WHY A PAGE AND NOT A MODAL. Measured off the reference on 2026-09-17
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Upload
 * Materials): `/addMaterial` is a full page inside the set room's chrome, not
 * an overlay. The doors, a checklist of what gets generated and two
 * invitations do not fit a dialog, and a dialog cannot be linked to, resumed
 * or reached with Back — which is the whole reason the room's tools are nested
 * routes.
 *
 * The anatomy, top to bottom, is the reference's: an intro bubble beside the
 * mascot, one big dashed dropzone that holds the illustration, the heading, the
 * click-or-drop line and the 3×2 door grid, then "view more upload types", then
 * the invite band, the live-lecture band and "what is generated". Only the
 * header above it is Lantern's own (#131).
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
 *    operable by Space, and it is why `htmlFor`/`id` must stay paired. The
 *    label covers the illustration and the copy but NOT the door buttons: a
 *    `<button>` inside a `<label>` is invalid HTML and the label eats the
 *    click. The dashed box around both is what reads as one drop target.
 *  - Drag-and-drop is an ADDITION to that input, not a replacement. A drop
 *    cannot be performed from a keyboard, so nothing may be reachable only
 *    that way.
 *  - Every door is live. A door Lantern cannot back is not drawn at all — see
 *    the header of `uploadDoors.ts` for what was dropped and why.
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

/**
 * Three fanned file cards — the reference's document illustration, redrawn in
 * Lantern's palette rather than traced.
 *
 * Inline SVG, never a bitmap: it is stroked in `currentColor` over one
 * tint-filled ground, which is §5.6's imagery rule, and it is the only way one
 * asset comes out right in both themes (the ink and tint variables change, the
 * markup does not).
 */
const DocumentStack: React.FC = () => (
  <svg
    viewBox="0 0 120 92"
    width="120"
    height="92"
    fill="none"
    aria-hidden="true"
    className={FEATURE_INK_TEXT.sets}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="60" cy="82" rx="42" ry="6" className={FEATURE_TINT_FILL.sets} />
    {/* Back card, fanned left. */}
    <g transform="rotate(-13 32 48)">
      <rect
        x="12"
        y="20"
        width="42"
        height="54"
        rx="6"
        className={FEATURE_TINT_FILL.sets}
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M20 34h26M20 44h26M20 54h16" stroke="currentColor" strokeWidth="2" />
    </g>
    {/* Back card, fanned right. */}
    <g transform="rotate(13 88 48)">
      <rect
        x="66"
        y="20"
        width="42"
        height="54"
        rx="6"
        className={FEATURE_TINT_FILL.sets}
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M74 34h26M74 44h26M74 54h16" stroke="currentColor" strokeWidth="2" />
    </g>
    {/* Front card, with the folded corner every document icon has. */}
    <path
      d="M40 12h26l14 14v48a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6Z"
      fill="currentColor"
      fillOpacity="0.06"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path d="M66 12v14h14" stroke="currentColor" strokeWidth="2" />
    <path d="M44 42h32M44 52h32M44 62h20" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/** One door: a white r8 hairline button, 16px icon on the left, 14/500 label. */
const DoorButton: React.FC<{ door: UploadDoor; onOpen: (door: UploadDoor) => void }> = ({
  door,
  onOpen,
}) => (
  <button type="button" onClick={() => onOpen(door)}
    className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-left transition-colors hover:bg-lantern-background-secondary"
  >
    <AppIcon
      name={door.icon}
      size={16}
      aria-hidden="true"
      className="shrink-0 text-lantern-feature-sets-ink"
    />
    <span className="truncate text-body font-medium text-lantern-text">{door.label}</span>
  </button>
);

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
    if (action.kind === 'import') onImport(action.source);
    else if (action.kind === 'record') onRecord();
    else onNoMaterial();
  };

  const takeFiles = (list: FileList | null) => {
    const files = Array.from(list || []);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="mx-auto w-full max-w-[728px] space-y-4 pb-6">
        {/* 1. Intro bubble — mascot, then a tinted card with the lead in bold. */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full"
          >
            <LanternBrandIcon size={40} />
          </span>
          <div className="min-w-0 flex-1 rounded-2xl bg-lantern-background-secondary px-6 py-5">
            <p className="text-body text-lantern-text-secondary">
              <span className="font-semibold text-lantern-text">
                Let’s build your study set.
              </span>{' '}
              Drop any class materials below — slides, PDFs, Word documents, photographed notes —
              and Lantern turns them into flashcards, quizzes and a study plan.
            </p>
          </div>
        </div>

        {/* 2. The dropzone. The whole dashed area is the drop target AND the
            file picker; the doors inside it stop their own clicks. */}
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
          <div
            data-testid="upload-dropzone"
            className={`rounded-2xl border border-dashed px-4 pb-6 pt-12 transition-colors focus-within:ring-2 focus-within:ring-lantern-primary-fill sm:px-6 ${
              dragging
                ? 'border-lantern-text bg-lantern-background-secondary'
                : 'border-lantern-text/60'
            }`}
          >
            {/* The label covers everything that is NOT a button, which is what
                makes "click anywhere to choose a file" true without nesting
                interactive elements inside a <label> (invalid HTML, and a
                click the label would swallow). */}
            <label
              htmlFor="study-set-upload-input"
              className="block cursor-pointer text-center"
            >
              <span className="mx-auto mb-4 block w-[120px]">
                <DocumentStack />
              </span>
              <span className="block font-display text-title text-lantern-text">
                Upload any files from Class
              </span>
              <span className="mt-1 block text-body text-lantern-text-secondary">
                <span className="font-semibold text-lantern-text">Click to upload</span> or drag
                and drop files — max 25 MB each
              </span>
              <input
                id="study-set-upload-input"
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

            <div className="mt-6" role="group" aria-labelledby="upload-doors-heading">
              <h3 id="upload-doors-heading" className="sr-only">
                Other ways to add material
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {UPLOAD_DOORS_PRIMARY.map((door) => (
                  <DoorButton key={door.id} door={door} onOpen={openDoor} />
                ))}
              </div>
              <div className="text-center">
                <button
                  type="button"
                  aria-expanded={showMore}
                  aria-controls="upload-doors-more"
                  onClick={() => setShowMore((was) => !was)}
                  className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-body font-medium text-lantern-text-secondary hover:text-lantern-text hover:underline"
                >
                  View more upload types
                  <AppIcon
                    name={showMore ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {showMore ? (
                <div id="upload-doors-more" className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {UPLOAD_DOORS_MORE.map((door, index) => (
                    <div
                      key={door.id}
                      // An odd last door is centred across both columns, the
                      // reference's "two, then one" shape.
                      className={
                        index === UPLOAD_DOORS_MORE.length - 1 && UPLOAD_DOORS_MORE.length % 2 === 1
                          ? 'sm:col-span-2 sm:mx-auto sm:w-1/2'
                          : undefined
                      }
                    >
                      <DoorButton door={door} onOpen={openDoor} />
                    </div>
                  ))}
                </div>
              ) : (
                <div id="upload-doors-more" hidden />
              )}
            </div>
          </div>
        </div>

        {/* 3. Invite band. Lantern has a real share link for a set — but not
            collaborative upload, so the copy says share, not "help upload". */}
        <section className="flex flex-wrap items-center gap-3 rounded-xl bg-lantern-feature-tests-tint px-4 py-3">
          <AppIcon
            name="people"
            size={20}
            aria-hidden="true"
            className="shrink-0 text-lantern-feature-tests-ink"
          />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-lantern-text">
              Share this set with your classmates
            </p>
            <p className="text-caption text-lantern-text-secondary">
              They can open everything in it. Uploading to it is still yours alone.
            </p>
          </div>
          <button
            type="button"
            onClick={onCopyLink}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-3 py-2 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            <AppIcon name="link" size={16} aria-hidden="true" />
            Copy Link
          </button>
        </section>

        {/* 4. Live lecture band. */}
        <section className="flex flex-wrap items-center gap-3 rounded-xl bg-lantern-feature-recording-tint px-4 py-3">
          <AppIcon
            name="mic"
            size={20}
            aria-hidden="true"
            className="shrink-0 text-lantern-feature-recording-ink"
          />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-lantern-text">
              Are you in class? Start a live lecture
            </p>
            <p className="text-caption text-lantern-text-secondary">
              Record your lecture in real time and Lantern writes the notes, a recap and study
              materials from it.
            </p>
          </div>
          <button
            type="button"
            onClick={onRecord}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-3 py-2 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            <AppIcon name="mic" size={16} aria-hidden="true" />
            Start Recording
          </button>
        </section>

        {/* 5. What an upload actually produces. */}
        <section className="rounded-xl bg-lantern-background-secondary px-4 py-4">
          <h3 className="font-display text-heading text-lantern-text">What is generated</h3>
          <ul className="mt-3 space-y-3">
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
                  <span className="block text-caption text-lantern-text-secondary">
                    {row.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Lantern's own, below the reference's fold: what is still processing. */}
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
                  <p className="text-caption capitalize text-lantern-text-secondary">
                    {job.status}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default StudySetUpload;
