import { resolveAudioUploadMeta, transcribeAudioBuffer } from './aiService';

describe('resolveAudioUploadMeta', () => {
  it('sniffs RIFF/WAVE as wav even when declared mime is wrong', () => {
    const buffer = Buffer.alloc(44, 0);
    buffer.write('RIFF', 0, 'ascii');
    buffer.write('WAVE', 8, 'ascii');
    expect(resolveAudioUploadMeta(buffer, 'audio/webm')).toEqual({
      mimeType: 'audio/wav',
      extension: 'wav',
    });
  });

  it('sniffs EBML webm header', () => {
    const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(resolveAudioUploadMeta(buffer, 'audio/mp4')).toEqual({
      mimeType: 'audio/webm',
      extension: 'webm',
    });
  });

  it('sniffs ISO BMFF ftyp as m4a/mp4', () => {
    const buffer = Buffer.alloc(12, 0);
    buffer.write('ftyp', 4, 'ascii');
    expect(resolveAudioUploadMeta(buffer, 'audio/m4a')).toEqual({
      mimeType: 'audio/mp4',
      extension: 'm4a',
    });
  });

  it('sniffs Ogg magic', () => {
    const buffer = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(resolveAudioUploadMeta(buffer, 'application/octet-stream')).toEqual({
      mimeType: 'audio/ogg',
      extension: 'ogg',
    });
  });

  it('falls back to declared mime when buffer is too short to sniff', () => {
    const buffer = Buffer.from([1, 2, 3]);
    expect(resolveAudioUploadMeta(buffer, 'audio/mpeg')).toEqual({
      mimeType: 'audio/mpeg',
      extension: 'mp3',
    });
  });
});

describe('transcribeAudioBuffer', () => {
  const originalKey = process.env.GROQ_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('rejects empty buffers before calling Groq', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok'));
    await expect(transcribeAudioBuffer(Buffer.alloc(16), 'audio/webm')).rejects.toThrow(
      /empty or too short/i
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends sniffed webm fixture to Groq and returns transcript text', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const fixture = Buffer.alloc(128, 0);
    fixture[0] = 0x1a;
    fixture[1] = 0x45;
    fixture[2] = 0xdf;
    fixture[3] = 0xa3;
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('hello lecture', { status: 200 }));

    const result = await transcribeAudioBuffer(fixture, 'audio/m4a');
    expect(result.transcript).toBe('hello lecture');
    expect(result.sniffedMimeType).toBe('audio/webm');
    expect(result.byteLength).toBe(128);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });
});
