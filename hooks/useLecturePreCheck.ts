/**
 * The readings behind the recorder's pre-check panel.
 *
 * What it does: holds a short-lived `getUserMedia` stream purely so the
 * student can SEE that we hear them, runs an `AnalyserNode` over it for the
 * level bars and the audio-quality badge, lists the microphones, and grades
 * the connection.
 *
 * What it does NOT do: record. The take itself is still one `MediaRecorder`
 * in `stores/lectureRecordingStore.ts`, on its own stream. This hook releases
 * its stream the moment recording starts, so the two never hold the microphone
 * at once and a browser that refuses a second capture never sees one.
 *
 * Gotchas:
 *  - `enumerateDevices` returns blank labels until a capture has been granted,
 *    which is why the device list is refreshed AFTER the stream opens rather
 *    than on mount. A list of four "" entries is not a picker.
 *  - A remembered `deviceId` that is no longer plugged in makes `getUserMedia`
 *    throw `OverconstrainedError`; `usableMicDeviceId` drops stale ids before
 *    they are ever requested.
 *  - `navigator.connection` is Chromium-only. When it is absent the internet
 *    grade comes from ONE timed HEAD to `/health`; when both are absent the
 *    badge says "Checking" rather than inventing a speed.
 *  - Every classifier lives in `@lantern/shared/utils/lectureAudio`, tested
 *    there, so the phone's pre-flight card and this panel cannot drift apart.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyLectureAudioQuality,
  classifyLectureInternet,
  type LectureAudioQuality,
  type LectureInternetQuality,
} from '@lantern/shared/utils/lectureAudio';
import { getApiRoot } from '../services/supabase';
import {
  rememberMicDeviceId,
  rememberedMicDeviceId,
  usableMicDeviceId,
} from '../utils/lectureRecorderPrefs';

export interface MicDeviceOption {
  deviceId: string;
  label: string;
}

export interface LecturePreCheck {
  /** Latest RMS level in dBFS, or `null` before the first frame. */
  levelDb: number | null;
  quality: LectureAudioQuality;
  internet: LectureInternetQuality;
  devices: MicDeviceOption[];
  selectedDeviceId: string | null;
  selectDevice: (deviceId: string) => void;
  /** The permission / hardware failure, in the words the student sees. */
  error: string | null;
  /** True once a stream is open and frames are being read. */
  listening: boolean;
}

/** How much history the RMS and the clipping share are measured over. */
const WINDOW_MS = 2000;
/** A sample at or beyond this magnitude counts as clipped. */
const CLIP_MAGNITUDE = 0.98;
/** Below this the level is silence; log10(0) is not a number. */
const SILENCE_FLOOR = 1e-6;
const PROBE_TIMEOUT_MS = 5000;

type Frame = { at: number; sumSquares: number; samples: number; clipped: number };

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission is blocked. Allow mic access for this site, then retry.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone found. Plug one in and try again.';
  }
  if (name === 'NotReadableError') {
    return 'Another app is using the microphone. Close it and try again.';
  }
  return 'Could not read the microphone. Check it is connected, then retry.';
}

/**
 * `navigator.connection`, where it exists. Typed locally because it is not in
 * the DOM lib and a global augmentation would claim it exists everywhere.
 */
function readConnection(): { effectiveType?: string; rtt?: number } | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; rtt?: number };
  };
  return nav.connection ?? null;
}

export function useLecturePreCheck(active: boolean): LecturePreCheck {
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [clippingRatio, setClippingRatio] = useState(0);
  const [devices, setDevices] = useState<MicDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [probeMs, setProbeMs] = useState<number | null>(null);
  const [connectionTick, setConnectionTick] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const framesRef = useRef<Frame[]>([]);

  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    framesRef.current = [];
    setListening(false);
    setLevelDb(null);
    setClippingRatio(0);
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ------------------------------------------------------------ the mic --
  useEffect(() => {
    if (!active) {
      teardown();
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Audio recording is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    let cancelled = false;
    const wanted = selectedDeviceId;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: wanted ? { deviceId: { exact: wanted } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setError(null);
        setListening(true);

        // Labels only exist once a capture has been granted, so the list is
        // read here rather than on mount.
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) {
            const inputs = all
              .filter((device) => device.kind === 'audioinput')
              .map((device, index) => ({
                deviceId: device.deviceId,
                label: device.label || `Microphone ${index + 1}`,
              }));
            setDevices(inputs);
            if (!wanted) {
              const remembered = usableMicDeviceId(rememberedMicDeviceId(), inputs);
              if (remembered) setSelectedDeviceId(remembered);
            }
          }
        } catch {
          // A browser that will not list devices still records on the default.
        }

        const AudioContextCtor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) return;
        const context = new AudioContextCtor();
        contextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);

        const read = () => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buffer);
          let sumSquares = 0;
          let clipped = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const value = buffer[i] ?? 0;
            sumSquares += value * value;
            if (Math.abs(value) >= CLIP_MAGNITUDE) clipped += 1;
          }
          const now = Date.now();
          const frames = framesRef.current;
          frames.push({ at: now, sumSquares, samples: buffer.length, clipped });
          while (frames.length > 0 && now - (frames[0]?.at ?? now) > WINDOW_MS) frames.shift();

          let totalSquares = 0;
          let totalSamples = 0;
          let totalClipped = 0;
          for (const frame of frames) {
            totalSquares += frame.sumSquares;
            totalSamples += frame.samples;
            totalClipped += frame.clipped;
          }
          if (totalSamples > 0) {
            const rms = Math.sqrt(totalSquares / totalSamples);
            setLevelDb(20 * Math.log10(Math.max(rms, SILENCE_FLOOR)));
            setClippingRatio(totalClipped / totalSamples);
          }
          rafRef.current = requestAnimationFrame(read);
        };
        rafRef.current = requestAnimationFrame(read);
      } catch (err) {
        if (cancelled) return;
        setListening(false);
        setError(micErrorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [active, selectedDeviceId, teardown]);

  // ------------------------------------------------------- the internet --
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const connection = readConnection() as
      | (EventTarget & { effectiveType?: string; rtt?: number })
      | null;
    const bump = () => setConnectionTick((n) => n + 1);
    connection?.addEventListener?.('change', bump);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      connection?.removeEventListener?.('change', bump);
    };
  }, []);

  // One timed HEAD, and only where `navigator.connection` told us nothing.
  useEffect(() => {
    if (!active || !online) return;
    if (readConnection()) return;
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const startedAt = Date.now();
    void fetch(`${getApiRoot()}/health`, { method: 'HEAD', signal: controller.signal })
      .then(() => {
        if (!cancelled) setProbeMs(Date.now() - startedAt);
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, online]);

  const selectDevice = useCallback((deviceId: string) => {
    rememberMicDeviceId(deviceId || null);
    setSelectedDeviceId(deviceId || null);
  }, []);

  const quality = useMemo(
    () => classifyLectureAudioQuality({ rmsDb: levelDb, clippingRatio }),
    [levelDb, clippingRatio]
  );

  const internet = useMemo(() => {
    const connection = readConnection();
    void connectionTick;
    return classifyLectureInternet({
      online,
      effectiveType: connection?.effectiveType ?? null,
      rttMs: connection?.rtt ?? null,
      probeMs,
    });
  }, [online, probeMs, connectionTick]);

  return {
    levelDb,
    quality,
    internet,
    devices,
    selectedDeviceId,
    selectDevice,
    error,
    listening,
  };
}
