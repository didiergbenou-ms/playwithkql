/**
 * Original chiptune music, written as tracker-style patterns.
 *
 * These are compositions of my own in the 8-bit idiom. They are deliberately
 * NOT transcriptions of, or variations on, any existing game music — copying a
 * melody and altering it is a derivative work, and "changed it enough" has no
 * bright line in law. What actually makes this music feel familiar is not any
 * borrowed tune but the shared vocabulary of the era, none of which is
 * protectable: chord progressions, scales and modes, rhythms, song forms and
 * the pulse/triangle/noise palette itself.
 *
 * Notation, one token per 16th step:
 *   a4  c#5  bb2   play that note
 *   k s h o        kick, snare, closed hat, open hat  (noise channels)
 *   -              hold the previous note for another step
 *   .              silence
 *
 * Backing parts are GENERATED from a chord progression rather than typed out.
 * A 16-bar channel is 256 tokens; hand-typing that is how you get a bar with
 * 15 tokens in it, which silently drifts the part out of phase with the rest
 * of the band. Only leads are hand-written, and even those go through `bar()`,
 * which pads to exactly 16 steps.
 */

/** Timbres. `pulse12`/`pulse25` are the thin NES lead tones; square is 50%. */
export type MusicVoice = 'pulse12' | 'pulse25' | 'square' | 'triangle' | 'sawtooth' | 'noise';

export type DrumName = 'kick' | 'snare' | 'hat' | 'openHat';

const DRUM_TOKENS: Record<string, DrumName> = {
  k: 'kick',
  s: 'snare',
  h: 'hat',
  o: 'openHat',
};

export interface Channel {
  voice: MusicVoice;
  /** Relative level within the track. */
  gain: number;
  /** 16th-step tokens; whitespace between bars is ignored. */
  pattern: string;
  /** Adds delayed vibrato to sustained notes. Leads only. */
  vibrato?: boolean;
}

export interface Track {
  id: string;
  title: string;
  bpm: number;
  /** 0 = straight, ~0.5 = a hard shuffle. Delays every odd 16th. */
  swing?: number;
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
  /** Set instead of a pitch on noise channels. */
  drum?: DrumName;
}

