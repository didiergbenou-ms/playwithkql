import assert from 'node:assert/strict';
import { prefersTouchControls } from '../src/ui/inputMode';

const keyboard = { coarse: false, fine: true, hover: true };
const phone = { coarse: true, fine: false, hover: false };
const pen = { coarse: false, fine: true, hover: false };
const ambiguous = { coarse: true, fine: true, hover: true };
let passed = 0;
function check(name: string, test: () => void) {
  try { test(); passed++; }
  catch (error) { console.error(name, error); process.exitCode = 1; }
}
check('mouse and touch-capable laptops keep their primary fine-pointer UI', () => {
  assert.equal(prefersTouchControls('auto', keyboard), false);
  assert.equal(prefersTouchControls('auto', ambiguous), false);
});
check('phones and touch-primary tablets choose touch independently of resolution', () => {
  assert.equal(prefersTouchControls('auto', phone), true);
  assert.equal(prefersTouchControls('auto', { ...phone, hover: true }), true);
});
check('fine pen input does not masquerade as a phone', () => {
  assert.equal(prefersTouchControls('auto', pen), false);
});
check('no pointer defaults to keyboard-accessible controls', () => {
  assert.equal(prefersTouchControls('auto', { coarse: false, fine: false, hover: false }), false);
});
check('manual touch override is available on hybrid desktops', () => {
  assert.equal(prefersTouchControls('touch', keyboard), true);
  assert.equal(prefersTouchControls('touch', phone), true);
});
check('manual keyboard override is available with a connected phone keyboard', () => {
  assert.equal(prefersTouchControls('keyboard', phone), false);
  assert.equal(prefersTouchControls('keyboard', keyboard), false);
});
console.log(`${passed} input-mode checks passed.`);
