import { SMART_NOTES_END, SMART_NOTES_START } from './smartNotes';
import {
  noteBlockText,
  noteBlocks,
  noteDepthFromIndent,
  noteInlineRuns,
  notePlainPreview,
  noteTypedPreview,
  stripNoteMarkers,
  type NoteBlock,
} from './noteBlocks';

const kinds = (blocks: NoteBlock[]) => blocks.map((b) => b.kind);
const visible = (blocks: NoteBlock[]) => blocks.map(noteBlockText).join('\n');

describe('noteBlocks', () => {
  it('separates the three heading levels', () => {
    const blocks = noteBlocks('# Cell Biology\n## Overview\n### Organelles\nMitochondria make ATP.');
    expect(kinds(blocks)).toEqual(['title', 'heading', 'subheading', 'paragraph']);
    expect(noteBlockText(blocks[0])).toBe('Cell Biology');
    expect(noteBlockText(blocks[1])).toBe('Overview');
    expect(visible(blocks)).not.toContain('#');
  });

  it('reads deeper headings as sub-headings rather than losing them', () => {
    expect(kinds(noteBlocks('#### Deep\n##### Deeper'))).toEqual(['subheading', 'subheading']);
  });

  it('nests bullets by two-space or four-space indent and by tab', () => {
    // Two spaces and four spaces both mean "one level in"; eight is level two.
    const blocks = noteBlocks('- Top\n  - Two space\n    - Four space\n\t- Tab\n        - Eight');
    expect(kinds(blocks)).toEqual(['bullet', 'bullet', 'bullet', 'bullet', 'bullet']);
    const depths = blocks.map((b) => (b.kind === 'bullet' ? b.depth : -1));
    expect(depths).toEqual([0, 1, 1, 1, 2]);
    expect(blocks.every((b) => b.kind === 'bullet' && b.marker === '•')).toBe(true);
  });

  it('keeps a numbered item numbered', () => {
    const blocks = noteBlocks('1. First\n2) Second');
    expect(blocks.map((b) => (b.kind === 'bullet' ? b.marker : ''))).toEqual(['1.', '2.']);
    expect(visible(blocks)).toBe('First\nSecond');
  });

  it('marks key terms bold and never shows the asterisks', () => {
    const runs = noteInlineRuns('The **mitochondrion** is the *powerhouse* of `the cell`.');
    expect(runs.filter((r) => r.kind === 'bold').map((r) => r.text)).toEqual(['mitochondrion']);
    expect(runs.filter((r) => r.kind === 'italic').map((r) => r.text)).toEqual(['powerhouse']);
    expect(runs.filter((r) => r.kind === 'code').map((r) => r.text)).toEqual(['the cell']);
    expect(runs.map((r) => r.text).join('')).not.toMatch(/[*`]/);
  });

  it('scrubs an unclosed marker instead of printing it', () => {
    expect(visible(noteBlocks('An **unclosed term and a stray ` tick'))).not.toMatch(/[*`]/);
  });

  it('flattens a link to its label', () => {
    expect(visible(noteBlocks('See [the syllabus](https://example.edu/s) for dates.'))).toBe(
      'See the syllabus for dates.'
    );
  });

  it('strips the Smart Notes sentinels but keeps the generated notes', () => {
    const body = `Typed notes.\n\n${SMART_NOTES_START}\n## Smart Notes\n- A point\n${SMART_NOTES_END}\n`;
    const stripped = stripNoteMarkers(body);
    expect(stripped).not.toContain('lantern:smart-notes');
    expect(stripped).not.toContain('<!--');
    const blocks = noteBlocks(body);
    expect(kinds(blocks)).toEqual(['paragraph', 'gap', 'heading', 'bullet']);
    expect(visible(blocks)).toContain('A point');
  });

  it('strips the lesson snapshot fence and any other HTML comment', () => {
    const body =
      'Lesson — Mastery · Genetics\n\n```lantern-lesson\n{"pages":[{"t":"x"}]}\n```\n\n<!-- lantern:anything -->\nReal prose.';
    const blocks = noteBlocks(body);
    const text = visible(blocks);
    expect(text).not.toContain('lantern-lesson');
    expect(text).not.toContain('pages');
    expect(text).not.toContain('<!--');
    expect(text).toContain('Real prose.');
    expect(kinds(blocks)).not.toContain('code');
  });

  it('renders a body with no markdown at all as plain paragraphs', () => {
    const blocks = noteBlocks('Lecture was about supply curves.\nBring the reader on Thursday.');
    expect(kinds(blocks)).toEqual(['paragraph', 'paragraph']);
    expect(visible(blocks)).toBe('Lecture was about supply curves.\nBring the reader on Thursday.');
  });

  it('reads a transcript gutter line as a timestamp', () => {
    const blocks = noteBlocks('[00:36] Professor starts on entropy\n01:12\n12:04:09 Wrap up');
    expect(kinds(blocks)).toEqual(['timestamp', 'timestamp', 'timestamp']);
    const stamps = blocks.map((b) => (b.kind === 'timestamp' ? b.time : ''));
    expect(stamps).toEqual(['00:36', '01:12', '12:04:09']);
    expect(visible(blocks)).not.toContain('[');
  });

  it('turns a horizontal rule and a blank line into a single gap', () => {
    const blocks = noteBlocks('A\n\n---\n\nB');
    expect(kinds(blocks)).toEqual(['paragraph', 'gap', 'paragraph']);
  });

  it('keeps a fenced snippet as code with its language', () => {
    const blocks = noteBlocks('```sql\nselect 1;\n```');
    expect(blocks).toEqual([{ kind: 'code', text: 'select 1;', language: 'sql' }]);
  });

  it('parses a pipe table and marks the header row', () => {
    const blocks = noteBlocks('| Term | Meaning |\n| --- | --- |\n| ATP | Energy |');
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (table.kind !== 'table') throw new Error('expected a table');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].isHeader).toBe(true);
    expect(visible(blocks)).not.toContain('|');
  });

  it('reads a blockquote without the angle bracket', () => {
    const blocks = noteBlocks('> Exam covers weeks 1-6.');
    expect(kinds(blocks)).toEqual(['quote']);
    expect(visible(blocks)).toBe('Exam covers weeks 1-6.');
  });

  it('never opens or closes on empty space', () => {
    const blocks = noteBlocks('\n\n\nMiddle\n\n\n');
    expect(kinds(blocks)).toEqual(['paragraph']);
  });

  it('handles an empty or missing body', () => {
    expect(noteBlocks('')).toEqual([]);
    expect(noteBlocks(null)).toEqual([]);
    expect(noteBlocks(undefined)).toEqual([]);
    expect(stripNoteMarkers(null)).toBe('');
  });

  it('caps a runaway indent', () => {
    expect(noteDepthFromIndent(' '.repeat(40))).toBe(3);
    expect(noteDepthFromIndent('')).toBe(0);
  });
});

