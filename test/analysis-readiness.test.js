import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveAnalysisReady, overviewAnalysisReady, targetAnalysisReady, priorityPositionIndexes,
} from '../js/analysis-readiness.js';

function fixture(n) {
  return {
    moves: Array.from({ length: n }, () => ({})),
    results: Array(n + 1).fill(null),
    evals: Array(n + 1).fill(null),
    reports: Array(n).fill(null),
    ply: 0,
  };
}

for (const ply of [1, 3, 5]) {
  test(`move readiness at ply ${ply} needs only its adjacent positions and report`, () => {
    const state = fixture(5);
    state.results[ply - 1] = {}; state.results[ply] = {};
    state.evals[ply - 1] = {}; state.evals[ply] = {};
    state.reports[ply - 1] = {};
    assert.equal(moveAnalysisReady(state, ply), true);
    assert.equal(targetAnalysisReady(state, ply), true);
    assert.equal(overviewAnalysisReady(state), false);
    state.evals[ply] = null;
    assert.equal(moveAnalysisReady(state, ply), false);
  });
}

test('navigation priority skips active/completed indexes and keeps adjacent work first', () => {
  assert.deepEqual(priorityPositionIndexes(7, 4, new Set([0, 4])), [3, 1, 2, 5, 6]);
  assert.deepEqual(priorityPositionIndexes(7, 1), [0, 1, 2, 3, 4, 5, 6]);
});

test('overview remains unavailable until every report is complete', () => {
  const state = fixture(3);
  state.reports[0] = {}; state.reports[1] = {};
  assert.equal(targetAnalysisReady(state, 0), false);
  state.reports[2] = {};
  assert.equal(targetAnalysisReady(state, 0), true);
});
