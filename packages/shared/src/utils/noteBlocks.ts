/**
 * Line-level parsing for a study note body.
 *
 * Notes are stored as a light markdown subset: `#`/`##`/`###` headings, `-`
 * bullets (sometimes nested), numbered steps, `**key terms**`, the occasional
 * table, fenced snippet or transcript timestamp. Rendering that body in one
 * type step — which is what the mobile studios did — puts `## Overview` and
 * `**term**` on screen literally, at the same size as the sentence under them.
 *
 * This module is the shared, React-free half of the fix: it turns a body into
 * blocks with a level, and the renderers (web's `NoteReadingView`, mobile's
 * `NoteBody`) decide the type steps. Machine markers — the Smart Notes
 * sentinels, the lesson snapshot fence, any other HTML comment — are stripped
 * before parsing, so nothing meant for the code reaches a student's eyes.
 *
 * CONSUMERS: web's `NoteReadingView` and mobile's `components/NoteBody.tsx` /
 * `bubbleBlocks.ts`. Also the note preview strings on cards and in search.
 * Not used by the api — the server stores note bodies verbatim.
 *
 * WHY IT IS REACT-FREE: the two renderers draw blocks very differently (web
 * has real CSS, mobile has a hand-rolled renderer with no markdown library),
 * but they must AGREE on what the body means. Parsing is shared; presentation
 * is not.
 *
 * MARKER STRIPPING IS A CORRECTNESS RULE, NOT TIDINESS: Smart Notes sentinels,
 * the lesson snapshot fence and any other HTML comment are machine
 * instructions. `stripNoteMarkers` must run before anything a student sees,
 * including previews — a leaked sentinel is internal state rendered as content.
 *
 * `bubbleBlocks.ts` in the mobile companion is the chat-shaped cousin of this
 * file. It is deliberately not shared: bubbles have citations and no title,
 * notes have timestamps, quotes and a title. Conventions are kept in sync by
 * hand.
 */
import { markdownToPreviewText } from './markdownPreview';
import { SMART_NOTES_END, SMART_NOTES_START } from './smartNotes';

export type NoteInlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string };

export type NoteTableRow = { cells: NoteInlineRun[][]; isHeader: boolean };

export type NoteBlock =
  /** `#` — the note's own title line. */
  | { kind: 'title'; runs: NoteInlineRun[] }
  /** `##` — a section. The big step. */
  | { kind: 'heading'; runs: NoteInlineRun[] }
  /** `###` and deeper — a sub-section. Body size, semibold. */
  | { kind: 'subheading'; runs: NoteInlineRun[] }
  | { kind: 'paragraph'; runs: NoteInlineRun[] }
  | { kind: 'bullet'; marker: string; depth: number; runs: NoteInlineRun[] }
  | { kind: 'quote'; runs: NoteInlineRun[] }
  /** A transcript gutter line: `00:36` or `[00:36] …`. Caption-toned. */
  | { kind: 'timestamp'; time: string; runs: NoteInlineRun[] }
  /** A blank line or a horizontal rule: breathing room, no content. */
  | { kind: 'gap' }
  | { kind: 'code'; text: string; language: string | null }
  | { kind: 'table'; rows: NoteTableRow[] };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^([ \t]*)([-*+•])\s+(.*)$/;
