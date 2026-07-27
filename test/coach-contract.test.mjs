import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicCoachFallback, parseCoachResponse, renderCoachResponse, validateCoachResponse } from '../js/coach-contract.js';

const facts = {
  played_move: 'Nf3', engine_class: 'Good', eval_before: 0.2, eval_after: -0.4,
  best_move: 'd4', best_pv: ['d4', 'd5'], opening: "Queen's Pawn Game",
  win_before: 52.1, win_after: 44.7, win_drop: 7.4,
  fen_before: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1', fen_after: '4k3/8/8/8/8/5N2/8/4K3 b - - 1 1',
};

const adversarial = [
  { type: 'alternative', refs: ['played_move', 'best_move'], played: 'Nf3+', best: 'd4' },
  { type: 'variation', refs: ['best_pv'], moves: ['d4', 'dxc4'] },
  { type: 'alternative', refs: ['played_move', 'best_move'], played: 'Nxf7', best: 'd4' },
  { type: 'variation', refs: ['best_pv'], moves: ['Qh5#'] },
  { type: 'piece_square', refs: ['fen_after'], position: 'after', piece: 'white queen', square: 'h5' },
  { type: 'opening', refs: ['opening'], name: 'Sicilian Defense' },
  { type: 'evaluation', refs: ['eval_before', 'eval_after'], before: 9.2, after: -0.4 },
  { type: 'assessment', refs: ['played_move', 'engine_class'], move: 'Nf3', classification: 'Mate', prose: 'invented' },
  { type: 'evaluation', refs: ['eval_before', 'eval_after'], before: [0.2], after: -0.4 },
  { type: 'opening', refs: ['opening', 'played_move'], name: "Queen's Pawn Game" },
];

test('adversarial claims cannot reach rendering or speech gates', () => {
  const reached = { setCoachText: 0, speechQueue: 0 };
  for (const item of adversarial) {
    const result = validateCoachResponse({ items: [item] }, facts);
    if (result.ok) { reached.setCoachText++; reached.speechQueue++; renderCoachResponse({ items: [item] }); }
  }
  assert.deepEqual(reached, { setCoachText: 0, speechQueue: 0 });
  assert.match(deterministicCoachFallback(facts), /Nf3.*Good.*0.2.*-0.4.*d4/);
});

test('accepts and locally renders an exact referenced contract', () => {
  const response = { items: [{ type: 'assessment', refs: ['played_move', 'engine_class'], move: 'Nf3', classification: 'Good' }] };
  assert.equal(validateCoachResponse(response, facts).ok, true);
  assert.equal(renderCoachResponse(response), 'Nf3 was classified as Good.');
  assert.equal(parseCoachResponse(JSON.stringify(response)).errors.length, 0);
});
