/**
 * All game audio, synthesised at runtime. No audio files.
 *
 * Design notes:
 *  - Sound carries a large share of perceived "game feel"; a silent game reads
 *    as flat even when the visuals are identical.
 *  - Success cues ascend, failure cues descend — a cross-cultural signal.
 *  - Arcade punch comes from a ~3ms attack and a short exponential decay.
 *  - Music is scheduled with a lookahead loop against the AudioContext clock
 *    rather than setInterval alone, which would drift audibly.
 *  - Browsers keep an AudioContext suspended until a real user gesture, so
 *    `unlock()` must be called from a click or keypress handler.
 */

import {
  TRACKS,
  midiToFreq,
  parsePattern,
  type DrumName,
  type MusicVoice,
  type NoteEvent,
  type TrackId,
} from './music';

type Wave = OscillatorType;

interface Note {
  f: number;
  at: number;
  dur: number;
  wave?: Wave;
  gain?: number;
}

const C4 = 261.63;
const G4 = 392.0;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const G3 = 196.0;
const C3 = 130.81;
const A5 = 880.0;
const B5 = 987.77;

const arp = (freqs: number[], step: number, dur: number, wave: Wave = 'square', gain = 0.13): Note[] =>
  freqs.map((f, i) => ({ f, at: i * step, dur, wave, gain }));

const CUES: Record<string, Note[]> = {
  correct: arp([C5, G5], 0.075, 0.16),
  correctGood: arp([C5, E5, G5], 0.07, 0.18),
  correctPerfect: [
    ...arp([C5, E5, G5, C6], 0.075, 0.2),
    { f: C4, at: 0, dur: 0.5, wave: 'triangle', gain: 0.09 },
    { f: G4, at: 0.225, dur: 0.42, wave: 'triangle', gain: 0.09 },
    { f: E5, at: 0.34, dur: 0.34, wave: 'square', gain: 0.07 },
  ],
  wrong: [
    { f: G3, at: 0, dur: 0.14, wave: 'triangle', gain: 0.12 },
    { f: C3, at: 0.12, dur: 0.22, wave: 'triangle', gain: 0.12 },
  ],
  tick: [{ f: 1200, at: 0, dur: 0.045, wave: 'square', gain: 0.07 }],
  pickup: arp([B5, E5 * 2], 0.055, 0.09, 'square', 0.08),
  crystal: arp([G5, C6, E5 * 2], 0.06, 0.16, 'square', 0.1),
  gate: [
    { f: 700, at: 0, dur: 0.09, wave: 'square', gain: 0.1 },
    { f: 500, at: 0.07, dur: 0.09, wave: 'square', gain: 0.1 },
    { f: 330, at: 0.14, dur: 0.16, wave: 'square', gain: 0.1 },
  ],
  hurt: [
    { f: 180, at: 0, dur: 0.12, wave: 'sawtooth', gain: 0.1 },
    { f: 120, at: 0.08, dur: 0.14, wave: 'sawtooth', gain: 0.08 },
  ],
  jump: [{ f: 420, at: 0, dur: 0.07, wave: 'square', gain: 0.05 }],
  evidence: arp([E5, A5], 0.07, 0.16, 'square', 0.1),
  rankUp: [
    ...arp([C5, E5, G5, C6, G5, C6], 0.09, 0.22),
    { f: C4, at: 0, dur: 0.8, wave: 'triangle', gain: 0.08 },
  ],
  caseClosed: [
    ...arp([C5, E5, G5, C6], 0.11, 0.26),
    { f: E5 * 2, at: 0.44, dur: 0.5, wave: 'square', gain: 0.12 },
    { f: C4, at: 0, dur: 1.0, wave: 'triangle', gain: 0.08 },
    { f: G4, at: 0.44, dur: 0.56, wave: 'triangle', gain: 0.08 },
  ],
};

export type CueName = keyof typeof CUES;

export interface AudioSettings {
  sfxOn: boolean;
  musicOn: boolean;
  /** 0..1 */
  sfxVolume: number;
  /** 0..1 */
  musicVolume: number;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  sfxOn: true,
  musicOn: true,
  sfxVolume: 0.7,
  // music sits well under the effects so it never competes with feedback
  musicVolume: 0.32,
};

const STORAGE_KEY = 'kql-detective-audio';
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.14;
/** Music drops to this fraction while a modal is open, so reading is easier. */
const DUCK = 0.35;

interface Prepared {
  voice: MusicVoice;
  gain: number;
  events: NoteEvent[];
  steps: number;
  vibrato: boolean;
}

