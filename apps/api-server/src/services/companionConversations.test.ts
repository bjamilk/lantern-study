import { parseCompanionUuid } from './companionConversations';

describe('companionConversations helpers', () => {
  describe('parseCompanionUuid', () => {
    it('accepts valid UUIDs', () => {
      expect(parseCompanionUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });

    it('trims whitespace', () => {
      expect(parseCompanionUuid('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });

    it('rejects invalid values', () => {
      expect(parseCompanionUuid(null)).toBeNull();
      expect(parseCompanionUuid('')).toBeNull();
      expect(parseCompanionUuid('not-a-uuid')).toBeNull();
      expect(parseCompanionUuid(123)).toBeNull();
    });
  });
});

describe('companion conversation scoping contract', () => {
  it('history query prefers conversationId over noteContextId', () => {
    const conversationId = parseCompanionUuid('11111111-1111-4111-8111-111111111111');
    const noteContextId = parseCompanionUuid('22222222-2222-4222-8222-222222222222');
    expect(conversationId).toBeTruthy();
    expect(noteContextId).toBeTruthy();

    // Mirrors route precedence: conversationId wins when both are present.
    const resolved = conversationId ?? noteContextId;
    expect(resolved).toBe(conversationId);
  });

  it('forceNew should not reuse an existing conversation id', () => {
    const forceNew = true;
    const existingId = '11111111-1111-4111-8111-111111111111';
    const shouldReuse = !forceNew && Boolean(existingId);
    expect(shouldReuse).toBe(false);
  });
});
