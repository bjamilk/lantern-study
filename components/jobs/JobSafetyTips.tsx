import React from "react";
import { JOBS_CANDIDATE_SAFETY_TIPS } from "@lantern/shared";

export function JobSafetyTips({ className }: { className?: string }) {
  return (
    <div
      className={
        className ||
        "rounded-lg border border-lantern-border bg-lantern-background px-3 py-2"
      }
    >
      <p className="text-xs font-semibold text-lantern-text">Stay safe</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-lantern-text-tertiary">
        {JOBS_CANDIDATE_SAFETY_TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}
