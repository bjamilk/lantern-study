import {
  IMAGE_ATTACH_COST_LABEL,
  IMAGE_ATTACH_CREDIT_COST,
  describeImageAttachment,
  validateImageAsset,
  describeImageAttachFailure,
  IMAGE_ATTACH_SERVER_UPDATE_MESSAGE,
} from './imageAttach';

describe('composer image rules (mobile)', () => {
  it('prices a photo at the OCR cost, in the app-wide wording', () => {
    expect(IMAGE_ATTACH_CREDIT_COST).toBe(2);
    expect(IMAGE_ATTACH_COST_LABEL).toBe('Reading a photo costs 2 AI uses');
  });

  it('refuses locally what the server would refuse — before it charges', () => {
    expect(validateImageAsset({ mimeType: 'application/pdf', fileSize: 10 })).toBe('Pick an image.');
    expect(validateImageAsset({ mimeType: 'image/png', fileSize: 11 * 1024 * 1024 })).toContain(
      '10 MB'
    );
    expect(validateImageAsset({ mimeType: 'image/jpeg', fileSize: 2_000_000 })).toBeNull();
    // The picker does not always report a type; a missing one is not a reason
    // to refuse a photo the student just took.
    expect(validateImageAsset({})).toBeNull();
  });

  it('says plainly when a photo gave the companion nothing to read', () => {
    expect(describeImageAttachment(0)).toBe('Image · no text found');
    expect(describeImageAttachment(1)).toBe('Image · 1 word');
    expect(describeImageAttachment(240)).toBe('Image · 240 words');
  });
});

describe('describeImageAttachFailure', () => {
  it('never surfaces the API error handler\'s generic label', () => {
    const failure = describeImageAttachFailure(Object.assign(new Error('Error'), { status: 500 }), 'page.png');
    expect(failure.message).not.toBe('Error');
    expect(failure.message).toContain('500');
    expect(failure.detail).toBe('File: page.png');
  });

  it('says what to do about a 503 that names the pending migration', () => {
    const failure = describeImageAttachFailure(
      Object.assign(
        new Error(
          'Image attachments are not enabled yet (apply 20260912100000_companion_image_attachments.sql).'
        ),
        { status: 503 }
      ),
      'testcard.png'
    );
    expect(failure.message).toBe(IMAGE_ATTACH_SERVER_UPDATE_MESSAGE);
    expect(failure.detail).toContain('File: testcard.png');
    expect(failure.detail).toContain('Waiting on 20260912100000_companion_image_attachments.sql');
  });

  it('keeps a sentence written for the student', () => {
    const failure = describeImageAttachFailure(
      Object.assign(new Error('That image is over 10 MB. Try a smaller photo.'), { status: 400 }),
      null
    );
    expect(failure.message).toBe('That image is over 10 MB. Try a smaller photo.');
    expect(failure.detail).toBeNull();
  });

  it('offers a reason when the request never reached a server at all', () => {
    const failure = describeImageAttachFailure(new Error(''), 'page.png');
    expect(failure.message).toContain('connection');
  });
});