/**
 * Expands a pattern into note events, resolving '-' holds into note lengths so
 * the scheduler never has to reason about sustain.
 *
 * Drum letters (k s h o) cannot collide with note names, which only use a-g,
 * so pitched and percussion patterns share one parser and one hold rule.
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

    const drum = DRUM_TOKENS[tok];
    if (drum) {
      events.push({ step, midi: 0, len: 1, drum });
      return;
    }

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

// ---- bass styles -----------------------------------------------------------
//
// The old music had exactly one bass rhythm and used it in every bar of every
// track, which is a large part of why it wore thin. These are the idiomatic
// NES patterns; picking a different one per section changes the whole feel
// without touching a single melody note.

type BassStyle = 'rootFifth' | 'octave' | 'drive' | 'arp' | 'pedal';

const bassBar = (name: string, style: BassStyle, octaves: number): string => {
  const shape = chord(name);
  const r = shift(shape.bass[0], octaves);
  const f = shift(shape.bass[1], octaves);
  const hi = shift(r, 1);
  const third = shift(shape.arp[1], octaves - 1);

  switch (style) {
    // steady quarter-note pulse, the workhorse
    case 'rootFifth':
      return bar(`${r} - - . ${f} - - . ${r} - - . ${f} - - .`);
    // low note answered an octave up: punchy, more forward motion
    case 'octave':
      return bar(`${r} - - . ${hi} - . . ${r} - - . ${f} - ${hi} .`);
    // relentless 8ths for the sections that need urgency
    case 'drive':
      return bar(`${r} - ${r} - ${r} - ${r} - ${f} - ${f} - ${r} - ${r} -`);
    // walks the chord tones, fills space when little else is playing
    case 'arp':
      return bar(`${r} - ${third} - ${f} - ${third} - ${r} - ${third} - ${f} - ${hi} -`);
    // static root under moving harmony: floating and tense
    case 'pedal':
      return bar(`${r} - - - - - - - ${r} - - - - - - -`);
  }
};

const bassLine = (progression: string[], style: BassStyle = 'rootFifth', octaves = 0): string =>
  progression.map((name) => bassBar(name, style, octaves)).join(' ');

// ---- arpeggios -------------------------------------------------------------

type ArpStyle = 'roll' | 'fast' | 'offbeat' | 'stab';

const arpBar = (name: string, style: ArpStyle, octaves: number): string => {
  const [a, b, c] = chord(name).arp.map((n) => shift(n, octaves));
  switch (style) {
    case 'roll':
      return bar(`${a} . ${b} . ${c} . ${b} . ${a} . ${b} . ${c} . ${b} .`);
    // 16th-note arpeggio: the classic trick for implying a full chord
    case 'fast':
      return bar(`${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b} ${a} ${b} ${c} ${b}`);
    // off the beat, so it locks with the drums rather than the bass
    case 'offbeat':
      return bar(`. . ${a} - . . ${b} - . . ${c} - . . ${b} -`);
    // short chord stabs on the backbeat
    case 'stab':
      return bar(`. . . . ${a} ${b} ${c} . . . . . ${a} ${b} ${c} .`);
  }
};

const arpLine = (progression: string[], style: ArpStyle = 'roll', octaves = 0): string =>
  progression.map((name) => arpBar(name, style, octaves)).join(' ');

// ---- percussion ------------------------------------------------------------
//
// There were no drums at all before this. On the NES the noise channel carries
// most of a track's energy, and its absence is why everything felt like a
// music box.

const BEATS = {
  /** Straight rock beat, hats on 8ths. */
  basic: 'k . h . s . h . k . h . s . h .',
  /** Busier: hats on every 16th. */
  busy: 'k h h h s h h h k h h k s h h h',
  /** Half-time, roomy — for calmer sections. */
  half: 'k . . . h . . . s . . . h . . o',
  /** Driving, for the finale. */
  drive: 'k . h . s . h k k . h . s . h h',
  /** Shuffle: hats on the swung 8ths only. */
  shuffle: 'k . . h s . . h k . . h s . . h',
  /** Bar of fill that signals a phrase ending. */
  fill: 'k . h . s . s . s s . s o . s s',
  /** Nothing — silence is a texture too. */
  none: '.',
} as const;

/**
 * Builds a drum track of `bars` bars from a base beat, swapping in a fill on
 * the last bar of each 4-bar phrase. Phrase-end fills are what stop a loop
 * from feeling like wallpaper.
 */
const drums = (beat: keyof typeof BEATS, bars: number, fillEvery = 4): string => {
  const out: string[] = [];
  for (let i = 0; i < bars; i++) {
    const isFill = fillEvery > 0 && i % fillEvery === fillEvery - 1 && i > 0;
    out.push(bar(isFill ? BEATS.fill : BEATS[beat]));
  }
  return out.join(' ');
};

/** Repeats a pattern fragment, for sections that share a groove. */
export const repeatPattern = (pattern: string, times: number): string =>
  Array.from({ length: times }, () => pattern).join(' ');

// ---- the soundtrack --------------------------------------------------------
//
// Each room track is 16 bars in an A / A' / B / A form, which is the shape most
// NES loops use: state the hook, restate it with a change, go somewhere else,
// come home. The B section deliberately contrasts in register, rhythm and
// often mode, because the ear stops hearing a repeat once it has been taken
// somewhere and brought back.
//
// Hooks are built the way catchy chip melodies are built: a short 3-6 note
// motif, restated at a different pitch (a sequence), then answered by a
// contrasting phrase. Pickup notes lead into downbeats and syncopation keeps
// the line off the grid.

/** Menus. Dorian and swung — the mode game music reaches for when it wants
 *  "detective" rather than "heroic". */
const BUREAU: Track = {
  id: 'bureau',
  title: 'Bureau Nights',
  bpm: 104,
  swing: 0.34,
  channels: [
    {
      voice: 'pulse25',
      gain: 0.07,
      vibrato: true,
      pattern: lead(
        // motif: a rising 4th then a lazy fall back
        'a4 . . . d5 . c5 . a4 . . . g4 . . .',
        'a4 . . . d5 . c5 . e5 - - . . . . .',
        // the same shape a step higher: a sequence
        'b4 . . . e5 . d5 . b4 . . . a4 . . .',
        'g4 . . . a4 . . . e4 - - - . . . .',
      ),
    },
    { voice: 'triangle', gain: 0.14, pattern: bassLine(['Am', 'Am', 'Dm', 'Dm'], 'octave') },
    { voice: 'pulse12', gain: 0.028, pattern: arpLine(['Am', 'Am', 'Dm', 'Dm'], 'offbeat') },
    { voice: 'noise', gain: 0.1, pattern: drums('shuffle', 4) },
  ],
};

