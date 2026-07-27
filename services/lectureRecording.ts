/**
 * Browser MediaRecorder helpers for lecture capture (used by lectureRecordingStore).
 */

export const MIN_LECTURE_RECORD_MS = 2000;
export const RECORDER_CHUNK_WAIT_MS = 1000;

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function chunksTotalSize(chunks: Blob[]): number {
  return chunks.reduce((sum, chunk) => sum + (chunk?.size || 0), 0);
}

/** Wait until MediaRecorder has flushed at least one chunk, or timeout. */
export function waitForRecorderChunks(
  getChunks: () => Blob[],
  timeoutMs = RECORDER_CHUNK_WAIT_MS
): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (chunksTotalSize(getChunks()) > 0 || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 0);
  });
}

export async function encodeBlobAsWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('WAV re-encode is not supported in this browser.');
  }
  const ctx = new AudioContextCtor();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = decoded.sampleRate;
    const length = decoded.length;
    const mono = new Float32Array(length);
    const ch0 = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      const ch1 = decoded.getChannelData(1);
      for (let i = 0; i < length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
    } else {
      mono.set(ch0);
    }
    const dataSize = length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, mono[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export function formatTranscribeDiag(meta: {
  blobSize?: number;
  mimeType?: string;
  durationMs?: number;
}): string {
  const parts: string[] = [];
  if (typeof meta.durationMs === 'number') parts.push(`${Math.round(meta.durationMs / 1000)}s`);
  if (typeof meta.blobSize === 'number') parts.push(`${meta.blobSize}B`);
  if (meta.mimeType) parts.push(meta.mimeType);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export function formatRecordingDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function getElapsedRecordingSeconds(startedAt: number | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}
