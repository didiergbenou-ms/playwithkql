/**
 * Render configuration, shared by the React host and the Phaser scene.
 *
 * The canvas renders at 640x360 and is upscaled by CSS with
 * image-rendering: pixelated. The camera then zooms 2x, so only 320x180 world
 * pixels — 20 x 11 tiles — are visible. That is roughly an NES field of view,
 * which keeps the character large on screen.
 *
 * Both the canvas scale and the camera zoom are integers, so pixels stay
 * perfectly square at every step.
 */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;
export const CAMERA_ZOOM = 2;

/** Visible world size after zoom. */
export const VIEW_WIDTH = GAME_WIDTH / CAMERA_ZOOM;
export const VIEW_HEIGHT = GAME_HEIGHT / CAMERA_ZOOM;
