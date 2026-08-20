/**
 * Plain-text preview for markdown bodies. Note lists on both clients were
 * rendering raw markdown (### headings, **bold**, table pipes) as the card
 * preview; comparators (Notion, Evernote) show stripped text. This is a
 * lightweight regex pass for previews only — not a markdown parser, and not
 * meant for rendering.
 */
export function markdownToPreviewText(markdown: string | null | undefined): string {
  if (!markdown) return '';
  return (
    markdown
      // fenced code blocks: keep their contents, drop the fences
      .replace(/```[^\n]*\n?/g, '')
      // markdown table separator rows (|---|---|) vanish entirely
      .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
      // table pipes become spacing
      .replace(/\s*\|\s*/g, '  ')
      // headings, blockquotes, list markers at line start
      .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '')
      // emphasis/bold/strikethrough/inline code wrappers
      .replace(/(\*\*|__|\*|_|~~|`)/g, '')
      // images: keep alt text; links: keep label
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // collapse the whitespace the removals leave behind
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim()
  );
}
