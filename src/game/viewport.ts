import {
  CAMERA_ZOOM, GAME_HEIGHT, GAME_WIDTH, MAX_BACKING_HEIGHT, MAX_BACKING_WIDTH,
  OVERVIEW_LABEL_CSS_HEIGHT, OVERVIEW_MAX_CSS_HEIGHT, OVERVIEW_MIN_CSS_HEIGHT,
  OVERVIEW_MIN_WIDTH_RATIO, PORTRAIT_MAX_WORLD_HEIGHT, PORTRAIT_MIN_WORLD_WIDTH,
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
  overview: CameraView | null;
  /** Logical label strip at the canvas top, immediately above the overview. */
  labelHeight: number;
  baseZoom: number;
}

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

function camera(width: number, height: number, zoom: number, y = 0): CameraView {
  const view = { x: 0, y, width, height, zoom, worldWidth: width / zoom, worldHeight: height / zoom };
  for (const key of ['width', 'height', 'zoom', 'worldWidth', 'worldHeight'] as const) {
    positive(`camera.${key}`, view[key]);
  }
  return view;
}

/**
 * Pure CSS-first geometry: main at the bottom, optional label/overview above.
 * Portrait keeps 224 world pixels across and at most 208 vertically. Surplus
 * host height is excluded, not rendered as fake sky. Overview sees the actual
 * level height and is omitted unless its CSS size, width ratio and bounds fit.
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
): ViewportLayout {
  for (const [name, value] of Object.entries({ hostWidth, hostHeight, levelWidth, levelHeight })) {
    positive(name, value);
  }
  const mode = !mobile ? 'desktop' : hostWidth < hostHeight ? 'portrait' : 'landscape';
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
      overview: null, labelHeight: 0, baseZoom: CAMERA_ZOOM,
    };
  }

  let cssWidth = hostWidth;
  let mainCssHeight = hostHeight;
  let overviewCssHeight = 0;
  if (mode === 'portrait') {
    mainCssHeight = Math.min(hostHeight, hostWidth * (PORTRAIT_MAX_WORLD_HEIGHT / PORTRAIT_MIN_WORLD_WIDTH));
    // Full-level vertical FOV fixes overview width once its CSS height is known.
    const maxOverview = Math.min(
      hostHeight - mainCssHeight - OVERVIEW_LABEL_CSS_HEIGHT,
      OVERVIEW_MAX_CSS_HEIGHT,
      hostWidth * (levelHeight / (PORTRAIT_MIN_WORLD_WIDTH * OVERVIEW_MIN_WIDTH_RATIO)),
    );
    const minOverview = Math.max(OVERVIEW_MIN_CSS_HEIGHT, hostWidth * (levelHeight / levelWidth));
    if (maxOverview >= minOverview) overviewCssHeight = maxOverview;
  } else {
    cssWidth = Math.min(hostWidth, (levelWidth / VIEW_HEIGHT) * hostHeight);
  }
  const labelCssHeight = overviewCssHeight > 0 ? OVERVIEW_LABEL_CSS_HEIGHT : 0;
  const cssHeight = mainCssHeight + labelCssHeight + overviewCssHeight;
  positive('cssWidth', cssWidth);
  positive('cssHeight', cssHeight);

  // One scale for both axes; no DPR and no independent rounding or stretching.
  const width = Math.min(MAX_BACKING_WIDTH, MAX_BACKING_HEIGHT * (cssWidth / cssHeight));
  const backingScale = width / cssWidth;
  const height = cssHeight * backingScale;
  positive('backingScale', backingScale);
  positive('height', height);
  const labelHeight = labelCssHeight * backingScale;
  const overviewHeight = overviewCssHeight * backingScale;
  const mainY = labelHeight + overviewHeight;
  const mainHeight = height - mainY;
  const mainZoom = mode === 'portrait' ? width / PORTRAIT_MIN_WORLD_WIDTH : mainHeight / VIEW_HEIGHT;
  const main = camera(width, mainHeight, mainZoom, mainY);
  const overview = overviewCssHeight > 0
    ? camera(width, overviewHeight, overviewHeight / levelHeight, labelHeight)
    : null;
  return {
    mobile, mode, width, height, cssWidth, cssHeight,
    unusedCssHeight: Math.max(0, hostHeight - cssHeight),
    main, overview, labelHeight, baseZoom: main.zoom,
  };
}
