import React, { useEffect, useState } from "react";
import {
  JOB_APPLICATION_NOTE_MAX_LENGTH,
  type JobApplicationNote,
} from "@lantern/shared";
import {
  createJobApplicationNote,
  deleteJobApplicationNote,
  fetchJobApplicationNotes,
} from "../../services/jobsBoard";

interface Props {
  applicationId: string;
  currentUserId?: string | null;
  /** Lets the pipeline keep its per-card badge in step with the thread. */
  onCountChange?: (applicationId: string, count: number) => void;
}

function formatNoteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function JobApplicantNotes({
  applicationId,
  currentUserId,
  onCountChange,
}: Props) {
  const [notes, setNotes] = useState<JobApplicationNote[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobApplicationNotes(applicationId)
      .then((res) => {
        if (!active) return;
        const loaded = res.data || [];
        setNotes(loaded);
        onCountChange?.(applicationId, loaded.length);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load notes");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  const addNote = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createJobApplicationNote(applicationId, body);
      setNotes((prev) => {
        const next = [res.data, ...prev];
        onCountChange?.(applicationId, next.length);
        return next;
      });
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the note");
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (noteId: string) => {
    const previous = notes;
    const next = notes.filter((note) => note.id !== noteId);
    setNotes(next);
    onCountChange?.(applicationId, next.length);
    try {
      await deleteJobApplicationNote(noteId);
    } catch (e) {
      setNotes(previous);
      onCountChange?.(applicationId, previous.length);
      setError(e instanceof Error ? e.message : "Could not delete the note");
    }
  };

  const remaining = JOB_APPLICATION_NOTE_MAX_LENGTH - draft.length;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-lantern-text">
          Private notes
        </h3>
        <p className="text-xs text-lantern-text-tertiary">
          Only your hiring team can see these
        </p>
      </div>

      <div>
        <label htmlFor="job-note-draft" className="sr-only">
          Add a note about this candidate
        </label>
        <textarea
          id="job-note-draft"
          rows={3}
          value={draft}
          maxLength={JOB_APPLICATION_NOTE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Strong portfolio, available from September…"
          className="w-full resize-y rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text placeholder:text-lantern-text-tertiary focus:border-lantern-primary focus:outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-xs text-lantern-text-tertiary">
            {remaining < 200 ? `${remaining} characters left` : ""}
          </span>
          <button
            type="button"
            disabled={!draft.trim() || saving}
            onClick={() => void addNote()}
            className="rounded-lg bg-lantern-primary px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-lantern-text-tertiary">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-lantern-text-tertiary">
          No notes yet. Record why you advanced or passed on this candidate.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-lantern-border bg-lantern-background p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-lantern-text-secondary">
                  {note.author?.name || note.author?.username || "Teammate"}
                  <span className="ml-2 font-normal text-lantern-text-tertiary">
                    {formatNoteDate(note.createdAt)}
                  </span>
                </p>
                {note.authorId === currentUserId ? (
                  <button
                    type="button"
                    onClick={() => void removeNote(note.id)}
                    className="shrink-0 text-xs font-medium text-lantern-text-tertiary underline hover:text-red-600"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-lantern-text">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default JobApplicantNotes;
