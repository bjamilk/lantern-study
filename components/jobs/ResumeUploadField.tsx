import React, { useRef, useState } from "react";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import {
  JOB_RESUME_ACCEPT_ATTRIBUTE,
  JOB_RESUME_ACCEPT_LABEL,
  JOB_RESUME_MAX_BYTES,
  formatJobResumeSize,
  type JobApplicantProfile,
} from "@lantern/shared";
import { uploadJobResume } from "../../services/jobsBoard";

interface Props {
  profile: JobApplicantProfile | null;
  onUploaded: (profile: JobApplicantProfile) => void;
  /** Explains that the file is reused for later applications. */
  showReuseHint?: boolean;
}

export function ResumeUploadField({
  profile,
  onUploaded,
  showReuseHint = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasResume = !!profile?.resumePath;
  const size = formatJobResumeSize(profile?.resumeSizeBytes);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file still fires a change event.
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const res = await uploadJobResume(file);
      onUploaded(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resume upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <p className="text-sm font-medium text-lantern-text">Resume</p>

      {hasResume ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 rounded-lg border border-lantern-border bg-lantern-background p-3">
          <DocumentTextIcon
            className="h-8 w-8 shrink-0 text-lantern-primary"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-lantern-text">
              {profile?.resumeFilename || "Your resume"}
            </p>
            <p className="mt-0.5 text-xs text-lantern-text-tertiary">
              {size ? `${size} · ` : ""}Saved to your profile
            </p>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text transition hover:border-lantern-primary/40 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Replace"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-lantern-border bg-lantern-background px-4 py-6 text-center transition hover:border-lantern-primary/50 disabled:opacity-50"
        >
          <DocumentTextIcon
            className="h-7 w-7 text-lantern-text-tertiary"
            aria-hidden
          />
          <span className="text-sm font-semibold text-lantern-primary">
            {uploading ? "Uploading…" : "Upload your resume"}
          </span>
          <span className="text-xs text-lantern-text-tertiary">
            {JOB_RESUME_ACCEPT_LABEL}, up to{" "}
            {formatJobResumeSize(JOB_RESUME_MAX_BYTES)}
          </span>
        </button>
      )}

      {showReuseHint && hasResume ? (
        <p className="mt-1.5 text-xs text-lantern-text-tertiary">
          This resume is attached to new applications automatically.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={JOB_RESUME_ACCEPT_ATTRIBUTE}
        onChange={(event) => void handleChange(event)}
        className="hidden"
      />
    </div>
  );
}

export default ResumeUploadField;
