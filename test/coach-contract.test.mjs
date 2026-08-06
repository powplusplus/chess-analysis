import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicCoachFallback, parseCoachResponse, renderCoachResponse, validateCoachResponse } from '../js/coach-contract.js';

const facts = {
  played_move: 'Nf3', engine_class: 'Good', eval_before: 0.2, eval_after: -0.4,
  best_move: 'd4', best_pv: ['d4', 'd5'], opening: "Queen's Pawn Game",
  win_before: 52.1, win_after: 44.7, win_drop: 7.4,
  fen_before: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1', fen_after: '4k3/8/8/8/8/5N2/8/4K3 b - - 1 1',
};

const overviewFacts = {
  opening: 'Ruy Lopez: Morphy Defense', total_plies: 60,
  result: 'You won by checkmate',
  your_accuracy: '84.2', opponent_accuracy: '71.0',
  your_rating: 1420, opponent_rating: 1050,
  tallies: 'Yours (White): 1 Brilliant, 2 Best; Opponent: 3 Blunder',
  critical_moments: ['You · 14. Nxe5 = Brilliant (eval 2.1)', 'Opponent · 21... Qd7 = Blunder (eval 5.4)'],
  move_line: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6',
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

test('a game overview can be built from supplied game-level facts', () => {
  const response = {
    items: [
      { type: 'result', refs: ['result'], text: overviewFacts.result },
      { type: 'accuracy', refs: ['your_accuracy', 'opponent_accuracy'], yours: '84.2', opponent: '71.0' },
      { type: 'tally', refs: ['tallies'], text: overviewFacts.tallies },
      { type: 'critical_moment', refs: ['critical_moments'], line: overviewFacts.critical_moments[1] },
    ],
    note: 'You converted this one cleanly. Your play stayed sharp in the middlegame, and the win came from punishing a loose queen move rather than from any deep preparation.\n\nKeep doing what you did around move 14: when a piece hangs, look for the forcing capture before settling for a quiet developing move.',
  };
  const result = validateCoachResponse(response, overviewFacts);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  const rendered = renderCoachResponse(response);
  assert.match(rendered, /Result: You won by checkmate\./);
  assert.match(rendered, /Your accuracy was 84\.2/);
  assert.match(rendered, /Critical moment: Opponent: 21\.\.\. Qd7 was Blunder/);
  assert.match(rendered, /punishing a loose queen move/);
});

test('an overview that supplies no game facts still yields a usable fallback', () => {
  const fallback = deterministicCoachFallback(overviewFacts);
  assert.match(fallback, /You won by checkmate/);
  assert.match(fallback, /84\.2/);
  assert.match(fallback, /Ruy Lopez: Morphy Defense/);
  assert.doesNotMatch(fallback, /no verified coach explanation/);
});

test('the note may not name a move or a number the analysis did not supply', () => {
  const cases = [
    { note: 'You should have played Qh5 to win the queen.', pattern: /names move Qh5/ },
    { note: 'That swing was worth 12.5 pawns of material.', pattern: /states 12\.5/ },
    { note: 'A clean game — worth repeating.', pattern: /em dashes/ },
    { note: '   ', pattern: /non-empty string/ },
  ];
  for (const { note, pattern } of cases) {
    const response = { items: [{ type: 'result', refs: ['result'], text: overviewFacts.result }], note };
    const result = validateCoachResponse(response, overviewFacts);
    assert.equal(result.ok, false, `expected rejection for: ${note}`);
    assert.ok(result.errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(result.errors)}`);
  }
});

test('the note may reuse supplied moves, figures and move numbers', () => {
  const response = {
    items: [{ type: 'alternative', refs: ['played_move', 'best_move'], played: 'Nf3', best: 'd4' }],
    note: 'Nf3 is fine, but d4 grabs the centre at once. Losing 7.4 percent of your winning chances on a developing move is the kind of small leak worth plugging.',
  };
  assert.deepEqual(validateCoachResponse(response, facts).errors, []);
});

test('a fenced JSON reply is still parsed', () => {
  const response = { items: [{ type: 'assessment', refs: ['played_move', 'engine_class'], move: 'Nf3', classification: 'Good' }] };
  const parsed = parseCoachResponse('```json\n' + JSON.stringify(response) + '\n```');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.value, response);
});
