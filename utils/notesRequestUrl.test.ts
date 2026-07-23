import { describe, expect, it } from 'vitest';
import { resolveNotesRequestUrl } from './notesRequestUrl';

describe('resolveNotesRequestUrl', () => {
  it('bypasses Cloudflare for a small storage-path transcription request', () => {
    const url = resolveNotesRequestUrl({
      apiBaseUrl: '',
      path: '/transcribe-audio',
      bodyJson: JSON.stringify({ storagePath: 'user/lecture.webm' }),
      isBrowser: true,
    });

    expect(url).toBe(
      'https://lantern-study-api.onrender.com/api/v1/notes/transcribe-audio'
    );
  });

  it('keeps ordinary small note requests on the same-origin proxy', () => {
    const url = resolveNotesRequestUrl({
      apiBaseUrl: '',
      path: '/prepare-lecture-audio-upload',
      bodyJson: JSON.stringify({ byteLength: 500_000 }),
      isBrowser: true,
    });

    expect(url).toBe('/api/v1/notes/prepare-lecture-audio-upload');
  });

  it('keeps an explicitly configured API origin', () => {
    const url = resolveNotesRequestUrl({
      apiBaseUrl: 'http://localhost:3001',
      path: '/transcribe-audio',
      bodyJson: '{}',
      isBrowser: true,
    });

    expect(url).toBe('http://localhost:3001/api/v1/notes/transcribe-audio');
  });
});