/** Room 1 — Customer Office. Curious and unhurried; you are still reading. */
const OFFICE: Track = {
  id: 'office',
  title: 'Office Hours',
  bpm: 108,
  swing: 0.2,
  channels: [
    {
      voice: 'pulse25',
      gain: 0.062,
      vibrato: true,
      pattern: lead(
        // A — a 4-note cell, stated then answered
        '. . . . e4 . a4 . c5 - - . b4 - - .',
        'a4 - - . g4 . e4 . a4 - - - . . . .',
        '. . . . f4 . a4 . c5 - - . a4 - - .',
        'g4 - - . f4 . e4 . f4 - - - . . . .',
        // A' — the same shape moved to the new chords: a sequence
        '. . . . e4 . g4 . c5 - - . e5 - - .',
        'd5 - - . c5 . g4 . e4 - - - . . . .',
        '. . . . d4 . g4 . b4 - - . d5 - - .',
        'c5 - - . b4 . a4 . g4 - - - . . . .',
        // B — higher, sparser, sits back and lets the drums come forward
        'd5 . . . f5 - - . e5 - - . d5 - - .',
        'a4 - - . d5 - - - - - . . . . . .',
        'c5 . . . e5 - - . d5 - - . c5 - - .',
        'a4 - - . e4 - - - - - . . . . . .',
        // back home, with a turnaround that leads into the loop point
        'f4 . a4 . c5 - - . a4 . c5 . f5 - - .',
        'e5 . d5 . b4 - - . g4 . b4 . d5 - - .',
        'c5 - - . b4 . a4 . e4 - - - . . . .',
        'a4 - - - - - - - . . . . e4 . g4 .',
      ),
    },
    {
      voice: 'triangle',
      gain: 0.14,
      pattern:
        bassLine(['Am', 'Am', 'F', 'F'], 'rootFifth') +
        ' ' +
        bassLine(['C', 'C', 'G', 'G'], 'octave') +
        ' ' +
        bassLine(['Dm', 'Dm', 'Am', 'Am'], 'arp') +
        ' ' +
        bassLine(['F', 'G', 'Am', 'Am'], 'rootFifth'),
    },
    {
      voice: 'pulse12',
      gain: 0.024,
      pattern:
        arpLine(['Am', 'Am', 'F', 'F'], 'offbeat') +
        ' ' +
        arpLine(['C', 'C', 'G', 'G'], 'offbeat') +
        ' ' +
        arpLine(['Dm', 'Dm', 'Am', 'Am'], 'stab') +
        ' ' +
        arpLine(['F', 'G', 'Am', 'Am'], 'roll'),
    },
    {
      voice: 'noise',
      gain: 0.085,
      // drums sit out the first phrase, so their entry lifts the second
      pattern: drums('none', 2, 0) + ' ' + drums('basic', 6) + ' ' + drums('busy', 8),
    },
  ],
};

