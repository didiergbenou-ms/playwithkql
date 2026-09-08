/**
 * Movement tuning, kept free of any Phaser import so it can be unit tested.
 *
 * These numbers are in world pixels with a 16px tile, so a jump apex of ~50px
 * is a little over three tiles.
 */

export const GRAVITY = 780;
export const RUN_SPEED = 118;
export const AIR_ACCEL = 900;
export const GROUND_ACCEL = 1500;
export const JUMP_VELOCITY = -280;
export const COYOTE_MS = 110;
export const BUFFER_MS = 140;
export const ENEMY_SPEED = 26;
export const MAX_FALL_SPEED = 460;

/**
 * Apex height in pixels for a given jump multiplier: v^2 / 2g.
 *
 * Used by the gate-clearance test — a character who can out-jump a locked gate
 * skips the KQL challenge entirely, which is the whole point of the game.
 */
export function jumpApex(multiplier = 1): number {
  const v = Math.abs(JUMP_VELOCITY) * multiplier;
  return (v * v) / (2 * GRAVITY);
}
