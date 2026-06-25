import {
  assertPresentationFileName,
  presentationContentType,
} from './noteFiles';

describe('noteFiles presentation helpers', () => {
  it('accepts ppt and pptx extensions', () => {
    expect(() => assertPresentationFileName('lecture.pptx')).not.toThrow();
    expect(() => assertPresentationFileName('lecture.ppt')).not.toThrow();
  });

  it('rejects non-presentation extensions', () => {
    expect(() => assertPresentationFileName('lecture.pdf')).toThrow(/ppt or .pptx/);
  });

  it('maps mime types by extension', () => {
    expect(presentationContentType('deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(presentationContentType('deck.ppt')).toBe('application/vnd.ms-powerpoint');
  });
});
