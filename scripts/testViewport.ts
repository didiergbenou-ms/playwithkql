import assert from 'node:assert/strict';
import {
  CAMERA_LOOKAHEAD, CAMERA_ZOOM, GAME_HEIGHT, GAME_WIDTH, MAX_BACKING_HEIGHT,
  MAX_BACKING_WIDTH, PORTRAIT_MAX_WORLD_HEIGHT,
  PORTRAIT_MIN_WORLD_WIDTH, VIEW_HEIGHT, VIEW_WIDTH,
} from '../src/game/config.ts';
import { chooseViews, type CameraView, type ViewportLayout } from '../src/game/viewport.ts';

let passed = 0;
const failures: string[] = [];
const epsilon = 1e-8;

function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function bounds(view: CameraView, layout: ViewportLayout, levelWidth: number, levelHeight: number) {
  for (const value of Object.values(view)) assert.ok(Number.isFinite(value));
  assert.ok(view.x >= 0 && view.y >= 0);
  assert.ok(view.width > 0 && view.height > 0 && view.zoom > 0);
  assert.ok(view.x + view.width <= layout.width + epsilon);
  assert.ok(view.y + view.height <= layout.height + epsilon);
  assert.ok(view.worldWidth <= levelWidth + epsilon);
  assert.ok(view.worldHeight <= levelHeight + epsilon);
  near(view.width / view.zoom, view.worldWidth);
  near(view.height / view.zoom, view.worldHeight);
}

function invariants(hostWidth: number, hostHeight: number, mobile: boolean, levelWidth = 2944, levelHeight = 208) {
  const layout = chooseViews(hostWidth, hostHeight, mobile, levelWidth, levelHeight);
  assert.deepEqual(layout, chooseViews(hostWidth, hostHeight, mobile, levelWidth, levelHeight));
  assert.deepEqual(Object.keys(layout).sort(), [
    'baseZoom', 'cssHeight', 'cssWidth', 'height', 'main', 'mobile', 'mode', 'unusedCssHeight', 'width',
  ]);
  assert.equal(layout.mobile, mobile);
  assert.equal(layout.mode, !mobile ? 'desktop' : hostWidth < hostHeight ? 'portrait' : 'landscape');
  for (const value of [layout.width, layout.height, layout.cssWidth, layout.cssHeight, layout.baseZoom]) {
    assert.ok(Number.isFinite(value) && value > 0);
  }
  assert.ok(layout.cssWidth <= hostWidth + epsilon && layout.cssHeight <= hostHeight + epsilon);
  assert.ok(layout.unusedCssHeight >= 0);
  near(layout.cssHeight + layout.unusedCssHeight, hostHeight);
  const cssScale = Math.min(hostWidth / layout.width, hostHeight / layout.height);
  near(layout.cssWidth, layout.width * cssScale);
  near(layout.cssHeight, layout.height * cssScale);
  near(layout.cssWidth / layout.width, layout.cssHeight / layout.height);
  assert.equal(layout.main.x, 0);
  assert.equal(layout.main.y, 0);
  assert.equal(layout.main.height, layout.height);
  near(layout.baseZoom, layout.main.zoom);
  near(layout.main.width, layout.width);
  bounds(layout.main, layout, levelWidth, levelHeight);
  if (mobile) {
    assert.ok(layout.width <= MAX_BACKING_WIDTH + epsilon);
    assert.ok(layout.height <= MAX_BACKING_HEIGHT + epsilon);
    if (layout.mode === 'portrait') {
      near(layout.main.worldWidth, PORTRAIT_MIN_WORLD_WIDTH);
      assert.ok(layout.main.worldHeight <= PORTRAIT_MAX_WORLD_HEIGHT + epsilon);
      near(layout.cssWidth, hostWidth);
      near(layout.cssHeight, Math.min(hostHeight, hostWidth * 208 / 288));
    } else {
      near(layout.main.worldHeight, VIEW_HEIGHT);
      near(layout.main.worldWidth, Math.min(levelWidth, hostWidth / hostHeight * VIEW_HEIGHT));
      near(layout.cssHeight, hostHeight);
    }
  }
  return layout;
}

