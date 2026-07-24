import {
  generateNoteShareLink,
  generateNoteShareAppLink,
  parseDeepLink,
  WEB_BASE_URL,
} from './index';

describe('note share deep links', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz0123456789_-';

  it('generates canonical web and app links', () => {
    expect(generateNoteShareLink(token)).toBe(`${WEB_BASE_URL}/notes/share/${encodeURIComponent(token)}`);
    expect(generateNoteShareAppLink(token)).toBe(`lanternstudy://notes/share/${encodeURIComponent(token)}`);
  });

  it('parses web share URLs', () => {
    expect(parseDeepLink(generateNoteShareLink(token))).toEqual({
      type: 'note_share',
      id: token,
    });
  });

  it('parses relative and app-scheme share paths', () => {
    expect(parseDeepLink(`/notes/share/${token}`)).toEqual({
      type: 'note_share',
      id: token,
    });
    expect(parseDeepLink(`lanternstudy://notes/share/${token}`)).toEqual({
      type: 'note_share',
      id: token,
    });
  });
});
