import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { stripNoteMarkers } from '@lantern/shared/utils/noteBlocks';
import type { MdProps } from '../ui/markdownProps';

/**
 * The rendered reading state for a note body.
 *
 * Notes are stored as light markdown. Showing that raw — which is what the
 * studios did, in one textarea at one size — puts `## Overview` and `**term**`
 * on screen literally. This renders the same body as a real hierarchy on four
 * type steps: `text-display` in the serif for the note's own `#`, `text-title`
 * in the serif for a `##` section, `text-heading` for a `###` sub-section,
 * `text-body` for prose and bullets. The first draft put `##` on `text-heading`
 * and `###` on `text-body`, a 17-over-15 step that reads flat on a phone, so
 * every heading role moved one step up and the two display steps took the
 * serif — the size change is what carries the hierarchy, not the weight.
 * Bullets indent 24 px per level, a heading gets 20 px of air above it,
 * paragraphs 12 px between them.
 *
 * The body is stripped of machine markers (Smart Notes sentinels, the lesson
 * snapshot fence, any HTML comment) before it reaches the renderer, so nothing
 * meant for the code can surface as text.
 *
 * Both study studios and the read-only note view share this component; the
 * mobile twin is `apps/mobile/src/components/NoteBody.tsx`.
 */

const TIMESTAMP_LINE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/;

/**
 * A transcript gutter time (`00:36`, `[00:36]`) leads its paragraph. It reads
 * as a caption in the secondary ink; the sentence after it stays body prose,
 * so a paragraph is not demoted just because it carries a timestamp.
 */
function withTimestampGutter(children: React.ReactNode): React.ReactNode {
  const list = React.Children.toArray(children);
  const first = list[0];
  if (typeof first !== 'string') return children;
  const match = first.match(TIMESTAMP_LINE);
  if (!match) return children;
  const rest = first.slice(match[0].length);
  return [
    <span key="stamp" className="text-caption text-lantern-text-secondary mr-1.5">
      {match[1]}
    </span>,
    rest,
    ...list.slice(1),
  ];
}

const noteMarkdownComponents = {
  h1: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => (
    <h1 className="text-display font-display font-semibold text-lantern-text mt-5 first:mt-0 mb-2" {...props} />
  ),
  h2: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => (
    <h2 className="text-title font-display font-semibold text-lantern-text mt-5 first:mt-0 mb-2" {...props} />
  ),
  h3: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => (
    <h3 className="text-heading font-semibold text-lantern-text mt-5 first:mt-0 mb-1" {...props} />
  ),
  h4: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => (
    <h4 className="text-body font-semibold text-lantern-text mt-4 first:mt-0 mb-1" {...props} />
  ),
  h5: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => (
    <h5 className="text-body font-semibold text-lantern-text mt-4 first:mt-0 mb-1" {...props} />
  ),
  h6: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => (
    <h6 className="text-body font-semibold text-lantern-text mt-4 first:mt-0 mb-1" {...props} />
  ),
  p: ({ node: _node, children, ...props }: MdProps<React.HTMLAttributes<HTMLParagraphElement>>) => (
    <p className="text-body text-lantern-text mb-3 last:mb-0" {...props}>
      {withTimestampGutter(children)}
    </p>
  ),
  ul: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLUListElement>>) => (
    <ul className="mb-3 last:mb-0 pl-6 list-disc space-y-1" {...props} />
  ),
  ol: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLOListElement>>) => (
    <ol className="mb-3 last:mb-0 pl-6 list-decimal space-y-1" {...props} />
  ),
  li: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLLIElement>>) => (
    <li className="text-body text-lantern-text" {...props} />
  ),
  strong: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLElement>>) => (
    <strong className="font-semibold text-lantern-text" {...props} />
  ),
  em: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLElement>>) => (
    <em className="italic" {...props} />
  ),
  blockquote: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLQuoteElement>>) => (
    <blockquote
      className="mb-3 last:mb-0 border-l-2 border-lantern-border pl-3 text-body text-lantern-text-secondary"
      {...props}
    />
  ),
  code: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLElement>>) => (
    <code
      className="rounded bg-lantern-background px-1 py-0.5 font-mono text-caption text-lantern-text"
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLPreElement>>) => (
    <pre
      className="mb-3 last:mb-0 overflow-x-auto rounded-xl border border-lantern-border bg-lantern-background p-3 text-caption"
      {...props}
    />
  ),
  hr: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHRElement>>) => (
    <hr className="my-4 border-t border-lantern-border" {...props} />
  ),
  a: ({ node: _node, ...props }: MdProps<React.AnchorHTMLAttributes<HTMLAnchorElement>>) => (
    <a className="underline" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  table: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLTableElement>>) => (
    <div className="mb-3 last:mb-0 overflow-x-auto">
      <table className="w-full border-collapse text-body" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLTableCellElement>>) => (
    <th
      className="border border-lantern-border px-2 py-1 text-left text-body font-semibold"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLTableCellElement>>) => (
    <td className="border border-lantern-border px-2 py-1 text-body align-top" {...props} />
  ),
};

/**
 * CommonMark folds a single newline into a space, but typed notes (and the
 * lecture studio's timestamped paragraphs) use plain newlines as line breaks.
 * Convert them to hard breaks — except inside a fence, where they are literal.
 */
function withHardBreaks(content: string): string {
  return content
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith('```') ? part : part.replace(/(?<!\n)\n(?!\n)/g, '  \n')))
    .join('');
}

export interface NoteReadingViewProps {
  body: string | null | undefined;
  className?: string;
  /** Shown when the note has no body yet. */
  emptyLine?: string;
}

export const NoteReadingView: React.FC<NoteReadingViewProps> = ({
  body,
  className,
  emptyLine = 'This note is empty. Edit it to add study content.',
}) => {
  const clean = stripNoteMarkers(body);
  if (!clean) {
    return <p className={`text-body text-lantern-text-tertiary ${className || ''}`}>{emptyLine}</p>;
  }
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={noteMarkdownComponents}>
        {withHardBreaks(clean)}
      </ReactMarkdown>
    </div>
  );
};

export default NoteReadingView;