/** Room 2 — Monitoring Forest. Bright major pentatonic; the platforming room. */
const FOREST: Track = {
  id: 'forest',
  title: 'Telemetry Pines',
  bpm: 132,
  channels: [
    {
      voice: 'pulse12',
      gain: 0.06,
      vibrato: true,
      pattern: lead(
        // A — pentatonic hook with a pickup into each bar
        '. . . g4 c5 - . e5 d5 - . c5 g4 - - .',
        'a4 - . c5 g4 - - . e4 - - - . . . .',
        '. . . a4 c5 - . e5 c5 - . a4 e4 - - .',
        'g4 - . a4 e4 - - - - - . . . . . .',
        // A' — the same figure a fourth up
        '. . . a4 f5 - . a5 g5 - . f5 c5 - - .',
        'a4 - . c5 f5 - - . a4 - - - . . . .',
        '. . . b4 g5 - . b5 a5 - . g5 d5 - - .',
        'b4 - . d5 g5 - - - - - . . . . . .',
        // B — a descending run, the highest point of the track
        'a5 . g5 . f5 . e5 . f5 - - . a5 - - .',
        'c5 - - . f5 - - - - - . . . . . .',
        'g5 . e5 . c5 . e5 . g5 - - . c6 - - .',
        'b5 . a5 . g5 - - - - - . . . . . .',
        // home
        '. . . d5 g5 - . b5 a5 - . g5 d5 - - .',
        'e5 . d5 . b4 - - . d5 - - - . . . .',
        'c5 . e5 . g5 - - . e5 . c5 . g4 - - .',
        'c5 - - - - - - - . . . . . . . .',
      ),
    },
    {
      voice: 'triangle',
      gain: 0.13,
      pattern:
        bassLine(['C', 'C', 'Am', 'Am'], 'octave') +
        ' ' +
        bassLine(['F', 'F', 'G', 'G'], 'octave') +
        ' ' +
        bassLine(['F', 'F', 'C', 'C'], 'drive') +
        ' ' +
        bassLine(['G', 'G', 'C', 'C'], 'rootFifth'),
    },
    {
      voice: 'pulse25',
      gain: 0.022,
      pattern:
        arpLine(['C', 'C', 'Am', 'Am'], 'fast', -1) +
        ' ' +
        arpLine(['F', 'F', 'G', 'G'], 'fast', -1) +
        ' ' +
        arpLine(['F', 'F', 'C', 'C'], 'offbeat') +
        ' ' +
        arpLine(['G', 'G', 'C', 'C'], 'fast', -1),
    },
    { voice: 'noise', gain: 0.09, pattern: drums('basic', 8) + ' ' + drums('busy', 8) },
  ],
};

/** Room 3 — Server Caverns. Natural minor, sparse, colder. */
const CAVERNS: Track = {
  id: 'caverns',
  title: 'Cold Aisle',
  bpm: 112,
  channels: [
    {
      voice: 'pulse25',
      gain: 0.058,
      vibrato: true,
      pattern: lead(
        // A — long, cold intervals; nothing hurries down here
        'e4 - - . a4 - - . b4 - - . c5 - - -',
        'b4 - - . a4 - - - - - . . . . . .',
        'e4 - - . g4 - - . b4 - - . a4 - - -',
        'g4 - - . e4 - - - - - . . . . . .',
        'f4 - - . a4 - - . c5 - - . d5 - - -',
        'c5 - - . a4 - - - - - . . . . . .',
        'd5 - - . f5 - - . e5 - - . d5 - - -',
        'a4 - - . d5 - - - - - . . . . . .',
        // B — the lead drops out entirely and the arpeggio carries it. The
        // silence is the contrast; when the tune returns it lands.
        '. . . . . . . . . . . . . . . .',
        '. . . . . . . . . . . . . . . .',
        '. . . . . . . . f5 - - . e5 - - .',
        'c5 - - - - - . . . . . . . . . .',
        // return, higher and with more urgency than it left
        'd5 . . . g5 - - . f5 - - . d5 - - .',
        'b4 - - . d5 - - - - - . . . . . .',
        'a5 . g5 . e5 . d5 . c5 - - . b4 - - .',
        'a4 - - - - - - - . . . . . . . .',
      ),
    },
    {
      voice: 'triangle',
      gain: 0.14,
      pattern:
        bassLine(['Am', 'Am', 'Em', 'Em'], 'rootFifth') +
        ' ' +
        bassLine(['F', 'F', 'Dm', 'Dm'], 'rootFifth') +
        ' ' +
        bassLine(['Am', 'Am', 'F', 'F'], 'pedal') +
        ' ' +
        bassLine(['G', 'G', 'Am', 'Am'], 'arp'),
    },
    {
      voice: 'pulse12',
      gain: 0.026,
      pattern:
        arpLine(['Am', 'Am', 'Em', 'Em'], 'roll') +
        ' ' +
        arpLine(['F', 'F', 'Dm', 'Dm'], 'roll') +
        ' ' +
        arpLine(['Am', 'Am', 'F', 'F'], 'fast') +
        ' ' +
        arpLine(['G', 'G', 'Am', 'Am'], 'offbeat'),
    },
    {
      voice: 'noise',
      gain: 0.075,
      pattern: drums('half', 4) + ' ' + drums('basic', 4) + ' ' + drums('busy', 8),
    },
  ],
};

