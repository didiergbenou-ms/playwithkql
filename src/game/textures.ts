import Phaser from 'phaser';
import {
  CHARACTERS,
  FRAME_NAMES,
  SPRITE_H,
  SPRITE_W,
  paintCharacter,
  textureKey,
} from './characters';
import { NOTE_ROWS, VERDICT_ROWS, terminalRows } from './propSprites';

/**
 * World art, generated at runtime. No binary assets.
 *
 * Rules that keep it authentic:
 *   - 16px tiles, 1 game pixel = 1 canvas pixel
 *   - hard edges only: no shadowBlur, no roundRect, no gradients
 *   - a fixed 16-colour palette
 */

export const PAL: Record<string, string | null> = {
  '.': null,
  k: '#0d0b1a',
  d: '#1d1b38',
  n: '#2c2a5e',
  s: '#45418c',
  p: '#6f6ac4',
  c: '#4fe6e6',
  t: '#2a9d9d',
  w: '#f6f6ff',
  g: '#9a97c4',
  a: '#f7c948',
  o: '#e8862b',
  r: '#e5404f',
  m: '#e451c8',
  l: '#5fd97a',
  e: '#2b8f4c',
  f: '#f0b088',
};

export const COLORS = {
  void: 0x0d0b1a,
  dark: 0x1d1b38,
  navy: 0x2c2a5e,
  cyan: 0x4fe6e6,
  magenta: 0xe451c8,
  amber: 0xf7c948,
  red: 0xe5404f,
  lime: 0x5fd97a,
  white: 0xf6f6ff,
};

export const TILE = 16;
/** Physics body, smaller than the 16x24 sprite so shoulders do not snag. */
export const PLAYER_W = 10;
export const PLAYER_H = 20;

function paint(ctx: CanvasRenderingContext2D, rows: string[]): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function makeFromRows(scene: Phaser.Scene, key: string, rows: string[]): void {
  if (scene.textures.exists(key)) return;
  const w = Math.max(...rows.map((r) => r.length));
  const tex = scene.textures.createCanvas(key, w, rows.length);
  if (!tex) return;
  paint(tex.getContext(), rows);
  tex.refresh();
}

function makeDrawn(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, w, h);
  draw(ctx);
  tex.refresh();
}

// ---- enemy: a corrupted null (12 x 12) ------------------------------------

const BUG_A = [
  '..rr....rr..',
  '...r....r...',
  '.rrrrrrrrrr.',
  'rrkkrrrrkkrr',
  'rrkkrrrrkkrr',
  'rrrrrrrrrrrr',
  'rrwwrrrrwwrr',
  'rrrrrrrrrrrr',
  '.rrrrrrrrrr.',
  '..r.r..r.r..',
  '.r..r..r..r.',
  '............',
];

const BUG_B = [
  '............',
  '..rr....rr..',
  '...r....r...',
  '.rrrrrrrrrr.',
  'rrwwrrrrwwrr',
  'rrwwrrrrwwrr',
  'rrrrrrrrrrrr',
  'rrkkrrrrkkrr',
  'rrrrrrrrrrrr',
  '.rrrrrrrrrr.',
  '.r..r..r..r.',
  '..r.r..r.r..',
];

// ---- collectibles ---------------------------------------------------------

const FRAGMENT_A = [
  '...cc...',
  '..cwwc..',
  '.cwccwc.',
  'cwccccwc',
  'cwccccwc',
  '.cwccwc.',
  '..cwwc..',
  '...cc...',
];

const FRAGMENT_B = [
  '........',
  '...cc...',
  '..cwwc..',
  '.cwccwc.',
  '.cwccwc.',
  '..cwwc..',
  '...cc...',
  '........',
];

const CRYSTAL_A = [
  '...ww...',
  '..wmmw..',
  '.wmmmmw.',
  'wmmwwmmw',
  'wmmwwmmw',
  'wmmmmmmw',
  '.wmmmmw.',
  '..wmmw..',
  '...ww...',
  '...mm...',
];

