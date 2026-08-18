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
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  function webmFixture(size = 128): Buffer {
    const fixture = Buffer.alloc(size, 0);
    fixture[0] = 0x1a;
    fixture[1] = 0x45;
    fixture[2] = 0xdf;
    fixture[3] = 0xa3;
    return fixture;
  }

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
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('hello lecture', { status: 200 }));

    const result = await transcribeAudioBuffer(webmFixture(), 'audio/m4a');
    expect(result.transcript).toBe('hello lecture');
    expect(result.provider).toBe('groq-whisper-turbo');
    expect(result.sniffedMimeType).toBe('audio/webm');
    expect(result.byteLength).toBe(128);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.groq.com');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('falls back to OpenAI Whisper when Groq fails outside production', async () => {
    process.env.NODE_ENV = 'test';
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('fallback transcript', { status: 200 }));

    const result = await transcribeAudioBuffer(webmFixture(), 'audio/webm');
    expect(result.transcript).toBe('fallback transcript');
    expect(result.provider).toBe('openai-whisper-1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.groq.com');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('api.openai.com');
  });

  it('uses OpenAI Whisper when only OPENAI_API_KEY is configured outside production', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.GROQ_API_KEY;
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('openai only', { status: 200 }));

    const result = await transcribeAudioBuffer(webmFixture(), 'audio/webm');
    expect(result.transcript).toBe('openai only');
    expect(result.provider).toBe('openai-whisper-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.openai.com');
  });

  it('does not fall back to OpenAI Whisper in production when Groq fails', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(transcribeAudioBuffer(webmFixture(), 'audio/webm')).rejects.toThrow(/Transcription failed/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.groq.com');
  });

  it('does not use OpenAI Whisper in production when it is the only key', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GROQ_API_KEY;
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('openai only', { status: 200 }));

    await expect(transcribeAudioBuffer(webmFixture(), 'audio/webm')).rejects.toThrow(/GROQ_API_KEY/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
