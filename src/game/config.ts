/**
 * Render configuration, shared by the React host and the Phaser scene.
 *
 * Desktop invariants: 640x360 backing, 2x camera zoom, 320x180 world FOV.
 * CSS FIT scales both axes uniformly (not necessarily by an integer).
 * Mobile uses bounded logical backing dimensions, independent of device DPR;
 * viewport.ts allocates useful camera content before choosing that same scale.
 */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;
export const CAMERA_ZOOM = 2;

/** Desktop visible world size after zoom. */
export const VIEW_WIDTH = GAME_WIDTH / CAMERA_ZOOM;
export const VIEW_HEIGHT = GAME_HEIGHT / CAMERA_ZOOM;

export const PORTRAIT_MIN_WORLD_WIDTH = 224;
export const PORTRAIT_MAX_WORLD_HEIGHT = 208;
export const MAX_BACKING_WIDTH = 640;
export const MAX_BACKING_HEIGHT = 1400;
export const OVERVIEW_MIN_CSS_HEIGHT = 64;
export const OVERVIEW_MAX_CSS_HEIGHT = 160;
export const OVERVIEW_LABEL_CSS_HEIGHT = 16;
export const OVERVIEW_MIN_WIDTH_RATIO = 1.5;
/** Optional horizontal camera-follow offset in world pixels. */
export const CAMERA_LOOKAHEAD = 24;