/**
 * Percussion, built from filtered noise.
 *
 * The music had no drums at all, which is the main reason it read as a music
 * box rather than a game soundtrack — an NES track gets most of its drive from
 * the noise channel. Each drum is white noise through a different filter, and
 * the kick additionally gets a pitch-dropping triangle underneath it, which is
 * the trick that gives an 8-bit kick its thump; noise alone is just a hiss.
 */
const DRUM_SPEC: Record<DrumName, { type: BiquadFilterType; hz: number; q: number; dur: number; gain: number }> = {
  kick: { type: 'lowpass', hz: 130, q: 1, dur: 0.11, gain: 0.9 },
  snare: { type: 'bandpass', hz: 1750, q: 0.8, dur: 0.13, gain: 0.5 },
  hat: { type: 'highpass', hz: 7500, q: 1, dur: 0.03, gain: 0.22 },
  openHat: { type: 'highpass', hz: 6200, q: 1, dur: 0.17, gain: 0.16 },
};

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private settings: AudioSettings = { ...DEFAULT_SETTINGS };

  private timer: ReturnType<typeof setInterval> | null = null;
  private prepared: Prepared[] = [];
  private stepsPerLoop = 0;
  private stepDur = 0;
  private swing = 0;
  private noise: AudioBuffer | null = null;
  private waveCache = new Map<number, PeriodicWave>();
  private nextStepTime = 0;
  private step = 0;
  private currentTrack: TrackId | null = null;
  private ducked = false;
  private focused = false;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...this.load() };
  }

  private load(): Partial<AudioSettings> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<AudioSettings>) : {};
    } catch {
      return {};
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** Kept for the older on/off call sites. */
  get isEnabled() {
    return this.settings.sfxOn;
  }

  update(patch: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.save();
    this.applyVolumes();

    if (this.settings.musicOn) {
      this.unlock();
      if (this.currentTrack && !this.timer) this.startScheduler();
    } else {
      this.stopScheduler();
    }
    if (this.settings.sfxOn) this.unlock();
  }

  setEnabled(on: boolean) {
    this.update({ sfxOn: on, musicOn: on });
  }

  private applyVolumes() {
    if (!this.sfxBus || !this.musicBus) return;
    this.sfxBus.gain.value = this.settings.sfxOn ? this.settings.sfxVolume : 0;
    this.musicBus.gain.value = this.settings.musicOn ? this.settings.musicVolume * this.musicScale() : 0;
  }

  /** Combined effect of ducking and the focus fade. */
  private musicScale(): number {
    if (this.focused) return 0;
    return this.ducked ? DUCK : 1;
  }

  private rampMusic(seconds: number) {
    if (!this.musicBus || !this.ctx) return;
    const target = this.settings.musicOn ? this.settings.musicVolume * this.musicScale() : 0;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(target, this.ctx.currentTime + seconds);
  }

  /** Lowers the music while a modal has the player's attention. */
  setDucked(on: boolean) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.rampMusic(0.25);
  }

  /**
   * Fades the music out entirely. Used when the player has been sitting in a
   * terminal for a while: ducking is not enough when you are reading and typing
   * for minutes, because that is exactly when a repeating loop starts to grate.
   */
  setFocusMode(on: boolean) {
    if (this.focused === on) return;
    this.focused = on;
    this.rampMusic(on ? 1.6 : 0.9);
  }

  /** Must be called from a user gesture, or the context stays suspended. */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);

        this.sfxBus = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.sfxBus.connect(this.master);
        this.musicBus.connect(this.master);
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (this.settings.musicOn && this.currentTrack && !this.timer) this.startScheduler();
    } catch {
      /* audio unavailable — the game stays fully playable */
    }
  }

  // ---- one-shot effects ----------------------------------------------------

  play(cue: CueName) {
    if (!this.settings.sfxOn) return;
    this.unlock();
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    for (const n of CUES[cue] ?? []) {
      this.voice(n.f, now + n.at, n.dur, n.wave ?? 'square', n.gain ?? 0.12, bus);
    }
  }

  private voice(freq: number, at: number, dur: number, wave: Wave, peak: number, out: GainNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    // 3ms attack then exponential decay: the classic chip envelope
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // ---- music voices --------------------------------------------------------

  /**
   * Pulse wave at a given duty cycle.
   *
   * A plain `square` is a 50% pulse, and it was the only lead timbre here.
   * Narrower duties (12.5% and 25%) are the thin, reedy tones most associated
   * with NES leads, and having two of them lets one part sit clearly on top of
   * another instead of the whole mix blurring together.
   */
  private pulseWave(duty: number): PeriodicWave | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const cached = this.waveCache.get(duty);
    if (cached) return cached;

    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    }
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.waveCache.set(duty, wave);
    return wave;
  }

  private noiseBuffer(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (this.noise) return this.noise;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  private drum(name: DrumName, at: number, level: number, out: GainNode) {
    const ctx = this.ctx;
    const buf = this.noiseBuffer();
    if (!ctx || !buf) return;
    const spec = DRUM_SPEC[name];

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.setValueAtTime(spec.hz, at);
    filter.Q.setValueAtTime(spec.q, at);

    const gain = ctx.createGain();
    const peak = Math.max(0.0002, level * spec.gain);
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(at);
    src.stop(at + spec.dur + 0.02);

    // Pitch-dropping body under the kick. Without this the kick is a click.
    if (name === 'kick') {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.09);
      og.gain.setValueAtTime(Math.max(0.0002, level * 1.1), at);
      og.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      osc.connect(og);
      og.connect(out);
      osc.start(at);
      osc.stop(at + 0.13);
    }
  }

  /** One pitched music note, with optional vibrato on longer notes. */
  private musicNote(
    freq: number,
    at: number,
    dur: number,
    v: MusicVoice,
    peak: number,
    out: GainNode,
    vibrato: boolean,
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (v === 'pulse12' || v === 'pulse25') {
      const w = this.pulseWave(v === 'pulse12' ? 0.125 : 0.25);
      if (w) osc.setPeriodicWave(w);
      else osc.type = 'square';
    } else if (v !== 'noise') {
      osc.type = v;
    }

    osc.frequency.setValueAtTime(freq, at);

    // Delayed vibrato on sustained notes — a held chip note is otherwise dead
    // flat, and this is how the era added expression with no extra channel.
    let lfo: OscillatorNode | null = null;
    if (vibrato && dur > 0.28) {
      lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.setValueAtTime(5.5, at);
      depth.gain.setValueAtTime(0, at);
      depth.gain.setValueAtTime(0, at + 0.16);
      depth.gain.linearRampToValueAtTime(freq * 0.012, at + 0.3);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(at);
      lfo.stop(at + dur + 0.02);
    }

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.004);
    gain.gain.setValueAtTime(Math.max(0.0002, peak), at + Math.max(0.005, dur * 0.7));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // ---- music ---------------------------------------------------------------

  playTrack(id: TrackId) {
    if (this.currentTrack === id) return;
    const track = TRACKS[id];
    if (!track) return;

    this.currentTrack = id;
    this.prepared = track.channels.map((c) => {
      const { events, steps } = parsePattern(c.pattern);
      return { voice: c.voice, gain: c.gain, events, steps, vibrato: c.vibrato ?? false };
    });
    this.stepsPerLoop = Math.max(...this.prepared.map((p) => p.steps), 1);
    // 16 steps to the bar, four beats to the bar => a step is a 16th note
    this.stepDur = 60 / track.bpm / 4;
    this.swing = track.swing ?? 0;

    this.stopScheduler();
    this.step = 0;
    if (this.settings.musicOn) {
      this.unlock();
      this.startScheduler();
    }
  }

  stopMusic() {
    this.currentTrack = null;
    this.stopScheduler();
  }

  private startScheduler() {
    if (!this.ctx || this.timer || !this.prepared.length) return;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  private stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Schedules every step that falls inside the lookahead window. Keeping the
   * clock in AudioContext time means setInterval jitter never accumulates.
   */
  private tick() {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || ctx.state !== 'running') return;

    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      // Swing: push every odd 16th later so pairs play long-short. The step
      // clock itself stays rigid, so this never accumulates drift.
      const swung = this.step % 2 === 1 ? this.stepDur * this.swing * 0.5 : 0;
      const at = this.nextStepTime + swung;

      for (const ch of this.prepared) {
        const local = this.step % ch.steps;
        for (const ev of ch.events) {
          if (ev.step !== local) continue;
          if (ev.drum) {
            this.drum(ev.drum, at, ch.gain, bus);
            continue;
          }
          // slight gap at the end so repeated notes re-articulate
          const dur = Math.max(0.05, ev.len * this.stepDur * 0.92);
          this.musicNote(midiToFreq(ev.midi), at, dur, ch.voice, ch.gain, bus, ch.vibrato);
        }
      }
      this.nextStepTime += this.stepDur;
      this.step = (this.step + 1) % this.stepsPerLoop;
    }
  }
}

export const audio = new GameAudio();

export const cueForTier = (tier: 1 | 2 | 3): CueName =>
  tier === 3 ? 'correctPerfect' : tier === 2 ? 'correctGood' : 'correct';
