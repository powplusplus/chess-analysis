import assert from 'node:assert/strict';
import test from 'node:test';
import { coachCacheKeyFor, shouldCancelCoachRequest } from '../js/coach-session.js';

test('moving to another move cancels the request it is no longer about', () => {
  assert.equal(shouldCancelCoachRequest({ busy: true, targetPly: 31, ply: 32 }), true);
  assert.equal(shouldCancelCoachRequest({ busy: true, targetPly: 31, ply: 0 }), true);
});

test('a request is never cancelled while the user sits on the same move', () => {
  // The regression: analysis finishing or a seat resolving used to move the
  // cache key, which cancelled the request and emptied the panel in silence.
  assert.equal(shouldCancelCoachRequest({ busy: true, targetPly: 31, ply: 31 }), false);
  assert.equal(shouldCancelCoachRequest({ busy: false, targetPly: 31, ply: 99 }), false);
  assert.equal(shouldCancelCoachRequest({ busy: true, targetPly: null, ply: 31 }), false);
});

test('ply 0 is a real target, not a missing one', () => {
  // targetPly 0 is the game overview. A truthiness check here would make the
  // overview uncancellable, so it must be compared against null explicitly.
  assert.equal(shouldCancelCoachRequest({ busy: true, targetPly: 0, ply: 4 }), true);
  assert.equal(shouldCancelCoachRequest({ busy: true, targetPly: 0, ply: 0 }), false);
});

test('the cache key tracks the move and seat, and nothing else', () => {
  assert.equal(coachCacheKeyFor({ ply: 31, seat: 'w' }), '31:w');
  assert.equal(coachCacheKeyFor({ ply: 0, seat: 'b' }), '0:b');
  assert.equal(coachCacheKeyFor({ ply: 12, seat: null }), '12:-');
  // Same move, same seat, different engine run: still the same note.
  assert.equal(coachCacheKeyFor({ ply: 31, seat: 'w' }), coachCacheKeyFor({ ply: 31, seat: 'w' }));
  assert.notEqual(coachCacheKeyFor({ ply: 31, seat: 'w' }), coachCacheKeyFor({ ply: 31, seat: 'b' }));
});
