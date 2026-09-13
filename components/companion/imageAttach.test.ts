import { describe, expect, it } from 'vitest';
import {
  IMAGE_ATTACH_COST_LABEL,
  IMAGE_ATTACH_CREDIT_COST,
  describeImageAttachment,
  stripDataUrlPrefix,
  validateImagePick,
} from './imageAttach';

describe('composer image rules', () => {
  it('prices a photo at the OCR cost, in the app-wide wording', () => {
    expect(IMAGE_ATTACH_CREDIT_COST).toBe(2);
    expect(IMAGE_ATTACH_COST_LABEL).toBe('Reading a photo costs 2 AI uses');
  });

  it('refuses locally what the server would refuse — before it charges', () => {
    expect(validateImagePick({ type: 'application/pdf', size: 100 })).toBe('Pick an image file.');
    expect(validateImagePick({ type: 'image/heic', size: 100 })).toContain('not supported');
    expect(validateImagePick({ type: 'image/png', size: 11 * 1024 * 1024 })).toContain('10 MB');
    expect(validateImagePick({ type: 'image/jpeg', size: 2_000_000 })).toBeNull();
  });

  it('says plainly when a photo gave the companion nothing to read', () => {
    expect(describeImageAttachment(0)).toBe('Image · no text found');
    expect(describeImageAttachment(1)).toBe('Image · 1 word');
    expect(describeImageAttachment(240)).toBe('Image · 240 words');
  });

  it('strips the data: prefix a FileReader adds', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,AAAB')).toBe('AAAB');
    expect(stripDataUrlPrefix('AAAB')).toBe('AAAB');
  });
});
