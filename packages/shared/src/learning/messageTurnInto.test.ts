import {
  MESSAGE_GENERATE_TARGETS,
  MESSAGE_NOTE_FALLBACK_TITLE,
  MESSAGE_TURN_INTO_KIND,
  MESSAGE_TURN_INTO_TARGETS,
  messageToNoteDraft,
  messageTurnIntoActionLabel,
  messageTurnIntoKind,
} from './messageTurnInto';
import { TURN_INTO_TARGETS } from './courseWorkspace';

const NOW = new Date('2026-09-12T10:30:00.000Z');

describe('message turn-into targets', () => {
  it('offers every Turn-into target, so the menu matches the note menu', () => {
    expect(MESSAGE_TURN_INTO_TARGETS).toBe(TURN_INTO_TARGETS);
    expect(Object.keys(MESSAGE_TURN_INTO_KIND).sort()).toEqual(
      TURN_INTO_TARGETS.map((t) => t.id).sort()
    );
  });

  it('treats cards, quiz and test as generated straight from the text', () => {
    expect([...MESSAGE_GENERATE_TARGETS]).toEqual(['cards', 'quiz', 'test']);
    expect(messageTurnIntoKind('cards')).toBe('generate');
    expect(messageTurnIntoKind('quiz')).toBe('generate');
    expect(messageTurnIntoKind('test')).toBe('generate');
    for (const id of ['notes', 'lesson', 'recap', 'essay', 'play'] as const) {
      expect(messageTurnIntoKind(id)).toBe('studio');
    }
  });

  it('says the two steps out loud for studio targets only', () => {
    expect(messageTurnIntoActionLabel('cards')).toBe('Flashcards');
    expect(messageTurnIntoActionLabel('test')).toBe('Practice test');
    expect(messageTurnIntoActionLabel('lesson')).toBe('Save as note, then open Lesson');
    expect(messageTurnIntoActionLabel('play')).toBe('Save as note, then open Play');
  });
});

describe('messageToNoteDraft', () => {
  it('takes the title from a markdown heading and keeps the body verbatim', () => {
    const draft = messageToNoteDraft(
      { content: '## **Photosynthesis**\n\nLight reactions happen in the thylakoid.' },
      'Biology chat',
      NOW
    );
    expect(draft.title).toBe('Photosynthesis');
    expect(draft.body).toBe(
      '## **Photosynthesis**\n\nLight reactions happen in the thylakoid.\n\nFrom Lantern AI · 12 September 2026'
    );
    expect(draft.sourceType).toBe('typed');
  });

  it('falls back to the conversation title when the answer opens with prose', () => {
    const long = 'a'.repeat(200);
    const draft = messageToNoteDraft({ content: `${long}\n\nmore` }, 'Krebs cycle', NOW);
    expect(draft.title).toBe('Krebs cycle');
  });

  it('truncates a long opener on a word boundary when there is no conversation title', () => {
    const opener = 'The mitochondrion is the organelle that produces most of the cell chemical energy supply today';
    const draft = messageToNoteDraft({ content: opener }, null, NOW);
    expect(draft.title.endsWith('…')).toBe(true);
    expect(draft.title.length).toBeLessThanOrEqual(81);
    expect(draft.title.startsWith('The mitochondrion is')).toBe(true);
  });

  it('uses a plain fallback when there is nothing to name it after', () => {
    const draft = messageToNoteDraft({ content: '   ' }, '', NOW);
    expect(draft.title).toBe(MESSAGE_NOTE_FALLBACK_TITLE);
    expect(draft.body).toBe('From Lantern AI · 12 September 2026');
  });

  it('dates the caption from the message, not from the save', () => {
    const draft = messageToNoteDraft(
      { content: 'Answer', createdAt: '2026-01-03T23:00:00.000Z' },
      'Chat',
      NOW
    );
    expect(draft.body).toContain('From Lantern AI · 3 January 2026');
  });

  it('normalises CRLF and strips list furniture from the title', () => {
    const draft = messageToNoteDraft({ content: '1. Ohm\r\n\r\nV = IR' }, null, NOW);
    expect(draft.title).toBe('Ohm');
    expect(draft.body).toBe('1. Ohm\n\nV = IR\n\nFrom Lantern AI · 12 September 2026');
  });
});
