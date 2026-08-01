import {
  SMART_NOTES_END,
  SMART_NOTES_HEADING,
  SMART_NOTES_MAX_CHUNKS,
  SMART_NOTES_START,
  chunkTextForSmartNotes,
  extractSmartNotesSection,
  stripSmartNotesSection,
  upsertSmartNotesSection,
} from './smartNotes';

describe('smartNotes section helpers', () => {
  it('upserts a marked Smart Notes section without wiping user content', () => {
    const body = 'My lecture annotations\n\n- point A';
    const next = upsertSmartNotesSection(body, '## Core Idea\nPhotosynthesis converts light.');
    expect(next).toContain('My lecture annotations');
    expect(next).toContain(SMART_NOTES_START);
    expect(next).toContain(SMART_NOTES_HEADING);
    expect(next).toContain('Photosynthesis converts light.');
    expect(next).toContain(SMART_NOTES_END);
  });

  it('replaces a prior Smart Notes section on regenerate', () => {
    const first = upsertSmartNotesSection('User notes', 'Old thin summary');
    const second = upsertSmartNotesSection(first, '## Core Idea\nMuch richer notes.');
    expect(second).toContain('User notes');
    expect(second).toContain('Much richer notes.');
    expect(second).not.toContain('Old thin summary');
    expect(second.match(new RegExp(SMART_NOTES_START, 'g'))).toHaveLength(1);
  });

  it('strips marked and legacy Smart Notes sections', () => {
    const marked = upsertSmartNotesSection('Keep me', 'Generated');
    expect(stripSmartNotesSection(marked)).toBe('Keep me');

    const legacy = 'Intro\n\n## Smart Notes\n\nOld stuff\n';
    expect(stripSmartNotesSection(legacy)).toBe('Intro');
  });

  it('extracts section content', () => {
    const body = upsertSmartNotesSection('x', '### Topic\n- bullet');
    expect(extractSmartNotesSection(body)).toBe('### Topic\n- bullet');
  });
});

describe('chunkTextForSmartNotes', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkTextForSmartNotes('short lecture')).toEqual(['short lecture']);
  });

  it('splits long text on paragraph boundaries and caps chunks', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: ${'word '.repeat(80)}`).join(
      '\n\n'
    );
    const chunks = chunkTextForSmartNotes(paragraphs, {
      chunkSize: 500,
      maxChunks: 4,
      overlap: 40,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(4);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it('respects SMART_NOTES_MAX_CHUNKS default', () => {
    const huge = 'x'.repeat(SMART_NOTES_MAX_CHUNKS * 6000 + 20000);
    const chunks = chunkTextForSmartNotes(huge);
    expect(chunks.length).toBeLessThanOrEqual(SMART_NOTES_MAX_CHUNKS);
  });
});