const CRYSTAL_B = [
  '...ww...',
  '..wmmw..',
  '.wmwwmw.',
  'wmwwwwmw',
  'wmwwwwmw',
  'wmmmmmmw',
  '.wmmmmw.',
  '..wmmw..',
  '...ww...',
  '...mm...',
];

// ---- terminals (16 x 24) --------------------------------------------------


// ---- procedural tiles -----------------------------------------------------

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function drawGround(capped: boolean) {
  return (ctx: CanvasRenderingContext2D) => {
    px(ctx, 0, 0, TILE, TILE, PAL.n!);
    px(ctx, 0, 7, TILE, 1, PAL.d!);
    px(ctx, 0, 15, TILE, 1, PAL.d!);
    px(ctx, 7, 0, 1, 7, PAL.d!);
    px(ctx, 3, 8, 1, 7, PAL.d!);
    px(ctx, 11, 8, 1, 7, PAL.d!);

    const r = rng(capped ? 3 : 9);
    for (let i = 0; i < 5; i++) {
      px(ctx, Math.floor(r() * TILE), Math.floor(r() * TILE), 1, 1, PAL.s!);
    }

    if (capped) {
      px(ctx, 0, 0, TILE, 2, PAL.s!);
      px(ctx, 0, 0, TILE, 1, PAL.c!);
      for (let x = 0; x < TILE; x += 4) px(ctx, x, 2, 1, 1, PAL.c!);
    }
  };
}

function drawPlatform(ctx: CanvasRenderingContext2D) {
  px(ctx, 0, 0, TILE, 1, PAL.c!);
  px(ctx, 0, 1, TILE, 2, PAL.s!);
  px(ctx, 0, 3, TILE, 2, PAL.n!);
  px(ctx, 0, 5, TILE, 1, PAL.d!);
  for (let x = 2; x < TILE; x += 5) px(ctx, x, 3, 1, 2, PAL.p!);
}

function drawSpike(ctx: CanvasRenderingContext2D) {
  px(ctx, 0, 13, TILE, 3, PAL.d!);
  for (let t = 0; t < 4; t++) {
    const bx = t * 4;
    px(ctx, bx + 1, 10, 2, 3, PAL.r!);
    px(ctx, bx + 1, 9, 2, 1, PAL.r!);
    px(ctx, bx + 2, 6, 1, 3, PAL.r!);
    px(ctx, bx + 2, 5, 1, 1, PAL.w!);
  }
}

function drawGate(ctx: CanvasRenderingContext2D) {
  px(ctx, 0, 0, TILE, TILE, PAL.d!);
  px(ctx, 0, 0, 2, TILE, PAL.a!);
  px(ctx, TILE - 2, 0, 2, TILE, PAL.a!);
  for (let y = 1; y < TILE; y += 4) {
    px(ctx, 2, y, TILE - 4, 2, PAL.o!);
    px(ctx, 2, y, TILE - 4, 1, PAL.a!);
  }
}

function drawSpark(colour: string) {
  return (ctx: CanvasRenderingContext2D) => {
    px(ctx, 1, 0, 2, 1, colour);
    px(ctx, 0, 1, 4, 2, colour);
    px(ctx, 1, 3, 2, 1, colour);
  };
}

/**
 * Distant server racks. Drawn one screen wide (320 at 2x zoom) and tiled, with
 * every rack rooted to the bottom edge so the skyline always meets the ground.
 *
 * Deliberately low contrast: background colours are kept close to the sky so
 * the foreground reads first. Window lights avoid cyan and magenta, which are
 * reserved for collectibles.
 */
function drawSkyline(seed: number, body: string, light: string, minH: number, maxH: number) {
  return (ctx: CanvasRenderingContext2D) => {
    const r = rng(seed);
    const W = 320;
    const H = 160;
    let x = 0;
    while (x < W) {
      const rw = 14 + Math.floor(r() * 22);
      const rh = minH + Math.floor(r() * (maxH - minH));
      px(ctx, x, H - rh, rw, rh, body);
      px(ctx, x, H - rh, rw, 1, light);
      for (let ly = H - rh + 4; ly < H - 3; ly += 5) {
        for (let lx = x + 2; lx < x + rw - 2; lx += 4) {
          if (r() > 0.62) px(ctx, lx, ly, 2, 2, light);
        }
      }
      x += rw + 2 + Math.floor(r() * 5);
    }
  };
}

