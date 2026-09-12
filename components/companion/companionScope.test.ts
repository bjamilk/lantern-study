import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_SIMPLY_PROMPT,
  QUICK_PROMPTS,
  QUICK_PROMPT_CHIPS,
  composerKeyIntent,
  deriveChatTitle,
  filterConversations,
  previousUserMessage,
  visibleQuickPrompts,
} from './companionScope';

const conversations = [
  { id: 'a', title: 'Krebs cycle', noteTitle: 'Biology 101', preview: 'Explain the steps' },
  { id: 'b', title: 'Essay plan', noteTitle: null, preview: 'Outline for the history essay' },
  { id: 'c', title: 'Budget', noteTitle: null, preview: null },
];

describe('past chats search', () => {
  it('filters by title', () => {
    expect(filterConversations(conversations, 'krebs').map((c) => c.id)).toEqual(['a']);
  });

  it('also matches the attached note and the preview', () => {
    expect(filterConversations(conversations, 'biology').map((c) => c.id)).toEqual(['a']);
    expect(filterConversations(conversations, 'history').map((c) => c.id)).toEqual(['b']);
  });

  it('returns everything for an empty query, and nothing for a miss', () => {
    expect(filterConversations(conversations, '   ')).toHaveLength(3);
    expect(filterConversations(conversations, 'photosynthesis')).toHaveLength(0);
  });
});

describe('composer keys', () => {
  it('sends on Enter', () => {
    expect(composerKeyIntent({ key: 'Enter' })).toBe('send');
  });

  it('opens a line on Shift+Enter rather than sending', () => {
    expect(composerKeyIntent({ key: 'Enter', shiftKey: true })).toBe('newline');
  });

  it('never sends the Enter that commits an IME composition', () => {
    // The bug this guards: typing a CJK or accented word commits with Enter,
    // and treating that as "send" fires a half-typed question.
    expect(composerKeyIntent({ key: 'Enter', isComposing: true })).toBe('ignore');
    expect(composerKeyIntent({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe('ignore');
  });

  it('leaves every other key to the textarea', () => {
    expect(composerKeyIntent({ key: 'a' })).toBe('ignore');
    expect(composerKeyIntent({ key: 'Escape' })).toBe('ignore');
  });
});

describe('regenerate target', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'What is the Krebs cycle?' },
    { id: 'a1', role: 'assistant', content: 'It is…' },
    { id: 'u2', role: 'user', content: 'And glycolysis?' },
    { id: 'a2', role: 'assistant', content: 'That is…' },
  ];

  it('re-asks the question above THAT answer, not the newest one', () => {
    expect(previousUserMessage(messages, 'a1')).toBe('What is the Krebs cycle?');
    expect(previousUserMessage(messages, 'a2')).toBe('And glycolysis?');
  });

  it('has nothing to re-ask when the answer opens the thread', () => {
    expect(previousUserMessage(messages, 'missing')).toBeNull();
    expect(previousUserMessage([{ id: 'a0', role: 'assistant', content: 'Hi' }], 'a0')).toBeNull();
  });
});

describe('chat title', () => {
  it('names the thread after the first question', () => {
    expect(
      deriveChatTitle([
        { id: 'u1', role: 'user', content: '  Explain osmosis  ' },
        { id: 'u2', role: 'user', content: 'And diffusion?' },
      ])
    ).toBe('Explain osmosis');
  });

  it('collapses newlines and cuts long questions on a word boundary', () => {
    const title = deriveChatTitle([
      {
        id: 'u1',
        role: 'user',
        content: 'Explain the entire\nprocess of cellular respiration including every stage',
      },
    ]);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('\n');
    expect(title.length).toBeLessThanOrEqual(43);
    // Cut at a space: a title must not end mid-word.
    expect(title.slice(0, -1).endsWith(' ')).toBe(false);
    expect('Explain the entire process of cellular respiration including every stage').toContain(
      title.slice(0, -1)
    );
  });

  it('falls back before anything has been asked', () => {
    expect(deriveChatTitle([])).toBe('New chat');
    expect(deriveChatTitle([{ id: 'a1', role: 'assistant', content: 'Hi!' }])).toBe('New chat');
  });
});

describe('prompt chips', () => {
  it('collapses to four until View more', () => {
    expect(visibleQuickPrompts(false)).toHaveLength(4);
    expect(visibleQuickPrompts(true)).toEqual([...QUICK_PROMPTS]);
  });

  it('gives every prompt a glyph, so the row is scannable by shape', () => {
    expect(QUICK_PROMPT_CHIPS).toHaveLength(QUICK_PROMPTS.length);
    expect(QUICK_PROMPT_CHIPS.map((c) => c.prompt)).toEqual([...QUICK_PROMPTS]);
    for (const chip of QUICK_PROMPT_CHIPS) expect(chip.icon).toBeTruthy();
  });

  it('re-asks with one fixed sentence, so the thread does the narrowing', () => {
    expect(EXPLAIN_SIMPLY_PROMPT).toBe('Explain that more simply.');
  });
});