check('desktop exports remain invariant', () => {
  assert.deepEqual([GAME_WIDTH, GAME_HEIGHT, CAMERA_ZOOM, VIEW_WIDTH, VIEW_HEIGHT], [640, 360, 2, 320, 180]);
  assert.equal(CAMERA_LOOKAHEAD, 24);
});

check('desktop always uses exact 640x360 / 2x geometry and uniform FIT', () => {
  for (const [w, h] of [[320, 568], [1920, 1080], [844, 320], [100, 10000], [10000, 10]]) {
    const layout = invariants(w, h, false);
    assert.deepEqual(layout.main, { x: 0, y: 0, width: 640, height: 360, zoom: 2, worldWidth: 320, worldHeight: 180 });
  }
  const fitted = chooseViews(320, 568, false);
  assert.deepEqual([fitted.cssWidth, fitted.cssHeight, fitted.unusedCssHeight], [320, 180, 388]);
});

check('requested portrait samples show 288x208 world pixels with actual fitted CSS height', () => {
  for (const [w, h, expectedHeight] of [
    [320, 568, 231.11111111111111],
    [393, 700, 283.8333333333333],
    [430, 844, 310.55555555555554],
  ]) {
    const layout = invariants(w, h, true);
    near(layout.cssHeight, expectedHeight);
    near(layout.cssWidth, w);
    near(layout.main.worldHeight, 208);
    near(layout.main.worldWidth, 288);
    near(layout.width, 640);
    near(layout.height, 462.22222222222223);
    near(layout.main.zoom, 640 / 288);
    near(layout.unusedCssHeight, h - expectedHeight);
  }
});

check('requested landscape samples use all available height and width', () => {
  for (const [w, h, expectedWorldWidth] of [[667, 300, 400.2], [844, 320, 474.75]]) {
    const layout = invariants(w, h, true);
    near(layout.cssWidth, w);
    near(layout.cssHeight, h);
    near(layout.main.worldWidth, expectedWorldWidth);
    near(layout.unusedCssHeight, 0);
  }
});

check('portrait widens visible world rather than enlarging sprites or backing', () => {
  const layout = invariants(320, 400, true);
  assert.equal(PORTRAIT_MIN_WORLD_WIDTH, 288);
  near(layout.main.worldWidth / 224, 9 / 7);
  assert.ok(layout.main.zoom < 640 / 224);
  near(layout.cssWidth / layout.main.worldWidth, layout.cssHeight / layout.main.worldHeight);
});

check('tiny portrait hosts retain uniform scale without minimum CSS allocation', () => {
  for (const [w, h, expectedHeight] of [[1, 2, 13 / 18], [0.125, 0.5, 13 / 144], [32, 64, 208 / 9]]) {
    const layout = invariants(w, h, true);
    near(layout.cssHeight, expectedHeight);
    near(layout.main.worldWidth, 288);
    near(layout.main.worldHeight, 208);
  }
});

check('portrait main-only keeps its FOV without stretching near square hosts', () => {
  const layout = invariants(393, 394, true);
  near(layout.cssHeight, 393 * 208 / 288);
  near(layout.main.worldHeight, 208);
  near(layout.main.worldWidth, 288);
});

check('collapsed portrait host keeps portrait FOV instead of switching to landscape', () => {
  const layout = chooseViews(377, 272, true, undefined, undefined, 'portrait');
  assert.equal(layout.mode, 'portrait');
  near(layout.main.worldWidth, 288);
  near(layout.cssHeight, 272);
  assert.ok(layout.main.worldHeight <= 208);
});

check('fractional portrait CSS dimensions are not independently rounded', () => {
  const layout = invariants(393.25, 700.75, true);
  near(layout.cssWidth, 393.25);
  near(layout.cssHeight, 284.0138888888889);
  near(layout.unusedCssHeight, 416.7361111111111);
  near(layout.main.worldWidth, 288);
  near(layout.main.worldHeight, 208);
});

