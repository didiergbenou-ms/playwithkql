/**
 * Level reachability analysis.
 *
 * Characters have different jump multipliers, so "I can reach that ledge" is
 * not a property of the level alone. Sparky's apex is ~47px against Quill's
 * ~50px, which is the difference between clearing a three-tile rise and not —
 * and a collectible the weakest character physically cannot reach is a bug the
 * author will never notice while testing as someone else.
 *
 * This runs the real movement numbers (same gravity, jump velocity, air
 * acceleration and body size as GameScene) over the tile grid and reports what
 * each character can actually stand on.
 *
 * Deliberately conservative: it only credits a jump if a straightforward
 * simulation lands it. It does not model coyote time, jump buffering, or
 * bouncing off enemies, so anything it calls reachable genuinely is.
 */
import { GRAVITY, RUN_SPEED, AIR_ACCEL, JUMP_VELOCITY, MAX_FALL_SPEED } from './physics';
import { PLAYER_W, PLAYER_H } from './textures';
import { parseLevel, TILE, type ParsedLevel } from './levels/heartbeatHills';

const DT = 1 / 240;
/** Enough for the longest arc; a jump that has not landed by now never will. */
const MAX_STEPS = 900;

export interface Grid {
  cols: number;
  rows: number;
  /** Blocks from every direction. */
  solid: boolean[][];
  /** Blocks only when falling onto it from above. */
  oneWay: boolean[][];
  /** Touching one of these is a death, so never route through them. */
  hazard: boolean[][];
}

export function buildGrid(level: ParsedLevel, openGates: boolean): Grid {
  const cols = Math.round(level.width / TILE);
  const rows = Math.round(level.height / TILE);
  const make = () => Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

  const grid: Grid = { cols, rows, solid: make(), oneWay: make(), hazard: make() };
  for (const c of level.solids) grid.solid[c.row][c.col] = true;
  for (const c of level.platforms) grid.oneWay[c.row][c.col] = true;
  for (const c of level.spikes) grid.hazard[c.row][c.col] = true;
  // Gates only block until their challenge is solved. Reachability of the
  // things *behind* a gate is what matters, so the closed case is the one where
  // a gate must be unpassable, and that is tested elsewhere.
  if (!openGates) for (const c of level.gates) grid.solid[c.row][c.col] = true;
  return grid;
}

const solidAt = (g: Grid, col: number, row: number): boolean =>
  col < 0 || col >= g.cols || row < 0 ? true : row >= g.rows ? false : g.solid[row][col];

const hazardAt = (g: Grid, col: number, row: number): boolean =>
  col < 0 || col >= g.cols || row < 0 || row >= g.rows ? false : g.hazard[row][col];

/** AABB of the player body centred on (x, y) as GameScene positions it. */
function boxCols(x: number): [number, number] {
  return [Math.floor((x - PLAYER_W / 2) / TILE), Math.floor((x + PLAYER_W / 2 - 0.001) / TILE)];
}
function boxRows(y: number): [number, number] {
  return [Math.floor((y - PLAYER_H / 2) / TILE), Math.floor((y + PLAYER_H / 2 - 0.001) / TILE)];
}

function overlapsSolid(g: Grid, x: number, y: number): boolean {
  const [c0, c1] = boxCols(x);
  const [r0, r1] = boxRows(y);
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (solidAt(g, c, r)) return true;
  return false;
}

function overlapsHazard(g: Grid, x: number, y: number): boolean {
  const [c0, c1] = boxCols(x);
  const [r0, r1] = boxRows(y);
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (hazardAt(g, c, r)) return true;
  return false;
}

/**
 * True when the body is resting on something. One-way platforms only count
 * when the feet are at their top edge and the player is not moving upward.
 */
function groundedAt(g: Grid, x: number, y: number, vy: number): boolean {
  const feet = y + PLAYER_H / 2;
  const [c0, c1] = boxCols(x);
  const row = Math.floor((feet + 1) / TILE);
  for (let c = c0; c <= c1; c++) {
    if (solidAt(g, c, row)) return true;
    if (vy >= 0 && row >= 0 && row < g.rows && c >= 0 && c < g.cols && g.oneWay[row][c]) {
      // only from above: feet must be within a pixel of the platform surface
      if (Math.abs(feet - row * TILE) <= 2) return true;
    }
  }
  return false;
}

