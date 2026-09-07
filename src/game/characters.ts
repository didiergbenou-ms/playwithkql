/**
 * Character sprites — 16x24, authored as pixel string maps.
 *
 * Every recruit shares one body rig and is differentiated by a palette swap
 * plus a headgear overlay. That is exactly how 8-bit games squeezed a roster
 * out of a tiny cartridge, and it means adding a character is ~10 lines
 * instead of redrawing eight frames.
 *
 * Symbols:
 *   .  transparent      K  outline        F  face / skin
 *   A  accent           P  primary        S  secondary
 *   B  boots            H  headgear       G  headgear shadow
 */

export const SPRITE_W = 16;
export const SPRITE_H = 24;

// ---- shared body rig -------------------------------------------------------

const HEAD = [
  '................',
  '................',
  '................',
  '.....KKKKKK.....',
  '....KFFFFFFK....',
  '....KFFFFFFK....',
  '....KAAAAAAK....',
  '....KFFFFFFK....',
  '....KFFFFFFK....',
  '.....KFFFFK.....',
  '......KFFK......',
];

const TORSO_NEUTRAL = [
  '...KKPPPPPPKK...',
  '..KPPPPPPPPPPK..',
  '.KPPKPPPPPPKPPK.',
  '.KPPKPPAAPPKPPK.',
  '.KPPKPPAAPPKPPK.',
  '.KPPKPPPPPPKPPK.',
  '..KKKPPPPPPKKK..',
  '....KSSSSSSK....',
  '....KSSSSSSK....',
];

const TORSO_RUN = [
  '...KKPPPPPPKK...',
  '..KPPPPPPPPPPK..',
  '..KKPPPPPPPPKK..',
  '.KPPKPPAAPPKPPK.',
  'KPPKKPPAAPPKKPPK',
  'KPPK.PPPPPP.KPPK',
  '.KK..PPPPPP..KK.',
  '....KSSSSSSK....',
  '....KSSSSSSK....',
];

const TORSO_UP = [
  '.KK.KPPPPPPK.KK.',
  'KPPKKPPPPPPKKPPK',
  'KPPKPPPPPPPPKPPK',
  'KPPKPPPAAPPPKPPK',
  '.KKKPPPAAPPPKKK.',
  '..KPPPPPPPPPPK..',
  '..KKPPPPPPPPKK..',
  '....KSSSSSSK....',
  '....KSSSSSSK....',
];

const LEGS_IDLE = [
  '....KSK..KSK....',
  '....KSK..KSK....',
  '...KBBK..KBBK...',
  '...KBBK..KBBK...',
];

const LEGS_RUN_A = [
  '...KSK....KSK...',
  '..KSK......KSK..',
  '..KBBK....KBBK..',
  '.KBBK......KBBK.',
];

const LEGS_RUN_B = [
  '.....KSSK.......',
  '.....KSSK.......',
  '....KBBBBK......',
  '....KBBBBK......',
];

const LEGS_RUN_C = [
  '....KSSK........',
  '...KSK.KSK......',
  '..KBBK..KBBK....',
  '..KBBK..KBBK....',
];

const LEGS_JUMP = [
  '...KSSK..KSSK...',
  '..KSSK....KSSK..',
  '..KBBK....KBBK..',
  '...KK......KK...',
];

const LEGS_FALL = [
  '..KSK......KSK..',
  '.KSK........KSK.',
  '.KBBK......KBBK.',
  'KBBK........KBBK',
];

/** Vertical bob applied to idle frame B, for a subtle breathing loop. */
const BLANK = '................';

const compose = (torso: string[], legs: string[], bob = false): string[] => {
  const rows = [...HEAD, ...torso, ...legs];
  return bob ? [BLANK, ...rows.slice(0, SPRITE_H - 1)] : rows;
};

export const FRAMES = {
  idle0: compose(TORSO_NEUTRAL, LEGS_IDLE),
  idle1: compose(TORSO_NEUTRAL, LEGS_IDLE, true),
  run0: compose(TORSO_RUN, LEGS_RUN_A),
  run1: compose(TORSO_RUN, LEGS_RUN_B),
  run2: compose(TORSO_RUN, LEGS_RUN_C),
  run3: compose(TORSO_RUN, LEGS_RUN_B),
  jump: compose(TORSO_UP, LEGS_JUMP),
  fall: compose(TORSO_UP, LEGS_FALL),
} as const;

export type FrameName = keyof typeof FRAMES;
export const FRAME_NAMES = Object.keys(FRAMES) as FrameName[];

// ---- headgear --------------------------------------------------------------

const HAT_FEDORA = [
  '................',
  '....KKKKKKKK....',
  '...KHHHHHHHHK...',
  '..KKHHHHHHHHKK..',
  '.KGGGGGGGGGGGGK.',
];

const HAT_CAP = [
  '................',
  '....KKKKKKKK....',
  '...KHHHHHHHHK...',
  '...KHHHHHHHHK...',
  '...KKHHHHHHKKGGG',
];

