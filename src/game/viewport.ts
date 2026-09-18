import {
  CAMERA_ZOOM, GAME_HEIGHT, GAME_WIDTH, MAX_BACKING_HEIGHT, MAX_BACKING_WIDTH,
  PORTRAIT_MAX_WORLD_HEIGHT, PORTRAIT_MIN_WORLD_WIDTH,
  VIEW_HEIGHT, VIEW_WIDTH,
} from './config';

/** Viewport coordinates are logical backing pixels; world dimensions are after zoom. */
export interface CameraView {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  worldWidth: number;
  worldHeight: number;
}

export interface ViewportLayout {
  mobile: boolean;
  mode: 'desktop' | 'portrait' | 'landscape';
  width: number;
  height: number;
  /** Actual uniformly FIT-scaled canvas, not the host allocation. */
  cssWidth: number;
  cssHeight: number;
  unusedCssHeight: number;
  main: CameraView;
  baseZoom: number;
}

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

function camera(width: number, height: number, zoom: number): CameraView {
  const view = { x: 0, y: 0, width, height, zoom, worldWidth: width / zoom, worldHeight: height / zoom };
  for (const key of ['width', 'height', 'zoom', 'worldWidth', 'worldHeight'] as const) {
    positive(`camera.${key}`, view[key]);
  }
  return view;
}

/**
 * Pure CSS-first geometry for a single main camera.
 * Portrait keeps 288 world pixels across and at most 208 vertically. Surplus
 * host height is excluded, not rendered as fake sky.
 * Landscape keeps 180 world pixels vertically, trading unused host width for
 * level bounds on ultra-wide hosts. Square mobile hosts use landscape.
 * Throws for invalid dimensions, levels below the mode's minimum FOV, or
 * dimensions too extreme to represent with finite positive JS geometry.
 */
export function chooseViews(
  hostWidth: number,
  hostHeight: number,
  mobile: boolean,
  levelWidth = 2944,
  levelHeight = 208,
  orientation?: 'portrait' | 'landscape',
): ViewportLayout {
  for (const [name, value] of Object.entries({ hostWidth, hostHeight, levelWidth, levelHeight })) {
    positive(name, value);
  }
  const mode = !mobile ? 'desktop' : orientation ?? (hostWidth < hostHeight ? 'portrait' : 'landscape');
  const minWorldWidth = mode === 'desktop' ? VIEW_WIDTH
    : mode === 'portrait' ? PORTRAIT_MIN_WORLD_WIDTH : VIEW_HEIGHT;
  const minWorldHeight = mode === 'portrait' ? PORTRAIT_MAX_WORLD_HEIGHT : VIEW_HEIGHT;
  if (levelWidth < minWorldWidth || levelHeight < minWorldHeight) {
    throw new RangeError(`${mode} requires a level of at least ${minWorldWidth}x${minWorldHeight}`);
  }

  if (mode === 'desktop') {
    const scale = Math.min(hostWidth / GAME_WIDTH, hostHeight / GAME_HEIGHT);
    const cssWidth = GAME_WIDTH * scale;
    const cssHeight = GAME_HEIGHT * scale;
    positive('cssWidth', cssWidth);
    positive('cssHeight', cssHeight);
    return {
      mobile, mode, width: GAME_WIDTH, height: GAME_HEIGHT, cssWidth, cssHeight,
      unusedCssHeight: Math.max(0, hostHeight - cssHeight),
      main: camera(GAME_WIDTH, GAME_HEIGHT, CAMERA_ZOOM),
      baseZoom: CAMERA_ZOOM,
    };
  }

  let cssWidth = hostWidth;
  let cssHeight = hostHeight;
  if (mode === 'portrait') {
    cssHeight = Math.min(hostHeight, hostWidth * (PORTRAIT_MAX_WORLD_HEIGHT / PORTRAIT_MIN_WORLD_WIDTH));
  } else {
    cssWidth = Math.min(hostWidth, (levelWidth / VIEW_HEIGHT) * hostHeight);
  }
  positive('cssWidth', cssWidth);
  positive('cssHeight', cssHeight);

  // One scale for both axes; no DPR and no independent rounding or stretching.
  const width = Math.min(MAX_BACKING_WIDTH, MAX_BACKING_HEIGHT * (cssWidth / cssHeight));
  const backingScale = width / cssWidth;
  const height = cssHeight * backingScale;
  positive('backingScale', backingScale);
  positive('height', height);
  const mainZoom = mode === 'portrait' ? width / PORTRAIT_MIN_WORLD_WIDTH : height / VIEW_HEIGHT;
  const main = camera(width, height, mainZoom);
  return {
    mobile, mode, width, height, cssWidth, cssHeight,
    unusedCssHeight: Math.max(0, hostHeight - cssHeight),
    main, baseZoom: main.zoom,
  };
}