export interface Spot {
  col: number;
  row: number;
  x: number;
  y: number;
}

const spotKey = (s: { col: number; row: number }) => `${s.col},${s.row}`;

/** Every tile a player could stand on: a surface with a body-sized gap above. */
export function standingSpots(g: Grid): Spot[] {
  const out: Spot[] = [];
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const surface = g.solid[row][col] || g.oneWay[row][col];
      if (!surface) continue;
      const x = col * TILE + TILE / 2;
      const y = row * TILE - PLAYER_H / 2;
      if (overlapsSolid(g, x, y) || overlapsHazard(g, x, y)) continue;
      out.push({ col, row: row - 1, x, y });
    }
  }
  return out;
}

interface Sim {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Runs one attempt and returns the landing spot, or null if the player died,
 * left the map, or never settled.
 */
function simulate(
  g: Grid,
  start: Sim,
  dir: -1 | 0 | 1,
  speedCap: number,
  landOn: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const s = { ...start };
  for (let i = 0; i < MAX_STEPS; i++) {
    // horizontal: accelerate toward the held direction, same as the air control
    const target = dir * speedCap;
    if (s.vx < target) s.vx = Math.min(target, s.vx + AIR_ACCEL * DT);
    else if (s.vx > target) s.vx = Math.max(target, s.vx - AIR_ACCEL * DT);

    s.vy = Math.min(MAX_FALL_SPEED, s.vy + GRAVITY * DT);

    // axis-separated movement so a wall stops x without stopping y
    const nx = s.x + s.vx * DT;
    if (!overlapsSolid(g, nx, s.y)) s.x = nx;
    else s.vx = 0;

    const ny = s.y + s.vy * DT;
    if (!overlapsSolid(g, s.x, ny)) {
      s.y = ny;
    } else {
      if (s.vy > 0) {
        // snap feet to the surface we just hit
        s.y = Math.floor((ny + PLAYER_H / 2) / TILE) * TILE - PLAYER_H / 2;
        s.vy = 0;
      } else {
        s.vy = 0;
      }
    }

    if (overlapsHazard(g, s.x, s.y)) return null;
    if (s.x < 0 || s.x > g.cols * TILE) return null;
    if (s.y > (g.rows + 4) * TILE) return null;

    if (s.vy >= 0 && landOn(s.x, s.y) && groundedAt(g, s.x, s.y, s.vy)) {
      return { x: s.x, y: s.y };
    }
  }
  return null;
}

/**
 * Which standing spots a character can reach from spawn.
 *
 * Walking is a grid move rather than a simulation: a physics step stops the
 * instant the body is grounded and displaced, so simulating a walk only ever
 * advanced a few pixels and the search never left the spawn tile. Jumps and
 * falls do use the real simulation, because those are the moves where the
 * character's jump multiplier actually decides the outcome.
 */
export function reachableSpots(g: Grid, jumpMul: number, speedMul: number, spawn: Spot): Set<string> {
  const speedCap = RUN_SPEED * speedMul;
  const jumpV = JUMP_VELOCITY * jumpMul;

  const spots = new Map(standingSpots(g).map((s) => [spotKey(s), s]));
  const seen = new Set<string>();
  const queue: Spot[] = [];

  const settle = (from: { col: number; row: number }) => {
    const k = spotKey(from);
    const spot = spots.get(k);
    if (!spot || seen.has(k)) return;
    seen.add(k);
    queue.push(spot);
  };

  /**
   * Landing row, derived the same way `groundedAt` decides you have landed —
   * with the one-pixel epsilon. Without it a body resting at feet 159.6 floors
   * to row 9 instead of the row 10 surface it is actually standing on, the key
   * matches no catalogued spot, and the search silently stops there.
   */
  const spotAtBody = (x: number, y: number) => ({
    col: Math.floor(x / TILE),
    row: Math.floor((y + PLAYER_H / 2 + 1) / TILE) - 1,
  });

  settle(spawn);
  // The spawn point hangs in the air, so drop the player and start from
  // wherever they come to rest.
  const landed = simulate(g, { x: spawn.x, y: spawn.y, vx: 0, vy: 0 }, 0, speedCap, () => true);
  if (landed) settle(spotAtBody(landed.x, landed.y));

  const movedFrom = (x: number, y: number) => (sx: number, sy: number) =>
    Math.abs(sx - x) > 2 || Math.abs(sy - y) > 2;

  while (queue.length) {
    const from = queue.shift()!;

    // --- walk one tile left/right along a surface --------------------------
    for (const step of [-1, 1] as const) {
      const next = spots.get(spotKey({ col: from.col + step, row: from.row }));
      if (next && !overlapsSolid(g, next.x, next.y)) settle(next);
    }

    // --- walk off the edge and fall ---------------------------------------
    for (const dir of [-1, 1] as const) {
      const res = simulate(
        g,
        { x: from.x, y: from.y, vx: dir * speedCap, vy: 0 },
        dir,
        speedCap,
        movedFrom(from.x, from.y),
      );
      if (res) settle(spotAtBody(res.x, res.y));
    }

    // --- jump, with and without a run-up ----------------------------------
    for (const dir of [-1, 0, 1] as const) {
      for (const runUp of [0, -1, 1] as const) {
        const res = simulate(
          g,
          { x: from.x, y: from.y, vx: runUp * speedCap, vy: jumpV },
          dir,
          speedCap,
          movedFrom(from.x, from.y),
        );
        if (res) settle(spotAtBody(res.x, res.y));
      }
    }
  }

  return seen;
}

export interface ItemCheck {
  kind: string;
  label: string;
  x: number;
  y: number;
  reachable: boolean;
}

/**
 * Can a character standing on a reachable spot actually collect / use this?
 *
 * Pickups sit in the air, so "reachable" means some reachable standing spot is
 * close enough horizontally and within jump height vertically.
 */
export function itemsReachable(
  g: Grid,
  reached: Set<string>,
  items: { kind: string; label: string; x: number; y: number }[],
  jumpMul: number,
): ItemCheck[] {
  const apex = (Math.abs(JUMP_VELOCITY * jumpMul) ** 2) / (2 * GRAVITY);
  const spots = standingSpots(g).filter((s) => reached.has(spotKey(s)));

  return items.map((item) => {
    const reachable = spots.some((s) => {
      const dy = s.y - item.y; // positive when the item is above the player
      const dx = Math.abs(s.x - item.x);
      if (dy > apex) return false;
      // Horizontal budget: how long the body is in the air near that height.
      // Generous on the way down since falling covers ground too.
      const budget = dy > 0 ? 68 : 96;
      return dx <= budget;
    });
    return { ...item, reachable };
  });
}

export interface CharacterReport {
  id: string;
  unreachableSpots: Spot[];
  unreachableItems: ItemCheck[];
}

/** Full analysis for one character against the shipped level. */
export function analyse(
  id: string,
  jumpMul: number,
  speedMul: number,
  level = parseLevel(),
): CharacterReport {
  const g = buildGrid(level, true);
  const spawn: Spot = {
    col: Math.floor(level.spawn.x / TILE),
    row: Math.floor(level.spawn.y / TILE),
    x: level.spawn.x,
    y: level.spawn.y,
  };
  const reached = reachableSpots(g, jumpMul, speedMul, spawn);

  const items = [
    ...level.fragments.map((c) => ({ kind: 'fragment', label: `frag @${c.col},${c.row}`, x: c.x, y: c.y })),
    ...level.crystals.map((c) => ({ kind: 'crystal', label: `crystal @${c.col},${c.row}`, x: c.x, y: c.y })),
    ...level.terminals.map((c) => ({
      kind: 'terminal',
      label: `terminal ${c.challengeIndex + 1}`,
      x: c.x,
      y: c.y,
    })),
    ...level.notes.map((c) => ({ kind: 'note', label: c.noteId, x: c.x, y: c.y })),
    ...(level.verdict
      ? [{ kind: 'verdict', label: 'verdict console', x: level.verdict.x, y: level.verdict.y }]
      : []),
  ];

  return {
    id,
    unreachableSpots: standingSpots(g).filter((s) => !reached.has(spotKey(s))),
    unreachableItems: itemsReachable(g, reached, items, jumpMul).filter((i) => !i.reachable),
  };
}
