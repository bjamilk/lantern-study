import {
  RECAP_SEGMENT_CAPS,
  applyRecapCommand,
  composeRecapNoteBody,
  currentRecapSegment,
  isRecapGeneratorMissing,
  isRecapNote,
  newRecapNoteTitle,
  normalizeGeneratedRecap,
  parseRecapNoteBody,
  recapFromMaterial,
  recapSourceNotes,
  recapSpokenIsCondensed,
  recapStudioPriceLine,
  resolveRecapStudioNote,
  startRecapSession,
} from './recapStudio';

const longSource = 'Pulmonary embolism is a blockage in a pulmonary artery. '.repeat(40);

function sampleSession() {
  return startRecapSession({
    style: 'podcast',
    length: 'short',
    sourceNoteId: 'n1',
    sourceTitle: 'Pulmonary Embolism',
    segments: [
      { title: 'Clot', spoken: 'A clot that travels to the lung.', sourceCite: 'A clot that travels.' },
      { title: 'Signs', spoken: 'Sudden shortness of breath is the cue.', sourceCite: 'Sudden dyspnea.' },
    ],
  });
}

describe('recap studio', () => {
  it('caps segments by S / M / L and never dumps the source into spoken text', () => {
    const notes = `# One\n\n${longSource}\n\n# Two\n\n${longSource}\n\n# Three\n\n${longSource}`;
    const short = recapFromMaterial({
      style: 'summary',
      length: 'short',
      sourceNoteId: 'n1',
      sourceTitle: 'PE',
      notes: `${notes}\n\n# Four\n\n${longSource}\n\n# Five\n\n${longSource}\n\n# Six\n\n${longSource}\n\n# Seven\n\n${longSource}`,
    });
    expect(short.segments.length).toBeLessThanOrEqual(RECAP_SEGMENT_CAPS.short);
    for (const beat of short.segments) {
      expect(recapSpokenIsCondensed(beat.spoken, longSource)).toBe(true);
      expect(beat.spoken).not.toBe(longSource.trim());
      expect(beat.sourceCite.length).toBeGreaterThan(0);
      expect(beat.sourceCite.length).toBeLessThanOrEqual(140);
    }

    const dumped = recapFromMaterial({
      style: 'lecture',
      length: 'medium',
      sourceNoteId: 'n1',
      sourceTitle: 'PE',
      notes: longSource,
    });
    const spoken = dumped.segments.map((beat) => beat.spoken).join('\n');
    expect(spoken.length).toBeLessThan(longSource.length / 2);
    expect(spoken.includes(longSource.trim())).toBe(false);
  });

  it('round-trips a session through the note body and names the door note', () => {
    const opened = applyRecapCommand(sampleSession(), { type: 'next' });
    const body = composeRecapNoteBody(opened);
    expect(isRecapNote({ title: newRecapNoteTitle('podcast', 'Pulmonary Embolism'), body })).toBe(
      true
    );
    const parsed = parseRecapNoteBody(body);
    expect(parsed?.segmentIndex).toBe(1);
    expect(parsed?.style).toBe('podcast');
    expect(currentRecapSegment(parsed!)?.title).toBe('Signs');
    expect(newRecapNoteTitle('summary', 'PE')).toBe('Recap — Summary · PE');
    expect(recapStudioPriceLine()).toMatch(/1 AI use/);
  });

  it('skips ahead and slower, and leaves unknown lines as chat', () => {
    const next = applyRecapCommand(sampleSession(), { type: 'next' });
    expect(next.segmentIndex).toBe(1);
    const back = applyRecapCommand(next, { type: 'prev' });
    expect(back.segmentIndex).toBe(0);
    const slow = applyRecapCommand(sampleSession(), { type: 'slower' });
    expect(slow.speechRate).toBeLessThan(1);
  });

  it('normalises a generated payload and resumes the selected recap note', () => {
    const session = normalizeGeneratedRecap(
      {
        segments: [
          { title: 'Intro', spoken: 'A clot in the lung.', sourceCite: 'blockage in a pulmonary artery' },
        ],
      },
      { style: 'lecture', length: 'short', sourceNoteId: 'n1', sourceTitle: 'PE' }
    );
    expect(session.segments).toHaveLength(1);
    expect(session.segments[0]?.spoken.toLowerCase()).toContain('takeaway');
    expect(resolveRecapStudioNote({ recaps: [{ id: 'a' }, { id: 'b' }], selectedNoteId: 'b' })).toEqual(
      { action: 'resume', noteId: 'b' }
    );
    expect(resolveRecapStudioNote({ recaps: [] })).toEqual({ action: 'start' });
  });

  it('treats API 404 payloads as a missing recap generator, not a 503', () => {
    expect(isRecapGeneratorMissing({ status: 404, message: 'Error' })).toBe(true);
    expect(
      isRecapGeneratorMissing({
        message: 'Error',
        body: { error: 'Error', message: 'Not found - /api/v1/ai/generate-recap' },
      })
    ).toBe(true);
    expect(isRecapGeneratorMissing({ status: 503, message: 'Failed to generate a recap.' })).toBe(
      false
    );
  });

  it('puts ordinary notes ahead of lectures and skips recap and lesson notes as sources', () => {
    const body = 'Pharmacokinetics is how the body handles a drug over time.'.repeat(2);
    const notes = [
      { id: 'l', title: 'Lecture — 11 Sep', body, sourceType: 'audio' as const },
      { id: 'n', title: 'Pulmonary Embolism', body },
      { id: 'r', title: 'Recap — Podcast · PE', body: '```lantern-recap\n{}\n```' },
      { id: 's', title: 'Lesson — Explore · PE', body: '```lantern-lesson\n{}\n```' },
      { id: 'e', title: 'Essay — Draft', body: '```lantern-essay\n{}\n```' },
    ];
    expect(recapSourceNotes(notes).map((note) => note.id)).toEqual(['n', 'l']);
  });
});
