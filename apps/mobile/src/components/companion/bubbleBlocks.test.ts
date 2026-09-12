import { bubbleBlocks, inlineRuns, depthFromIndent, type BubbleBlock } from './bubbleBlocks';

const plain = (b: BubbleBlock): string =>
  'runs' in b ? b.runs.map((r) => r.text).join('') : b.kind === 'code' ? b.text : '';

describe('bubbleBlocks', () => {
  it('parses headings and keeps the level', () => {
    const blocks = bubbleBlocks('# One\n## Two\n### Three');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'heading', 'heading']);
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : 0))).toEqual([1, 2, 3]);
    expect(blocks.map(plain)).toEqual(['One', 'Two', 'Three']);
  });

  it('parses the three bullet markers at depth 0', () => {
    const blocks = bubbleBlocks('- a\n* b\n• c');
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b.kind).toBe('bullet');
      if (b.kind === 'bullet') {
        expect(b.marker).toBe('•');
        expect(b.depth).toBe(0);
      }
    }
    expect(blocks.map(plain)).toEqual(['a', 'b', 'c']);
  });

  it('nests by leading spaces — 2 or 4 are both one level in', () => {
    expect(depthFromIndent('')).toBe(0);
    expect(depthFromIndent('  ')).toBe(1);
    expect(depthFromIndent('    ')).toBe(1);
    expect(depthFromIndent('      ')).toBe(2);
    expect(depthFromIndent('\t')).toBe(1);
    const blocks = bubbleBlocks('- top\n  - nested\n    - also nested\n      - deeper');
    expect(blocks.map((b) => (b.kind === 'bullet' ? b.depth : -1))).toEqual([0, 1, 1, 2]);
  });

  it('keeps numbering for ordered items', () => {
    const blocks = bubbleBlocks('1. first\n2. second\n  3. nested');
    expect(blocks.map((b) => (b.kind === 'bullet' ? b.marker : ''))).toEqual(['1.', '2.', '3.']);
    expect(blocks.map((b) => (b.kind === 'bullet' ? b.depth : -1))).toEqual([0, 0, 1]);
  });

  it('turns blank lines into a single gap and drops leading/trailing ones', () => {
    const blocks = bubbleBlocks('\n\nalpha\n\n\nbeta\n\n');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'gap', 'paragraph']);
  });

  it('turns a horizontal rule into a gap, not a bullet', () => {
    const blocks = bubbleBlocks('alpha\n---\nbeta');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'gap', 'paragraph']);
  });

  it('parses a simple table and drops the header separator row', () => {
    const blocks = bubbleBlocks('| Topic | Due |\n|---|---|\n| Kinetics | Fri |');
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table.kind).toBe('table');
    if (table.kind !== 'table') return;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[1].isHeader).toBe(false);
    expect(table.rows.map((r) => r.cells.map((c) => c.map((x) => x.text).join('')))).toEqual([
      ['Topic', 'Due'],
      ['Kinetics', 'Fri'],
    ]);
  });

  it('parses fenced code, including an unterminated fence', () => {
    const closed = bubbleBlocks('before\n```ts\nconst a = 1;\n```\nafter');
    expect(closed.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
    const code = closed[1];
    if (code.kind === 'code') {
      expect(code.text).toBe('const a = 1;');
      expect(code.language).toBe('ts');
    }
    const open = bubbleBlocks('```\nstill code');
    expect(open.map((b) => b.kind)).toEqual(['code']);
    expect(plain(open[0])).toBe('still code');
  });

  it('splits inline bold, italic, code and excerpt runs', () => {
    const runs = inlineRuns('Study **hard**, stay _calm_, run `npm test` (Excerpt 2)');
    expect(runs.map((r) => r.kind)).toEqual([
      'text',
      'bold',
      'text',
      'italic',
      'text',
      'code',
      'text',
      'excerpt',
    ]);
    expect(runs.find((r) => r.kind === 'bold')?.text).toBe('hard');
    expect(runs.find((r) => r.kind === 'italic')?.text).toBe('calm');
    expect(runs.find((r) => r.kind === 'code')?.text).toBe('npm test');
    const excerpt = runs.find((r) => r.kind === 'excerpt');
    expect(excerpt?.text).toBe('(Excerpt 2)');
    expect(excerpt && 'index' in excerpt ? excerpt.index : null).toBe(2);
  });

  it('lets no raw marker reach the screen', () => {
    const source = '## Plan\n- **unclosed bold\n- a `stray backtick\n| x | y |\n\n```\ncode\n```';
    const visible = bubbleBlocks(source)
      .map(plain)
      .join('\n');
    expect(visible).not.toMatch(/\*\*/);
    expect(visible).not.toMatch(/`/);
    expect(visible).not.toMatch(/\|/);
    expect(visible).not.toMatch(/^#/m);
  });

  it('degrades anything unknown to a paragraph', () => {
    const blocks = bubbleBlocks('> quoted line\n<div>markup</div>');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
  });

  it('parses a real three-bullet answer', () => {
    const answer = [
      "Here's what to study today:",
      '',
      '- **Kinetics** — 12 cards are due, and it is your weakest topic.',
      '- **Thermo** — review the *rate law* summary before your Friday test.',
      '- Take a 10-minute break between decks (Excerpt 1).',
      '',
      'Want me to build a quiz?',
    ].join('\n');
    const blocks = bubbleBlocks(answer);
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'gap',
      'bullet',
      'bullet',
      'bullet',
      'gap',
      'paragraph',
    ]);
    const bullets = blocks.filter((b) => b.kind === 'bullet');
    expect(bullets).toHaveLength(3);
    expect(plain(bullets[0])).toContain('Kinetics');
    expect(plain(bullets[0])).not.toContain('*');
    expect(bullets[2].kind === 'bullet' && bullets[2].runs.some((r) => r.kind === 'excerpt')).toBe(
      true
    );
  });

  it('returns nothing for an empty body', () => {
    expect(bubbleBlocks('')).toEqual([]);
    // Whitespace-only lines are gaps, and a bubble of nothing but gaps is empty.
    expect(bubbleBlocks('\n \n')).toEqual([]);
  });
});
