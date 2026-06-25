import {
  assertPresentationFileName,
  assertValidOfficeZip,
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

  it('rejects truncated zip uploads', () => {
    const truncated = Buffer.alloc(100, 0);
    truncated.writeUInt32LE(0x04034b50, 0);
    expect(() => assertValidOfficeZip(truncated, 'deck.pptx')).toThrow(/truncated/i);
  });

  it('skips zip validation for legacy .ppt files', () => {
    const notZip = Buffer.from('not a zip');
    expect(() => assertValidOfficeZip(notZip, 'deck.ppt')).not.toThrow();
  });
});
