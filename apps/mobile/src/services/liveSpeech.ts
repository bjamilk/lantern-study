/**
 * OS speech recognition for live lecture captions and short lesson commands.
 * Optional: Expo Go and phones that refuse a second mic stream return null
 * and the recorder keeps going without captions.
 */
import { mergeCaptionStream } from '@lantern/shared';

type SpeechEvent = {
  isFinal?: boolean;
  results?: Array<{ transcript?: string }>;
};

type SpeechMod = {
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => boolean;
    requestPermissionsAsync: () => Promise<{ granted?: boolean }>;
    start: (options: Record<string, unknown>) => void;
    stop: () => void;
    abort: () => void;
    addListener: (event: string, listener: (payload: SpeechEvent) => void) => { remove: () => void };
  };
};

export type LiveCaptionHandlers = {
  onUpdate: (next: { committed: string; interim: string }) => void;
  getCommitted: () => string;
};

function loadSpeechMod(): SpeechMod | null {
  try {
    // Optional native module — missing in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-speech-recognition') as SpeechMod;
  } catch {
    return null;
  }
}

function transcriptFrom(payload: SpeechEvent): string {
  return (payload.results ?? [])
    .map((row) => row.transcript?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function stopModule(api: SpeechMod['ExpoSpeechRecognitionModule']): void {
  try {
    api.stop();
  } catch {
    try {
      api.abort();
    } catch {
      // already stopped
    }
  }
}

export async function startLiveCaptionStream(
  handlers: LiveCaptionHandlers
): Promise<(() => void) | null> {
  const mod = loadSpeechMod();
  if (!mod?.ExpoSpeechRecognitionModule) return null;
  const api = mod.ExpoSpeechRecognitionModule;
  try {
    if (!api.isRecognitionAvailable()) return null;
    const permission = await api.requestPermissionsAsync();
    if (!permission.granted) return null;
  } catch {
    return null;
  }

  let wanted = true;
  const resultSub = api.addListener('result', (event) => {
    const piece = transcriptFrom(event);
    if (!piece) return;
    const merged = mergeCaptionStream({
      committed: handlers.getCommitted(),
      incomingFinals: event.isFinal ? [piece] : [],
      interim: event.isFinal ? '' : piece,
    });
    handlers.onUpdate({ committed: merged.committed, interim: merged.interim });
  });
  const endSub = api.addListener('end', () => {
    if (!wanted) return;
    try {
      api.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        requiresOnDeviceRecognition: true,
      });
    } catch {
      // Sharing the mic with the lecture recorder can fail a restart.
    }
  });

  const stop = () => {
    wanted = false;
    try {
      resultSub.remove();
      endSub.remove();
    } catch {
      // ignore
    }
    stopModule(api);
  };

  try {
    api.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition: true,
    });
    return stop;
  } catch {
    stop();
    return null;
  }
}

export async function recognizeOnce(): Promise<string | null> {
  const mod = loadSpeechMod();
  if (!mod?.ExpoSpeechRecognitionModule) return null;
  const api = mod.ExpoSpeechRecognitionModule;
  try {
    if (!api.isRecognitionAvailable()) return null;
    const permission = await api.requestPermissionsAsync();
    if (!permission.granted) return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      try {
        resultSub.remove();
        endSub.remove();
        errorSub.remove();
      } catch {
        // ignore
      }
      stopModule(api);
      resolve(text);
    };
    const resultSub = api.addListener('result', (event) => {
      const piece = transcriptFrom(event);
      if (event.isFinal && piece) finish(piece);
    });
    const endSub = api.addListener('end', () => finish(null));
    const errorSub = api.addListener('error', () => finish(null));
    try {
      api.start({
        lang: 'en-US',
        interimResults: false,
        continuous: false,
        addsPunctuation: true,
      });
    } catch {
      finish(null);
    }
  });
}
