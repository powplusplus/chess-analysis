import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FACT_REFS } from '../js/coach-contract.js';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const makeCoachFacts = app.slice(app.indexOf('function makeCoachFacts'), app.indexOf('function overviewStats'));

/** Keys assigned in either facts object makeCoachFacts returns. */
function factKeys(source) {
  return [...source.matchAll(/^ {4,6}(\w+):/gm)].map(m => m[1]);
}

// Context the model reads but never cites by reference name.
const CONTEXT_ONLY = new Set(['total_plies', 'move_line']);

test('every fact the app supplies is one the contract can be asked to reference', () => {
  const keys = factKeys(makeCoachFacts);
  assert.ok(keys.length > 0, 'expected makeCoachFacts to build a facts object');
  for (const key of keys) {
    assert.ok(FACT_REFS.has(key) || CONTEXT_ONLY.has(key),
      `makeCoachFacts supplies "${key}", which no item type can reference`);
  }
});

test('the game overview supplies game-level facts, not just the opening', () => {
  const overview = makeCoachFacts.slice(0, makeCoachFacts.indexOf('const idx = state.ply - 1;'));
  // Regression guard: with only `opening` in scope no overview item type can
  // validate, so Analyze on the overview always fell through to the fallback.
  for (const key of ['result', 'your_accuracy', 'tallies', 'critical_moments']) {
    assert.match(overview, new RegExp(`\\b${key}:`), `overview facts must include ${key}`);
  }
});
