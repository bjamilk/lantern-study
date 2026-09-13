import {
  attachmentSizeBytes,
  cachedPdfFileName,
  contentLengthBytes,
  describePdfOpenFailure,
  formatFileSize,
  isThirdPartyViewerUrl,
  planPdfPreview,
} from './notePdfPreview';

const SIGNED =
  'https://storage.lantern.test/notes/abc.pdf?token=eyJhbGciOi&expires=1757600000';

describe('planPdfPreview', () => {
  it('never routes a signed URL through a remote viewer', () => {
    // The Round 2c defect: Google's gview fetches the URL from Google's own
    // servers, which cannot read our private link, and then prints its own
    // "You may be offline" page on a device that is online.
    for (const platform of ['android', 'ios', 'web']) {
      const plan = planPdfPreview(SIGNED, platform);
      const url = plan.kind === 'webview' ? plan.uri : plan.url;
      expect(isThirdPartyViewerUrl(url)).toBe(false);
      expect(url).toBe(SIGNED);
    }
  });

  it('hands Android the file to open, because its WebView has no PDF renderer', () => {
    expect(planPdfPreview(SIGNED, 'android')).toEqual({ kind: 'external', url: SIGNED });
  });

  it('keeps the WebView on iOS, where WKWebView renders PDFs natively', () => {
    expect(planPdfPreview(SIGNED, 'ios')).toEqual({ kind: 'webview', uri: SIGNED });
  });

  it('flags the old viewer URL shape so it cannot come back unnoticed', () => {
    expect(
      isThirdPartyViewerUrl(
        `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(SIGNED)}`
      )
    ).toBe(true);
  });
});

describe('formatFileSize / attachmentSizeBytes', () => {
  it('reads whichever key the row recorded the byte count under', () => {
    expect(attachmentSizeBytes({ size: 2048 })).toBe(2048);
    expect(attachmentSizeBytes({ fileSize: '4096' })).toBe(4096);
    expect(attachmentSizeBytes({ contentLength: 10 })).toBe(10);
    expect(attachmentSizeBytes({ size: 0 })).toBeUndefined();
    expect(attachmentSizeBytes(undefined)).toBeUndefined();
  });

  it('formats sizes, and answers null rather than "0 B" when none was recorded', () => {
    expect(formatFileSize(900)).toBe('900 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(1024 * 1024 * 3.25)).toBe('3.3 MB');
    expect(formatFileSize(undefined)).toBeNull();
    expect(formatFileSize(0)).toBeNull();
  });
});

describe('describePdfOpenFailure', () => {
  it('keeps the failing hop\'s own sentence and status', () => {
    expect(describePdfOpenFailure({ status: 403, message: 'Access denied' })).toBe(
      'Access denied (403)'
    );
  });

  it('never guesses at connectivity when there is no message', () => {
    expect(describePdfOpenFailure({ status: 404 })).toBe('This PDF could not be opened (404).');
    expect(describePdfOpenFailure({})).toBe('This PDF could not be opened on this device.');
    expect(describePdfOpenFailure({ message: 'x' })).not.toMatch(/offline/i);
  });
});

describe('cachedPdfFileName', () => {
  it('keeps a readable name and always ends in .pdf', () => {
    expect(cachedPdfFileName('N448 Gas Exchange.pdf', 'abc12345-0000')).toBe(
      'N448_Gas_Exchange.pdf'
    );
    expect(cachedPdfFileName('../../etc/passwd', 'abc12345-0000')).toBe('etc_passwd.pdf');
    expect(cachedPdfFileName(undefined, 'abc12345-0000')).toBe('document-abc12345.pdf');
  });
});


describe('contentLengthBytes', () => {
  it('reads the header off a fetch Headers and off a plain object', () => {
    // Round 2d: the card showed a bare "PDF" because the row carried no byte
    // count, so the signed URL's own Content-Length has to be able to answer.
    expect(contentLengthBytes({ get: (n: string) => (n === 'content-length' ? '2048' : null) })).toBe(
      2048
    );
    expect(contentLengthBytes({ 'Content-Length': '4096' })).toBe(4096);
    expect(contentLengthBytes({ 'content-length': 10 })).toBe(10);
  });

  it('answers undefined rather than a made-up size', () => {
    expect(contentLengthBytes(null)).toBeUndefined();
    expect(contentLengthBytes({})).toBeUndefined();
    expect(contentLengthBytes({ 'content-length': '0' })).toBeUndefined();
    expect(contentLengthBytes({ 'content-length': 'chunked' })).toBeUndefined();
  });

  it('feeds the same formatter the card uses, so a probe reads "1.2 MB"', () => {
    expect(formatFileSize(contentLengthBytes({ 'content-length': '1258291' }))).toBe('1.2 MB');
  });
});
