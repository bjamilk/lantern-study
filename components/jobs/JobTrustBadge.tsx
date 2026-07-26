import React from "react";
import type { JobEmployerTrustPresentation } from "@lantern/shared";

const TONE_CLASS: Record<JobEmployerTrustPresentation["tone"], string> = {
  positive:
    "bg-emerald-100 text-emerald-800 border-emerald-200",
  caution: "bg-amber-100 text-amber-900 border-amber-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

/** Compact chip for verified / unverified / individual poster trust. */
export function JobTrustBadge({
  trust,
  compact,
}: {
  trust: JobEmployerTrustPresentation;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wide ${
        TONE_CLASS[trust.tone]
      } ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"}`}
    >
      {trust.kind === "verified_company" && !compact
        ? "Verified company"
        : trust.kind === "verified_company"
          ? "Verified"
          : trust.label}
    </span>
  );
}