const HAT_HOOD = [
  '.........KK.....',
  '........KHHK....',
  '......KKHHHHK...',
  '....KKHHHHHHHK..',
  '...KHHHHHHHHHHK.',
];

const HAT_HELM = [
  '................',
  '.....KKKKKK.....',
  '....KHHHHHHK....',
  '...KHHAAAAHHK...',
  '...KHHHHHHHHK...',
];

// ---- roster ----------------------------------------------------------------

export interface CharacterStats {
  /** Multiplier on run speed. */
  speed: number;
  /** Multiplier on jump velocity. */
  jump: number;
  maxHealth: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** An affectionate nod to the era. */
  homage: string;
  perk: string;
  colors: Record<string, string>;
  hat: string[];
  stats: CharacterStats;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'quill',
    name: 'QUILL',
    title: 'The Veteran',
    blurb:
      'Twenty years of on-call. Has read more agent logs than anyone alive and trusts none of them.',
    homage: 'Every outage is a haunted house if you read the logs at 3am.',
    perk: 'Balanced — no weaknesses, no excuses',
    colors: {
      K: '#0d0b1a',
      F: '#f0b088',
      A: '#4fe6e6',
      P: '#45418c',
      S: '#2c2a5e',
      B: '#0d0b1a',
      H: '#1d1b38',
      G: '#0d0b1a',
    },
    hat: HAT_FEDORA,
    stats: { speed: 1, jump: 1, maxHealth: 3 },
  },
  {
    id: 'sparky',
    name: 'SPARKY',
    title: 'The Field Engineer',
    blurb:
      'Carries a wrench for problems that are not made of software. Built like a rack cabinet.',
    homage: 'Somewhere a moustachioed plumber is quietly jealous of the toolbelt.',
    perk: 'Tough — 4 hearts, slightly slower',
    colors: {
      K: '#0d0b1a',
      F: '#f0b088',
      A: '#f7c948',
      P: '#2a9d9d',
      S: '#1d6b6b',
      B: '#e8862b',
      H: '#e8862b',
      G: '#c06a1e',
    },
    hat: HAT_CAP,
    stats: { speed: 0.92, jump: 0.97, maxHealth: 4 },
  },
  {
    id: 'vell',
    name: 'VELL',
    title: 'The Pathfinder',
    blurb:
      'Maps the estate before touching it. Never enters a data centre without a lantern and a plan.',
    homage: 'Refuses to go alone. Always takes the lantern.',
    perk: 'Springheeled — jumps noticeably higher',
    colors: {
      K: '#0d0b1a',
      F: '#f0b088',
      A: '#f7c948',
      P: '#5fd97a',
      S: '#2b8f4c',
      B: '#8a5a2b',
      H: '#2b8f4c',
      G: '#1e6b38',
    },
    hat: HAT_HOOD,
    stats: { speed: 1, jump: 1.15, maxHealth: 3 },
  },
  {
    id: 'circuit',
    name: 'CIRCUIT',
    title: 'The Specialist',
    blurb:
      'Sealed suit, no small talk. Reads telemetry straight off the visor and moves before you finish the sentence.',
    homage: 'Rumoured to curl into a ball when nobody is watching.',
    perk: 'Fast — quickest on foot, only 2 hearts',
    colors: {
      K: '#0d0b1a',
      F: '#6f6ac4',
      A: '#4fe6e6',
      P: '#e451c8',
      S: '#a12f8c',
      B: '#45418c',
      H: '#e451c8',
      G: '#a12f8c',
    },
    hat: HAT_HELM,
    stats: { speed: 1.18, jump: 1.02, maxHealth: 2 },
  },
];

export const characterById = (id: string): CharacterDef =>
  CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

export const textureKey = (charId: string, frame: FrameName) => `${charId}_${frame}`;

// ---- rasterising -----------------------------------------------------------

/** Paints a frame plus the character's headgear onto a 2D context at 1px scale. */
export function paintCharacter(
  ctx: CanvasRenderingContext2D,
  def: CharacterDef,
  frame: FrameName,
  scale = 1,
): void {
  const rows = FRAMES[frame];
  const draw = (map: string[], yOffset: number) => {
    for (let y = 0; y < map.length; y++) {
      const row = map[y];
      for (let x = 0; x < row.length; x++) {
        const colour = def.colors[row[x]];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(x * scale, (y + yOffset) * scale, scale, scale);
      }
    }
  };

  draw(rows, 0);
  // headgear sits on top; idle1 is bobbed down a pixel so the hat follows
  draw(def.hat, frame === 'idle1' ? 1 : 0);
}

/** Renders a frame to a data URL — used by the React character select. */
export function characterPreviewUrl(def: CharacterDef, frame: FrameName, scale: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_W * scale;
  canvas.height = SPRITE_H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  paintCharacter(ctx, def, frame, scale);
  return canvas.toDataURL();
}