const NUMBERED = /^([ \t]*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s*```+\s*([A-Za-z0-9+#_-]*)\s*$/;
const TABLE_LINE = /^\s*\|.*$/;
const TABLE_DIVIDER_CELL = /^:?-{1,}:?$/;
const TIMESTAMP = /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–—:]?\s*(.*)$/;

const LINK = /\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g;
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g;

/** Every `<!-- … -->`, which covers both Smart Notes sentinels. */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/**
 * The lesson studio stores its session snapshot in a ```lantern-lesson fence
 * (see learning/lessonStudio.ts). It is JSON for the player, never prose.
 * Inlined here rather than imported so this module stays dependency-light.
 */
const LESSON_FENCE_BLOCK = /```lantern-lesson[\s\S]*?```/g;

/**
 * Remove machine markers from a note body.
 *
 * Content between the Smart Notes sentinels is kept — it is the generated
 * note. Only the sentinels themselves go.
 */
// ---------------------------------------------------------------------------
// Stripping machine markers, and short previews
// ---------------------------------------------------------------------------
// `noteTypedPreview` keeps the first meaningful line with its type level;
// `notePlainPreview` flattens to plain text for cards and search. Both strip
// markers first.

export function stripNoteMarkers(body: string | null | undefined): string {
  if (!body) return '';
  return body
    .replace(/\r\n?/g, '\n')
    .split(SMART_NOTES_START)
    .join('')
    .split(SMART_NOTES_END)
    .join('')
    .replace(LESSON_FENCE_BLOCK, '')
    .replace(HTML_COMMENT, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * One flat, plain-text line for a note preview: a tile, a list row, a search
 * result. The set room's "Recent materials" tiles were showing the body raw,
 * so a preview read `## Overview **Pancreatitis** - inflammation` instead of a
 * sentence.
 *
 * Markers go first (`stripNoteMarkers`), then the markdown syntax
 * (`markdownToPreviewText`), then the legacy HTML some older bodies still
 * carry from the rich-text editor that preceded markdown. Previews only —
 * `noteBlocks` is still what renders a note.
 */
/** The lesson fence again, this time keeping what is inside it. */
const LESSON_FENCE_NAME = 'lantern-lesson';
const LESSON_FENCE_CAPTURE = /```lantern-lesson\s*([\s\S]*?)```/;

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text || !/^[[{]/.test(text)) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return { pages: parsed };
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The preview for a note whose body is MACHINE DATA rather than prose.
 *
 * A lesson-studio note stores its whole session — pages, transcript and the
 * `check` questions WITH THEIR ANSWERS — as JSON (`composeLessonNoteBody`).
 * `markdownToPreviewText` keeps the contents of a fence and only drops the
 * ``` lines, so the notes list on both clients was printing that JSON as the
 * row preview: a wall of braces, and every answer the lesson was about to ask
 * for, spoiled in the list and read aloud by the screen reader.
 *
 * Returns a typed line for such bodies, and null for ordinary prose — the
 * caller falls through to the normal stripper. Never returns any fragment of
 * the data itself.
 */
/**
 * Does this text open machine data it never closes — i.e. is it a TRUNCATED
 * snapshot rather than prose?
 *
 * Deliberately narrow, because the fallback it overrides is the prose
 * stripper: only an UNCLOSED lesson fence (the caller has already failed to
 * match a closed one) or a body that opens with a JSON key and does not
 * parse. Prose that merely starts with a brace — `{this is not json} and the
 * rest of the note` — is prose, and still reads as itself.
 */
function isTruncatedMachineData(body: string): boolean {
  const text = body.trim();
  if (text.includes('```' + LESSON_FENCE_NAME)) return true;
  if (!/^\{\s*"|^\[\s*\{/.test(text)) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

export function noteTypedPreview(body: string | null | undefined): string | null {
  if (!body) return null;
  const fenced = body.match(LESSON_FENCE_CAPTURE)?.[1];
  const snapshot = fenced !== undefined ? parseJsonObject(fenced) : parseJsonObject(body);
  if (!snapshot) {
    // A fence that is present but unparseable is still machine data; saying
    // so beats printing the half-JSON that survived.
    if (fenced !== undefined && fenced.trim()) return 'Structured note';
    // So is a body that OPENS as JSON and fails to parse — which is what a
    // TRUNCATED snapshot looks like. Home's "Recent materials" tiles were
    // built from a server-side `body.slice(0, 120)`, so a mastery note's
    // fence never closed, nothing parsed, and the tile printed the raw
    // braces of the plan (AH smoke 1.0.58). The slice is fixed at source;
    // this is the guard for every prefix that was already handed out.
    if (isTruncatedMachineData(body)) return 'Structured note';
    return null;
  }
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages.length : 0;
  const isPlan = pages > 0 && (snapshot.mode === 'mastery' || snapshot.mode === 'explore');
  if (!isPlan) return 'Structured note';
  const kind = snapshot.mode === 'mastery' ? 'Mastery plan' : 'Explore plan';
  return `${kind} · ${pages} ${pages === 1 ? 'step' : 'steps'}`;
}

export function notePlainPreview(body: string | null | undefined, max = 160): string {
  const typed = noteTypedPreview(body);
  if (typed) return typed;
  const stripped = stripNoteMarkers(body).replace(/<[^>]+>/g, ' ');
  const plain = markdownToPreviewText(stripped).replace(/\s+/g, ' ').trim();
  if (!plain) return '';
  return plain.length > max ? `${plain.slice(0, max).trim()}\u2026` : plain;
}

/**
 * Leftovers that survived tokenising (an unclosed `**`, a stray backtick, a
 * lone `<!--`) are scrubbed rather than shown: a visible `**` reads as a bug,
 * and the brief for this surface is that no raw markdown reaches the screen.
 */
function scrubMarkers(text: string): string {
  return text.replace(/<!--|-->/g, '').replace(/\*\*|__|`/g, '');
}

function pushText(runs: NoteInlineRun[], text: string): void {
  if (!text) return;
  const cleaned = scrubMarkers(text);
  if (cleaned) runs.push({ kind: 'text', text: cleaned });
}

/** `[label](href)` → `label`. Notes are read, not browsed. */
function flattenLinks(text: string): string {
  LINK.lastIndex = 0;
  return text.replace(LINK, (_match, label: string, href: string) => label || href || '');
}

/** `**bold**`, `*italic*`/`_italic_`, `` `code` ``, links flattened to text. */
// ---------------------------------------------------------------------------
// Inline runs and indentation
// ---------------------------------------------------------------------------
// Within a line: bold key terms, code spans, plain text. Indent depth is
// computed from leading whitespace, tolerating tabs and mixed indentation,
// because note bodies come from students, OCR and the model alike.

export function noteInlineRuns(text: string): NoteInlineRun[] {
  const source = flattenLinks(text);
  const runs: NoteInlineRun[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(source))) {
    pushText(runs, source.slice(last, m.index));
    // Exactly one alternative of INLINE can match, but the compiler cannot
    // know that: every group reads as `string | undefined`, so the last one
    // is tested like the rest rather than trusted as the `else`.
    const [, code, boldStars, boldUnderscores, italicStar, italicUnderscore] = m;
    if (code !== undefined) runs.push({ kind: 'code', text: code });
    else if (boldStars !== undefined) runs.push({ kind: 'bold', text: boldStars });
    else if (boldUnderscores !== undefined) runs.push({ kind: 'bold', text: boldUnderscores });
    else if (italicStar !== undefined) runs.push({ kind: 'italic', text: italicStar });
    else if (italicUnderscore !== undefined) runs.push({ kind: 'italic', text: italicUnderscore });
    last = m.index + m[0].length;
  }
  pushText(runs, source.slice(last));
  return runs;
}

/**
 * Writers (and models) indent a nested bullet by two spaces OR by four; both
 * mean "one level in", so the mapping is coarse and capped — a runaway indent
 * must not push text off the right edge of a phone.
 */
export function noteDepthFromIndent(indent: string): number {
  const spaces = indent.replace(/\t/g, '    ').length;
  const units = Math.floor(spaces / 2);
  if (units <= 0) return 0;
  if (units <= 2) return 1;
  if (units <= 4) return 2;
  return 3;
}

function isDividerRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => TABLE_DIVIDER_CELL.test(c.trim()));
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parseTable(lines: string[]): NoteBlock {
  const rows: NoteTableRow[] = [];
  for (const line of lines) {
    const cells = splitTableCells(line);
    if (isDividerRow(cells)) {
      // `|---|---|` is punctuation, not data: it only says the row above it
      // was the header.
      const previous = rows[rows.length - 1];
      if (previous) previous.isHeader = true;
      continue;
    }
    rows.push({ cells: cells.map((c) => noteInlineRuns(c)), isHeader: false });
  }
  return { kind: 'table', rows };
}

function pushGap(blocks: NoteBlock[]): void {
  // Never lead with a gap, never stack two: a note that opens with empty space
  // looks like a rendering failure.
  const previous = blocks[blocks.length - 1];
  if (!previous) return;
  if (previous.kind === 'gap') return;
  blocks.push({ kind: 'gap' });
}

/**
 * Parse a note body into renderable blocks. Unknown syntax degrades to a
 * paragraph; no `#`, `**`, `|`, backtick or `<!--` survives into visible text.
 */
// ---------------------------------------------------------------------------
// The block parser
// ---------------------------------------------------------------------------
// Body in, typed blocks out: headings with a level, bullets with a depth,
// numbered steps, tables, fenced snippets, transcript timestamps, paragraphs.
// Anything unrecognised becomes a paragraph rather than being dropped.

export function noteBlocks(body: string | null | undefined): NoteBlock[] {
  const lines = stripNoteMarkers(body).split('\n');
  const blocks: NoteBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    // `i < lines.length` already guarantees a string; the fallback is how the
    // compiler is told so, and an empty line is the harmless reading anyway.
    const line = lines[i] ?? '';

    const fence = line.match(FENCE);
    if (fence) {
      const language = fence[1] ? fence[1] : null;
      const chunk: string[] = [];
      i += 1;
      while (i < lines.length) {
        const inside = lines[i] ?? '';
        if (FENCE.test(inside)) break;
        chunk.push(inside);
        i += 1;
      }
      // An unterminated fence still renders as code — the alternative is
      // showing the backticks.
      i += 1;
      blocks.push({ kind: 'code', text: chunk.join('\n'), language });
      continue;
    }

    if (TABLE_LINE.test(line) && line.includes('|')) {
      const tableLines: string[] = [];
      while (i < lines.length) {
        const row = lines[i] ?? '';
        if (!TABLE_LINE.test(row)) break;
        tableLines.push(row);
        i += 1;
      }
      const table = parseTable(tableLines);
      if (table.kind === 'table' && table.rows.length > 0) blocks.push(table);
      continue;
    }

    i += 1;

    if (!line.trim()) {
      pushGap(blocks);
      continue;
    }
    if (HR.test(line)) {
      pushGap(blocks);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      // Both groups are mandatory in HEADING, but a capture reads as
      // `string | undefined` either way.
      const level = (heading[1] ?? '').length;
      const runs = noteInlineRuns(heading[2] ?? '');
      if (level === 1) blocks.push({ kind: 'title', runs });
      else if (level === 2) blocks.push({ kind: 'heading', runs });
      else blocks.push({ kind: 'subheading', runs });
      continue;
    }

    const numbered = line.match(NUMBERED);
    if (numbered) {
      blocks.push({
        kind: 'bullet',
        marker: `${numbered[2] ?? ''}.`,
        depth: noteDepthFromIndent(numbered[1] ?? ''),
        runs: noteInlineRuns(numbered[3] ?? ''),
      });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      blocks.push({
        kind: 'bullet',
        marker: '•',
        depth: noteDepthFromIndent(bullet[1] ?? ''),
        runs: noteInlineRuns(bullet[3] ?? ''),
      });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      blocks.push({ kind: 'quote', runs: noteInlineRuns(quote[1] ?? '') });
      continue;
    }

    const stamp = line.match(TIMESTAMP);
    if (stamp) {
      blocks.push({ kind: 'timestamp', time: stamp[1] ?? '', runs: noteInlineRuns(stamp[2] ?? '') });
      continue;
    }

    blocks.push({ kind: 'paragraph', runs: noteInlineRuns(line.trim()) });
  }

  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (!last || last.kind !== 'gap') break;
    blocks.pop();
  }
  return blocks;
}

/** Flatten runs back to plain text — for accessibility labels and search. */
export function noteBlockText(block: NoteBlock): string {
  if (block.kind === 'gap') return '';
  if (block.kind === 'code') return block.text;
  if (block.kind === 'table') {
    return block.rows
      .map((row) => row.cells.map((cell) => cell.map((run) => run.text).join('')).join(' · '))
      .join('\n');
  }
  const runs = block.runs.map((run) => run.text).join('');
  return block.kind === 'timestamp' ? `${block.time} ${runs}`.trim() : runs;
}

export default noteBlocks;