/** Room 4 — Data Center. Mixolydian and driving: the finale. */
const CORE: Track = {
  id: 'core',
  title: 'Core Ingestion',
  bpm: 146,
  channels: [
    {
      voice: 'pulse12',
      gain: 0.062,
      vibrato: true,
      pattern: lead(
        // A — a repeated-note motif, insistent, built for speed
        'd5 . d5 . c5 . d5 . f5 - - . d5 - - .',
        'c5 . c5 . a4 . c5 . d5 - - - . . . .',
        'c5 . c5 . bb4 . c5 . e5 - - . c5 - - .',
        'g4 . a4 . c5 - - . g4 - - - . . . .',
        // A' — same motif over the flat-VI, which is the "heroic" turn
        'bb4 . bb4 . a4 . bb4 . d5 - - . bb4 - - .',
        'f5 . d5 . bb4 - - . d5 - - - . . . .',
        'c5 . e5 . g5 . e5 . c5 - - . g4 - - .',
        'a4 . c5 . e5 - - - - - . . . . . .',
        // B — held notes over the busiest drums in the game
        'a5 - - - - - - - g5 - - - - - - -',
        'f5 - - - - - - - e5 - - - - - - -',
        'd5 - - - - - - - f5 - - - - - - -',
        'a5 - - - - - - - - - - - - - - .',
        // final run
        'g5 . a5 . g5 . e5 . c5 - - . e5 - - .',
        'g5 . e5 . c5 - - . g4 - - - . . . .',
        'd5 . e5 . f5 . g5 . a5 . g5 . f5 . e5 .',
        'd5 - - - - - - - - - - - - - - .',
      ),
    },
    {
      voice: 'triangle',
      gain: 0.135,
      pattern:
        bassLine(['Dm', 'Dm', 'C', 'C'], 'drive') +
        ' ' +
        bassLine(['Bb', 'Bb', 'C', 'C'], 'drive') +
        ' ' +
        bassLine(['Dm', 'Dm', 'Bb', 'Bb'], 'octave') +
        ' ' +
        bassLine(['C', 'C', 'Dm', 'Dm'], 'drive'),
    },
    {
      voice: 'pulse25',
      gain: 0.022,
      pattern:
        arpLine(['Dm', 'Dm', 'C', 'C'], 'fast', -1) +
        ' ' +
        arpLine(['Bb', 'Bb', 'C', 'C'], 'fast', -1) +
        ' ' +
        arpLine(['Dm', 'Dm', 'Bb', 'Bb'], 'stab') +
        ' ' +
        arpLine(['C', 'C', 'Dm', 'Dm'], 'fast', -1),
    },
    { voice: 'noise', gain: 0.095, pattern: drums('drive', 8) + ' ' + drums('busy', 8) },
  ],
};

/** Debrief. Short, major, and unambiguously a win. */
const CLOSED: Track = {
  id: 'closed',
  title: 'Case Closed',
  bpm: 120,
  channels: [
    {
      voice: 'pulse25',
      gain: 0.075,
      vibrato: true,
      pattern: lead(
        'c5 . e5 . g5 - - . c6 - - - . . . .',
        'a5 . g5 . e5 . g5 . c6 - - - - - . .',
        'f5 . g5 . a5 - - . g5 - - . e5 - - .',
        'c5 - - - - - - - - - - - - - - .',
      ),
    },
    {
      voice: 'triangle',
      gain: 0.14,
      pattern: bassLine(['C', 'Am', 'F', 'G'], 'octave'),
    },
    {
      voice: 'pulse12',
      gain: 0.026,
      pattern: arpLine(['C', 'Am', 'F', 'G'], 'fast', -1),
    },
    { voice: 'noise', gain: 0.09, pattern: drums('basic', 4) },
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

/** Room index -> track. Keeps App from knowing track ids. */
export const ROOM_TRACKS = ['office', 'forest', 'caverns', 'core'] as const;

export const trackForRoom = (index: number): string =>
  ROOM_TRACKS[Math.max(0, Math.min(ROOM_TRACKS.length - 1, index))];
