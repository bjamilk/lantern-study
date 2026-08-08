import { AI_QUERY_PATTERN, formatAiTutorReply, parseAiQuery } from './aiChatQuery';

describe('parseAiQuery', () => {
  it('matches the @AI trigger', () => {
    expect(parseAiQuery('@AI what is the Krebs cycle?')).toBe('what is the Krebs cycle?');
  });

  it('matches the /ask trigger', () => {
    expect(parseAiQuery('/ask what is the Krebs cycle?')).toBe('what is the Krebs cycle?');
  });

  it('is case-insensitive on the trigger', () => {
    expect(parseAiQuery('@ai explain osmosis')).toBe('explain osmosis');
  });

  it('spans newlines in the question', () => {
    expect(parseAiQuery('@AI first line\nsecond line')).toBe('first line\nsecond line');
  });

  it('returns null for an ordinary message', () => {
    expect(parseAiQuery('what is the Krebs cycle?')).toBeNull();
    expect(parseAiQuery('ask @AI about this later')).toBeNull();
  });

  it('returns null when the trigger has no question after it', () => {
    // The regex requires at least one character, but that character can be
    // whitespace — sending that to the tutor burns a request for nothing.
    expect(parseAiQuery('@AI   ')).toBeNull();
    expect(parseAiQuery('@AI')).toBeNull();
  });

  it('exposes the raw pattern for callers that need the match object', () => {
    expect('@AI hello'.match(AI_QUERY_PATTERN)?.[1]).toBe('hello');
  });
});

describe('formatAiTutorReply', () => {
  it('prefixes the answer so chat renders it as a tutor message', () => {
    expect(formatAiTutorReply('42')).toBe('🤖 AI Tutor:\n42');
  });
});
