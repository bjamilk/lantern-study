import React from "react";
import {
  filterJobMessageTemplates,
  type JobMessageTemplateKind,
} from "@lantern/shared";

interface Props {
  kind: JobMessageTemplateKind;
  onSelect: (body: string) => void;
  disabled?: boolean;
}

/** Inserts canned recruiter copy into a note or details field. */
export function JobMessageTemplatePicker({ kind, onSelect, disabled }: Props) {
  const templates = filterJobMessageTemplates(kind);
  if (!templates.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(template.body)}
          className="rounded-full border border-lantern-border bg-lantern-background px-2.5 py-1 text-[11px] font-medium text-lantern-text-secondary hover:border-lantern-primary hover:text-lantern-primary disabled:opacity-50"
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}

export default JobMessageTemplatePicker;
