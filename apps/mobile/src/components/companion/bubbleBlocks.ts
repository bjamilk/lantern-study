/**
 * Line-level parsing for a companion chat bubble.
 *
 * The model answers in light markdown — headings, bullets, numbered steps,
 * the occasional table or fenced snippet, `**bold**` and `(Excerpt 2)`
 * citations. A full markdown dependency is not worth the native-lockfile
 * churn, but the hand-rolled two-pattern version this replaces leaked raw
 * `#`, `|` and backticks into the bubble and had no notion of nesting.
 *
 * Pure and React-free on purpose: the renderer (BubbleText.tsx) is the only
 * thing that knows about views, and every construct below is unit-tested in
 * bubbleBlocks.test.ts without a renderer.
 */

export type InlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  /** `(Excerpt 3)` — a citation marker. Rendered as text until the chip lands. */
  | { kind: 'excerpt'; text: string; index: number };

export type TableRow = { cells: InlineRun[][]; isHeader: boolean };

export type BubbleBlock =
  /** `#`/`##`/`###`. Level is kept; the renderer decides the type step. */
  | { kind: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'bullet'; marker: string; depth: number; runs: InlineRun[] }
  /** A blank line or a horizontal rule: vertical breathing room, no content. */
  | { kind: 'gap' }
  | { kind: 'code'; text: string; language: string | null }
  | { kind: 'table'; rows: TableRow[] };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^([ \t]*)([-*•])\s+(.*)$/;
const NUMBERED = /^([ \t]*)(\d{1,3})[.)]\s+(.*)$/;
const FENCE = /^\s*```+\s*([A-Za-z0-9+#-]*)\s*$/;
const TABLE_LINE = /^\s*\|.*$/;
const TABLE_DIVIDER_CELL = /^:?-{1,}:?$/;

const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\(Excerpt\s+(\d+)\)/g;

/**
 * Markers that survived tokenising (an unclosed `**`, a stray backtick) are
 * scrubbed rather than shown: a visible `**` reads as a bug, and the brief for
 * this surface is that no raw markdown reaches the screen.
 */
function scrubMarkers(text: string): string {
  return text.replace(/\*\*|__|`/g, '');
}

function pushText(runs: InlineRun[], text: string): void {
  if (!text) return;
  const cleaned = scrubMarkers(text);
  if (cleaned) runs.push({ kind: 'text', text: cleaned });
}

/** `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `(Excerpt N)`. */
export function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text))) {
    pushText(runs, text.slice(last, m.index));
    if (m[1] !== undefined) runs.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) runs.push({ kind: 'bold', text: m[2] });
    else if (m[3] !== undefined) runs.push({ kind: 'bold', text: m[3] });
    else if (m[4] !== undefined) runs.push({ kind: 'italic', text: m[4] });
    else if (m[5] !== undefined) runs.push({ kind: 'italic', text: m[5] });
    else runs.push({ kind: 'excerpt', text: m[0], index: Number(m[6]) });
    last = m.index + m[0].length;
  }
  pushText(runs, text.slice(last));
  return runs;
}

/**
 * Models indent nested bullets by two spaces OR by four; both mean "one level
 * in", so the mapping is deliberately coarse and capped — a runaway indent
 * must not push text off the right edge of an 85%-wide bubble.
 */
export function depthFromIndent(indent: string): number {
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

function parseTable(lines: string[]): BubbleBlock {
  const rows: TableRow[] = [];
  for (const line of lines) {
    const cells = splitTableCells(line);
    if (isDividerRow(cells)) {
      // `|---|---|` is punctuation, not data: it only tells us the row above
      // it was the header.
      if (rows.length > 0) rows[rows.length - 1].isHeader = true;
      continue;
    }
    rows.push({ cells: cells.map((c) => inlineRuns(c)), isHeader: false });
  }
  return { kind: 'table', rows };
}

function pushGap(blocks: BubbleBlock[]): void {
  // Never lead with a gap, never stack two: a bubble that opens with empty
  // space looks like a rendering failure.
  if (blocks.length === 0) return;
  if (blocks[blocks.length - 1].kind === 'gap') return;
  blocks.push({ kind: 'gap' });
}

/** Parse one assistant (or user) message body into renderable blocks. */
export function bubbleBlocks(content: string): BubbleBlock[] {
  const lines = (content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: BubbleBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(FENCE);
    if (fence) {
      const language = fence[1] ? fence[1] : null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      // An unterminated fence still renders as code — the alternative is
      // showing the backticks.
      i += 1;
      blocks.push({ kind: 'code', text: body.join('\n'), language });
      continue;
    }

    if (TABLE_LINE.test(line) && line.includes('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && TABLE_LINE.test(lines[i])) {
        tableLines.push(lines[i]);
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
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, runs: inlineRuns(heading[2]) });
      continue;
    }

    const numbered = line.match(NUMBERED);
    if (numbered) {
      blocks.push({
        kind: 'bullet',
        marker: `${numbered[2]}.`,
        depth: depthFromIndent(numbered[1]),
        runs: inlineRuns(numbered[3]),
      });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      blocks.push({
        kind: 'bullet',
        marker: '•',
        depth: depthFromIndent(bullet[1]),
        runs: inlineRuns(bullet[3]),
      });
      continue;
    }

    blocks.push({ kind: 'paragraph', runs: inlineRuns(line.trim()) });
  }

  while (blocks.length > 0 && blocks[blocks.length - 1].kind === 'gap') blocks.pop();
  return blocks;
}

export default bubbleBlocks;
