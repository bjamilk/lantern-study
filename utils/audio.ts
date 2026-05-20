// Programmatic Audio Synthesizer using browser Web Audio API
// This avoids downloading external assets and works offline.

let audioCtx: AudioContext | null = null;
let lobbyInterval: any = null;
let lobbyNotes: number[] = [];
let lobbyNoteIndex = 0;
let isMuted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (isMuted) return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export const gameAudio = {
  setMuted(mute: boolean) {
    isMuted = mute;
    if (mute && audioCtx) {
      audioCtx.close().then(() => {
        audioCtx = null;
      });
      this.stopLobby();
    }
  },

  getMuted(): boolean {
    return isMuted;
  },

  playTick() {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  },

  playCorrect() {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (Arpeggio)
    
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + index * 0.08);
      
      gain.gain.setValueAtTime(0, now + index * 0.08);
      gain.gain.linearRampToValueAtTime(0.15, now + index * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + index * 0.08);
      osc.stop(now + index * 0.08 + 0.3);
    });
  },

  playIncorrect() {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.3);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(now + 0.4);
  },

  playLobby() {
    const ctx = getAudioContext();
    if (!ctx) return;
    this.stopLobby();

    // Pentatonic scale notes for a catchy, upbeat background lobby synth
    // C4, D4, E4, G4, A4, C5, D5, E5
    lobbyNotes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
    lobbyNoteIndex = 0;

    lobbyInterval = setInterval(() => {
      const internalCtx = getAudioContext();
      if (!internalCtx) return;

      const now = internalCtx.currentTime;
      const osc = internalCtx.createOscillator();
      const gain = internalCtx.createGain();

      // Simple pseudo-random rhythmic sequence
      const note = lobbyNotes[lobbyNoteIndex];
      lobbyNoteIndex = (lobbyNoteIndex + 1) % lobbyNotes.length;

      // Randomize velocity/tempo slightly for organic feel
      if (Math.random() > 0.3) {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note, now);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(internalCtx.destination);

        osc.start();
        osc.stop(now + 0.3);
      }
    }, 150);
  },

  stopLobby() {
    if (lobbyInterval) {
      clearInterval(lobbyInterval);
      lobbyInterval = null;
    }
  },

  playFanfare(winner: boolean) {
    const ctx = getAudioContext();
    if (!ctx) return;
    this.stopLobby();

    const now = ctx.currentTime;
    
    if (winner) {
      // Victory Fanfare (Happy C major progression)
      const victoryNotes = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50];
      const durations = [0.15, 0.15, 0.15, 0.3, 0.15, 0.6];
      let cumulativeTime = 0;

      victoryNotes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + cumulativeTime;
        const duration = durations[index];

        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.1, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration);

        cumulativeTime += duration - 0.02;
      });
    } else {
      // Defeat Fanfare (Melancholic descending progression)
      const defeatNotes = [392.00, 370.00, 349.23, 311.13];
      const durations = [0.25, 0.25, 0.25, 0.75];
      let cumulativeTime = 0;

      defeatNotes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + cumulativeTime;
        const duration = durations[index];

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, start);
        if (index === 3) {
          // Slide down on the last note
          osc.frequency.linearRampToValueAtTime(220, start + duration);
        }

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.1, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration);

        cumulativeTime += duration - 0.05;
      });
    }
  }
};