check('portrait FOV stays fixed for all supported level bounds', () => {
  const normal = invariants(320, 568, true);
  for (const [width, height] of [[288, 208], [300, 208], [736, 300], [2944, 1000]]) {
    assert.deepEqual(invariants(320, 568, true, width, height), normal);
  }
});

check('ultra-tall hosts exclude empty sky from the backing aspect', () => {
  const tall = invariants(320, 1000000, true);
  const normal = chooseViews(320, 568, true);
  near(tall.width, normal.width);
  near(tall.height, normal.height);
  near(tall.cssHeight, normal.cssHeight);
  assert.deepEqual(tall.main, normal.main);
});

check('representable extreme portrait dimensions preserve useful world and bounded backing', () => {
  for (const [w, h] of [[1e-200, 1], [1e200, 1e201], [320, Number.MAX_VALUE]]) {
    const layout = invariants(w, h, true);
    near(layout.width, 640);
    near(layout.height, 640 * 208 / 288);
    near(layout.main.worldWidth, 288);
    near(layout.main.worldHeight, 208);
    near(layout.cssHeight / layout.cssWidth, 208 / 288);
  }
});

check('ultra-wide and ultra-short hosts cap width, not the 180-world-pixel height', () => {
  for (const [w, h] of [[100000, 100], [844, 1], [667, 10]]) {
    const layout = invariants(w, h, true);
    near(layout.main.worldWidth, 2944);
    near(layout.cssWidth, 2944 * h / 180);
    near(layout.cssHeight, h);
    assert.ok(layout.cssWidth < w);
  }
});

check('square and fractional mobile hosts are deterministic and bounded', () => {
  assert.equal(invariants(320, 320, true).mode, 'landscape');
  near(chooseViews(320, 320, true).main.worldWidth, 180);
  invariants(393.25, 700.75, true);
  invariants(844.75, 320.125, true);
});

check('all four dimension arguments reject nonpositive and nonfinite values', () => {
  for (const mobile of [false, true]) {
    for (const invalid of [NaN, Infinity, -Infinity, 0, -0, -1]) {
      for (let index = 0; index < 4; index++) {
        const dims = [320, 568, 2944, 208];
        dims[index] = invalid;
        assert.throws(() => chooseViews(dims[0], dims[1], mobile, dims[2], dims[3]), RangeError);
      }
    }
  }
});

check('levels too small for the selected FOV fail explicitly, with exact minimums accepted', () => {
  assert.throws(() => chooseViews(640, 360, false, 319, 208), RangeError);
  assert.throws(() => chooseViews(640, 360, false, 320, 179), RangeError);
  invariants(640, 360, false, 320, 180);
  assert.throws(() => chooseViews(320, 568, true, 287, 208), RangeError);
  assert.throws(() => chooseViews(320, 568, true, 2944, 207), RangeError);
  invariants(320, 568, true, 288, 208);
  assert.throws(() => chooseViews(667, 300, true, 179, 208), RangeError);
  assert.throws(() => chooseViews(667, 300, true, 2944, 179), RangeError);
  invariants(667, 300, true, 180, 180);
});

check('unrepresentable backing geometry fails rather than returning NaN or infinite zoom', () => {
  assert.throws(() => chooseViews(Number.MIN_VALUE, 568, false), RangeError);
  assert.throws(() => chooseViews(Number.MIN_VALUE, 568, true), RangeError);
});

check('deterministic grid covers single-camera bounds, FIT and backing occupancy', () => {
  for (const w of [0.125, 1, 32, 100, 160, 288, 320, 393.25, 430, 640, 844, 1400, 4096]) {
    for (const h of [1, 64, 180, 300, 320, 400, 568, 700, 844, 1400, 10000]) {
      invariants(w, h, true);
      invariants(w, h, false);
    }
  }
});

console.log(`${passed} viewport checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exitCode = 1;
}