/** Background-only shades, darker than anything in the playfield. */
const BG = {
  farBody: '#121026',
  farLight: '#1b1936',
  nearBody: '#191735',
  nearLight: '#262247',
};

// ---- registry --------------------------------------------------------------

export function generateTextures(scene: Phaser.Scene): void {
  makeDrawn(scene, 'tile', TILE, TILE, drawGround(false));
  makeDrawn(scene, 'tile_top', TILE, TILE, drawGround(true));
  makeDrawn(scene, 'platform', TILE, 6, drawPlatform);
  makeDrawn(scene, 'spike', TILE, TILE, drawSpike);
  makeDrawn(scene, 'gate', TILE, TILE, drawGate);

  // every character, so the select screen and hot-swapping both work
  for (const def of CHARACTERS) {
    for (const frame of FRAME_NAMES) {
      const key = textureKey(def.id, frame);
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, SPRITE_W, SPRITE_H);
      if (!tex) continue;
      paintCharacter(tex.getContext(), def, frame, 1);
      tex.refresh();
    }
  }

  makeFromRows(scene, 'bug0', BUG_A);
  makeFromRows(scene, 'bug1', BUG_B);
  makeFromRows(scene, 'fragment0', FRAGMENT_A);
  makeFromRows(scene, 'fragment1', FRAGMENT_B);
  makeFromRows(scene, 'crystal0', CRYSTAL_A);
  makeFromRows(scene, 'crystal1', CRYSTAL_B);
  makeFromRows(scene, 'note', NOTE_ROWS);
  makeFromRows(scene, 'terminal_locked', terminalRows('a'));
  makeFromRows(scene, 'terminal_solved', terminalRows('l'));
  makeFromRows(scene, 'verdict', VERDICT_ROWS);

  makeDrawn(scene, 'spark_cyan', 4, 4, drawSpark(PAL.c!));
  makeDrawn(scene, 'spark_magenta', 4, 4, drawSpark(PAL.m!));
  makeDrawn(scene, 'spark_amber', 4, 4, drawSpark(PAL.a!));

  makeDrawn(scene, 'skyline_far', 320, 160, drawSkyline(21, BG.farBody, BG.farLight, 46, 150));
  makeDrawn(scene, 'skyline_near', 320, 160, drawSkyline(94, BG.nearBody, BG.nearLight, 30, 104));
}

export function registerAnimations(scene: Phaser.Scene): void {
  const a = scene.anims;

  for (const def of CHARACTERS) {
    const idleKey = `idle_${def.id}`;
    const runKey = `run_${def.id}`;
    if (!a.exists(idleKey)) {
      a.create({
        key: idleKey,
        frames: [
          { key: textureKey(def.id, 'idle0') },
          { key: textureKey(def.id, 'idle1') },
        ],
        frameRate: 3,
        repeat: -1,
      });
    }
    if (!a.exists(runKey)) {
      a.create({
        key: runKey,
        frames: (['run0', 'run1', 'run2', 'run3'] as const).map((f) => ({
          key: textureKey(def.id, f),
        })),
        frameRate: 10,
        repeat: -1,
      });
    }
  }

  if (!a.exists('bug')) {
    a.create({
      key: 'bug',
      frames: [{ key: 'bug0' }, { key: 'bug1' }],
      frameRate: 6,
      repeat: -1,
    });
  }
  if (!a.exists('fragment')) {
    a.create({
      key: 'fragment',
      frames: [{ key: 'fragment0' }, { key: 'fragment1' }],
      frameRate: 4,
      repeat: -1,
    });
  }
  if (!a.exists('crystal')) {
    a.create({
      key: 'crystal',
      frames: [{ key: 'crystal0' }, { key: 'crystal1' }],
      frameRate: 3,
      repeat: -1,
    });
  }
}