describe('notePlainPreview', () => {
  it('reads as a sentence, not as markdown', () => {
    expect(
      notePlainPreview('## Overview\n- **Pancreatitis** is inflammation\n> Exam covers weeks 1-6.')
    ).toBe('Overview Pancreatitis is inflammation Exam covers weeks 1-6.');
  });

  it('drops the machine markers and the legacy HTML', () => {
    expect(notePlainPreview(`${SMART_NOTES_START}\n# Title\n${SMART_NOTES_END}`)).toBe('Title');
    expect(notePlainPreview('<p>Intake and triage</p>')).toBe('Intake and triage');
  });

  it('keeps link labels and flattens tables', () => {
    expect(notePlainPreview('See [the guide](https://x.test) first')).toBe('See the guide first');
    expect(notePlainPreview('| Drug | Dose |\n| --- | --- |\n| Aspirin | 300 mg |')).toBe(
      'Drug Dose Aspirin 300 mg'
    );
  });

  it('truncates with an ellipsis and handles an empty body', () => {
    expect(notePlainPreview('a'.repeat(200), 10)).toBe(`${'a'.repeat(10)}\u2026`);
    expect(notePlainPreview('')).toBe('');
    expect(notePlainPreview(null)).toBe('');
  });

  it('never leaks a lesson snapshot — not the JSON, not the check answers', () => {
    const body =
      'Pancreatitis PPT Student \u00b7 Mastery\n\n```lantern-lesson\n' +
      JSON.stringify({
        mode: 'mastery',
        sourceTitle: 'Pancreatitis PPT Student',
        plan: { topics: [] },
        pages: [
          { title: 'Causes', body: 'Gallstones', check: { answer: 'Gallstones' } },
          { title: 'Signs', body: 'Epigastric pain', check: { answer: 'Cullen sign' } },
        ],
      }) +
      '\n```\n';
    const preview = notePlainPreview(body);
    expect(preview).toBe('Mastery plan \u00b7 2 steps');
    expect(preview).not.toContain('{');
    expect(preview).not.toContain('Cullen');
    expect(preview).not.toContain('check');
  });
});

describe('noteTypedPreview', () => {
  const lesson = (mode: string, pages: number) =>
    '```lantern-lesson\n' +
    JSON.stringify({ mode, pages: Array.from({ length: pages }, () => ({ title: 't' })) }) +
    '\n```';

  it('names the plan and counts its steps, singular included', () => {
    expect(noteTypedPreview(lesson('mastery', 7))).toBe('Mastery plan \u00b7 7 steps');
    expect(noteTypedPreview(lesson('explore', 1))).toBe('Explore plan \u00b7 1 step');
  });

  it('calls a bare JSON body a structured note', () => {
    expect(noteTypedPreview('{"secret":"answer"}')).toBe('Structured note');
    expect(noteTypedPreview('  [1, 2, 3]  ')).toBe('Structured note');
    expect(noteTypedPreview('```lantern-lesson\n{not json\n```')).toBe('Structured note');
  });

  it('leaves prose alone, including prose that merely starts with a brace', () => {
    expect(noteTypedPreview('## Overview\nPancreatitis')).toBeNull();
    expect(noteTypedPreview('{this is not json} and the rest of the note')).toBeNull();
    expect(noteTypedPreview('')).toBeNull();
    expect(noteTypedPreview(null)).toBeNull();
  });
});
