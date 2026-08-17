/**
 * Original chiptune music, written as tracker-style patterns.
 *
 * These are compositions of my own in the 8-bit idiom — pulse lead, triangle
 * bass, arpeggiated chords. They are deliberately NOT transcriptions of any
 * existing game music, which would be someone else's copyright. The
 * familiarity comes from the conventions of the era, not from the tunes.
 *
 * Notation, one token per 16th step:
 *   a4  c#5  bb2   play that note
 *   -             hold the previous note for another step
 *   .             silence
 *
 * Backing parts are GENERATED from a chord progression rather than typed out.
 * A 16-bar channel is 256 tokens; hand-typing that is how you get a bar with
 * 15 tokens in it, which silently drifts the part out of phase with the rest
 * of the band. Only leads are hand-written, and even those go through `bar()`,
 * which pads to exactly 16 steps.
 */

export interface Channel {
  wave: OscillatorType;
  /** Relative level within the track. */
  gain: number;
  /** 16th-step tokens; whitespace between bars is ignored. */
  pattern: string;
}

export interface Track {
  id: string;
  title: string;
  bpm: number;
  channels: Channel[];
}

const SEMITONES: Record<string, number> = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
};

/** "c#4" -> MIDI number, or null if it is not a note token. */
export function noteToMidi(token: string): number | null {
  const m = /^([a-g](?:#|b)?)(-?\d)$/.exec(token.toLowerCase());
  if (!m) return null;
  const semi = SEMITONES[m[1]];
  if (semi === undefined) return null;
  return 12 * (Number(m[2]) + 1) + semi;
}

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export interface NoteEvent {
  step: number;
  midi: number;
  /** Length in steps, including any '-' holds. */
  len: number;
}

/**
 * Expands a pattern into note events, resolving '-' holds into note lengths so
 * the scheduler never has to reason about sustain.
 */
export function parsePattern(pattern: string): { events: NoteEvent[]; steps: number } {
  const tokens = pattern.trim().split(/\s+/);
  const events: NoteEvent[] = [];
  let current: NoteEvent | null = null;

  tokens.forEach((tok, step) => {
    if (tok === '-') {
      if (current) current.len++;
      return;
    }
    current = null;
    if (tok === '.') return;
    const midi = noteToMidi(tok);
    if (midi === null) return;
    current = { step, midi, len: 1 };
    events.push(current);
  });

  return { events, steps: tokens.length };
}

// ---- authoring helpers -----------------------------------------------------

const STEPS_PER_BAR = 16;

/** Pads a hand-written bar to exactly 16 steps so it cannot drift. */
const bar = (s: string): string => {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  if (toks.length > STEPS_PER_BAR) {
    throw new Error(`bar has ${toks.length} steps, max ${STEPS_PER_BAR}: ${s}`);
  }
  while (toks.length < STEPS_PER_BAR) toks.push('.');
  return toks.join(' ');
};

const lead = (...bars: string[]): string => bars.map(bar).join(' ');

/** A silent bar. */
const REST = '.';

/** Shifts a note token by whole octaves. */
const shift = (token: string, octaves: number): string => {
  const m = /^([a-g](?:#|b)?)(-?\d)$/.exec(token);
  return m ? `${m[1]}${Number(m[2]) + octaves}` : token;
};

interface ChordShape {
  /** [root, fifth] for the bass line. */
  bass: [string, string];
  /** [low, mid, high] for the arpeggio. */
  arp: [string, string, string];
}

/**
 * Chord voicings, defined once. Everything harmonic is built from this table,
 * so a wrong note is a single fix rather than a hunt through 256 tokens.
 */
const CHORDS: Record<string, ChordShape> = {
  Am: { bass: ['a2', 'e3'], arp: ['a3', 'c4', 'e4'] },
  Bdim: { bass: ['b2', 'f3'], arp: ['b3', 'd4', 'f4'] },
  Bm: { bass: ['b2', 'f#3'], arp: ['b3', 'd4', 'f#4'] },
  Bb: { bass: ['bb2', 'f3'], arp: ['bb3', 'd4', 'f4'] },
  C: { bass: ['c3', 'g3'], arp: ['c4', 'e4', 'g4'] },
  D: { bass: ['d3', 'a3'], arp: ['d4', 'f#4', 'a4'] },
  Dm: { bass: ['d3', 'a3'], arp: ['d4', 'f4', 'a4'] },
  E: { bass: ['e2', 'b2'], arp: ['e3', 'g#3', 'b3'] },
  Em: { bass: ['e2', 'b2'], arp: ['e3', 'g3', 'b3'] },
  F: { bass: ['f2', 'c3'], arp: ['f3', 'a3', 'c4'] },
  G: { bass: ['g2', 'd3'], arp: ['g3', 'b3', 'd4'] },
  Gm: { bass: ['g2', 'd3'], arp: ['g3', 'bb3', 'd4'] },
};

const chord = (name: string): ChordShape => {
  const c = CHORDS[name];
  if (!c) throw new Error(`unknown chord "${name}"`);
  return c;
};

/** One bar of walking bass per chord. */
const bassLine = (progression: string[], octaves = 0): string =>
  progression
    .map((name) => {
      const [r, f] = chord(name).bass.map((n) => shift(n, octaves));
      return bar(`${r} - . . ${r} - . . ${r} - . . ${f} - . .`);
    })
    .join(' ');

/** One bar of rolling arpeggio per chord. */
const arpLine = (progression: string[], octaves = 0): string =>
  progression
    .map((name) => {
      const [a, b, c] = chord(name).arp.map((n) => shift(n, octaves));
      return bar(`${a} . ${b} . ${c} . ${b} . ${a} . ${b} . ${c} . ${b} .`);
    })
    .join(' ');

// ---- the soundtrack --------------------------------------------------------
//
// Room tracks are 16 bars: an A section and a contrasting B section. A single
// 8-bar loop came round roughly three times a minute, which is what made the
// first version wear thin.

const BUREAU: Track = {
  id: 'bureau',
  title: 'Bureau Nights',
  bpm: 92,
  channels: [
    {
      wave: 'square',
      gain: 0.085,
      pattern: lead(
        'a4 - - . c5 - - . b4 - - -',
        'e4 - - . g4 - - . a4 - - -',
        'c5 - - . b4 - - . a4 - - . g4 - -',
        'a4 - - - - -',
      ),
    },
    { wave: 'triangle', gain: 0.15, pattern: bassLine(['Am', 'F', 'G', 'Am']) },
  ],
};

/** Room 1 — Customer Office. Curious and unhurried; you are still reading. */
const OFFICE: Track = {
  id: 'office',
  title: 'Office Hours',
  bpm: 96,
  channels: [
    {
      wave: 'triangle',
      gain: 0.15,
      pattern: bassLine([
        'Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G',
        'Dm', 'Dm', 'Am', 'Am', 'E', 'E', 'Am', 'Am',
      ]),
    },
    {
      wave: 'square',
      gain: 0.045,
      pattern: arpLine([
        'Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G',
        'Dm', 'Dm', 'Am', 'Am', 'E', 'E', 'Am', 'Am',
      ]),
    },
    {
      wave: 'square',
      gain: 0.06,
      pattern: lead(
        REST, '. . . . a4 - - . c5 - - -',
        REST, '. . . . c5 - - . a4 - - -',
        REST, '. . . . e5 - - . d5 - - -',
        REST, '. . . . d5 - - . b4 - - -',
        // B section: the lead answers itself an octave up
        REST, '. . . . a5 - - . g5 - - -',
        REST, '. . . . e5 - - . c5 - - -',
        REST, '. . . . b4 - - . g#4 - - -',
        REST, 'a4 - - - - - - -',
      ),
    },
  ],
};

/** Room 2 — Monitoring Forest. Brighter and moving; the platforming stretch. */
const FOREST: Track = {
  id: 'forest',
  title: 'Telemetry Pines',
  bpm: 118,
  channels: [
    {
      wave: 'triangle',
      gain: 0.16,
      pattern: bassLine([
        'Dm', 'Dm', 'Bb', 'Bb', 'C', 'C', 'Am', 'Am',
        'Gm', 'Gm', 'Bb', 'Bb', 'C', 'C', 'Dm', 'Dm',
      ]),
    },
    {
      wave: 'square',
      gain: 0.05,
      pattern: arpLine([
        'Dm', 'Dm', 'Bb', 'Bb', 'C', 'C', 'Am', 'Am',
        'Gm', 'Gm', 'Bb', 'Bb', 'C', 'C', 'Dm', 'Dm',
      ]),
    },
    {
      wave: 'square',
      gain: 0.065,
      pattern: lead(
        '. . . . d5 - . f5 - . e5 - -', REST,
        '. . . . f5 - - . d5 - - -', REST,
        '. . . . e5 - . g5 - . f5 - -', REST,
        '. . . . a4 - - - -', REST,
        // B section: longer phrases, sits higher
        '. . . . g5 - . bb5 - . a5 - -', REST,
        '. . . . f5 - - . d5 - - -', REST,
        '. . . . e5 - . g5 - . a5 - -', REST,
        '. . . . d5 - - - -', REST,
      ),
    },
  ],
};

/** Room 3 — Server Caverns. Darker and slower, more space between notes. */
const CAVERNS: Track = {
  id: 'caverns',
  title: 'Cold Aisle',
  bpm: 104,
  channels: [
    {
      wave: 'triangle',
      gain: 0.17,
      pattern: bassLine([
        'Em', 'Em', 'C', 'C', 'Am', 'Am', 'Bm', 'Bm',
        'Am', 'Am', 'Em', 'Em', 'C', 'C', 'Bm', 'Bm',
      ]),
    },
    {
      wave: 'square',
      gain: 0.04,
      pattern: arpLine([
        'Em', 'Em', 'C', 'C', 'Am', 'Am', 'Bm', 'Bm',
        'Am', 'Am', 'Em', 'Em', 'C', 'C', 'Bm', 'Bm',
      ]),
    },
    {
      wave: 'square',
      gain: 0.055,
      pattern: lead(
        REST, REST,
        '. . . . b4 - - - g4 - - -', REST,
        REST, '. . . . a4 - - - e4 - - -',
        REST, '. . . . f#4 - - - b4 - - -',
        // B section
        REST, '. . . . c5 - - - a4 - - -',
        REST, '. . . . b4 - - - e5 - - -',
        REST, REST,
        '. . . . d5 - - - b4 - - -', REST,
      ),
    },
  ],
};

/** Room 4 — Data Center. Driving and a little urgent; the case is closing. */
const CORE: Track = {
  id: 'core',
  title: 'Core Ingestion',
  bpm: 134,
  channels: [
    {
      wave: 'triangle',
      gain: 0.17,
      pattern: bassLine(
        [
          'Am', 'G', 'F', 'E', 'Am', 'G', 'F', 'E',
          'Dm', 'C', 'Bb', 'Am', 'Dm', 'E', 'Am', 'Am',
        ],
        -1,
      ),
    },
    {
      wave: 'square',
      gain: 0.05,
      pattern: arpLine([
        'Am', 'G', 'F', 'E', 'Am', 'G', 'F', 'E',
        'Dm', 'C', 'Bb', 'Am', 'Dm', 'E', 'Am', 'Am',
      ]),
    },
    {
      wave: 'square',
      gain: 0.07,
      pattern: lead(
        '. . . . a4 - . c5 - . b4 - -', REST,
        '. . . . c5 - . e5 - . d5 - -', REST,
        '. . . . e5 - . a5 - - -', REST,
        '. . . . g4 - . b4 - . a4 - -', '. . . . a4 - - - - - -',
        // B section: the melody climbs
        '. . . . d5 - . f5 - . e5 - -', REST,
        '. . . . c5 - . e5 - . g5 - -', REST,
        '. . . . bb4 - . d5 - . c5 - -', REST,
        '. . . . e5 - . g#5 - . a5 - -', 'a5 - - - - - -',
      ),
    },
  ],
};

/** Debrief — short major resolution. */
const CLOSED: Track = {
  id: 'closed',
  title: 'Case Closed',
  bpm: 104,
  channels: [
    {
      wave: 'square',
      gain: 0.095,
      pattern: lead(
        'c5 - . e5 - . g5 - . c6 - - -',
        'g5 - . e5 - . g5 - - -',
        'a4 - . c5 - . e5 - . a5 - - -',
        'g5 - - . e5 - - . c5 - - -',
      ),
    },
    { wave: 'triangle', gain: 0.15, pattern: bassLine(['C', 'F', 'Am', 'G']) },
  ],
};

export const TRACKS: Record<string, Track> = {
  bureau: BUREAU,
  office: OFFICE,
  forest: FOREST,
  caverns: CAVERNS,
  core: CORE,
  closed: CLOSED,
};

export type TrackId = keyof typeof TRACKS;

/**
 * Which track plays in which room. Music doubles as orientation — the score
 * changing tells you that you have crossed into somewhere new.
 */
export const ROOM_TRACKS: TrackId[] = ['office', 'forest', 'caverns', 'core'];

export const trackForRoom = (index: number): TrackId =>
  ROOM_TRACKS[Math.max(0, Math.min(ROOM_TRACKS.length - 1, index))];
