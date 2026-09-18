import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCase } from '../src/data/cases';
import { Hud } from '../src/ui/Hud';
import { MobilePauseMenu } from '../src/ui/MobilePauseMenu';
import { useStore } from '../src/state/store';

const caseDef = getCase('001', 'beginner');
const noop = () => {};
const actions = {
  onNotebook: noop, onReference: noop, onOptions: noop,
  onPause: noop, onQuit: noop, onResume: noop, onRespawn: noop,
};
let passed = 0;
function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    console.error(name, error);
    process.exitCode = 1;
  }
}

check('phone HUD has exactly one interactive menu action, not five persistent buttons', () => {
  const html = renderToStaticMarkup(<Hud {...actions} caseDef={caseDef} touchEnabled />);
  assert.equal(html.match(/<button\b/g)?.length, 1);
  assert.ok(html.includes('Pause (P)'));
  assert.ok(html.includes('hud-compact'));
  assert.ok(!html.includes('hud-rooms'));
  assert.ok(!html.includes('Abandon'));
});
check('compact HUD retains health and terminal progress', () => {
  const html = renderToStaticMarkup(<Hud {...actions} caseDef={caseDef} touchEnabled />);
  assert.ok(html.includes('Health '));
  assert.ok(html.includes('terminals solved'));
  assert.ok(html.includes(caseDef.title));
});
check('desktop retains its full HUD and destructive Abandon', () => {
  const html = renderToStaticMarkup(<Hud {...actions} caseDef={caseDef} />);
  assert.equal(html.match(/<button\b/g)?.length, 5);
  assert.ok(html.includes('hud-rooms'));
  assert.ok(html.includes('abandon-button'));
});
check('mobile pause menu keeps every secondary action reachable', () => {
  const html = renderToStaticMarkup(<MobilePauseMenu {...actions} caseDef={caseDef} />);
  for (const action of ['Resume game', 'Return to checkpoint', 'Notes (', 'KQL card', 'Options', 'Abandon']) {
    assert.ok(html.includes(action), action);
  }
  assert.equal(html.match(/<button\b/g)?.length, 6);
  assert.ok(html.indexOf('Resume game') < html.indexOf('Abandon'));
});
check('mission details begin collapsed but contain every room', () => {
  const html = renderToStaticMarkup(<MobilePauseMenu {...actions} caseDef={caseDef} />);
  assert.ok(html.includes('<details class="mobile-mission-details">'));
  for (const room of caseDef.level.rooms) assert.ok(html.includes(room.name));
});
check('rendering compact controls never mutates progress', () => {
  const before = JSON.stringify(useStore.getState().profile);
  renderToStaticMarkup(<MobilePauseMenu {...actions} caseDef={caseDef} />);
  renderToStaticMarkup(<Hud {...actions} caseDef={caseDef} touchEnabled />);
  assert.equal(JSON.stringify(useStore.getState().profile), before);
});
console.log(`${passed} compact UI checks passed.`);
