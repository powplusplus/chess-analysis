import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const animationSource = source.slice(
  source.indexOf('function animatePlyChange('),
  source.indexOf('\nfunction drawArrow(', source.indexOf('function animatePlyChange(')),
);

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.innerHTML = '';
    this.style = {};
    this.removed = false;
    this.listeners = new Map();
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  getBoundingClientRect() { return { width: 80 }; }
  dispatch(type) { this.listeners.get(type)?.(); }
  remove() { this.removed = true; }
}

function harness({ move, before, after, fromPly, flipped = false, reduced = false }) {
  const flyers = [];
  const snapshots = [];
  const state = {
    moves: fromPly === 0 ? [move] : Array.from({ length: fromPly }, (_, i) => i === fromPly - 1 ? move : {}),
    ply: fromPly,
    flipped,
    animCancel: null,
    animating: false,
  };
  const document = {
    body: { appendChild(el) { flyers.push(el); } },
    createElement(tag) { return new FakeElement(tag); },
  };
  const window = { matchMedia: () => ({ matches: reduced }) };
  let painted = new Map();
  const renderBoard = ({ skipPiecesOn = [] } = {}) => {
    const raw = state.ply === 0 ? before : after;
    painted = new Map([...raw].filter(([square]) => !skipPiecesOn.includes(square)));
    snapshots.push({ ply: state.ply, hidden: [...skipPiecesOn], board: new Map(painted) });
  };
  const sqCenter = square => {
    let file = square.charCodeAt(0) - 97;
    let rank = 8 - Number(square[1]);
    if (state.flipped) { file = 7 - file; rank = 7 - rank; }
    return { x: file * 80 + 40, y: rank * 80 + 40, size: 80 };
  };
  const pieceSvg = (color, piece) => `<svg data-piece="${color}${piece}"></svg>`;
  const factory = new Function(
    'state', 'window', 'document', 'renderBoard', 'sqCenter', 'pieceSvg', 'ANIM_MS',
    `${animationSource}; return { animatePlyChange, cancelPieceAnim };`,
  );
  const api = factory(state, window, document, renderBoard, sqCenter, pieceSvg, 160);
  const finalRender = toPly => { state.ply = toPly; renderBoard(); };
  return { ...api, state, flyers, snapshots, get painted() { return painted; }, finalRender };
}

const cases = [
  {
    name: 'ordinary capture',
    move: { from: 'e4', to: 'd5', color: 'w', piece: 'p' },
    before: new Map([['e4', 'wp'], ['d5', 'bp']]), after: new Map([['d5', 'wp']]),
  },
  {
    name: 'castling',
    move: { from: 'e1', to: 'g1', color: 'w', piece: 'k' },
    before: new Map([['e1', 'wk'], ['h1', 'wr']]), after: new Map([['g1', 'wk'], ['f1', 'wr']]),
  },
  {
    name: 'promotion',
    move: { from: 'a7', to: 'a8', color: 'w', piece: 'p' },
    before: new Map([['a7', 'wp']]), after: new Map([['a8', 'wq']]),
  },
  {
    name: 'en passant',
    move: { from: 'e5', to: 'd6', color: 'w', piece: 'p' },
    before: new Map([['e5', 'wp'], ['d5', 'bp']]), after: new Map([['d6', 'wp']]),
  },
];

for (const scenario of cases) {
  test(`${scenario.name}: forward and backward snapshots animate in their own direction`, async () => {
    const forward = harness({ ...scenario, fromPly: 0 });
    const forwardDone = forward.animatePlyChange(0, 1);
    assert.equal(forward.snapshots[0].ply, 0, 'forward snapshot uses the before ply');
    assert.deepEqual(forward.snapshots[0].hidden, [scenario.move.from]);
    assert.match(forward.flyers[0].innerHTML, new RegExp(`data-piece="${scenario.move.color}${scenario.move.piece}"`));
    const forwardTransform = forward.flyers[0].style.transform;
    const expectedForwardX = (scenario.move.to.charCodeAt(0) - scenario.move.from.charCodeAt(0)) * 80;
    const expectedForwardY = (Number(scenario.move.from[1]) - Number(scenario.move.to[1])) * 80;
    assert.equal(forwardTransform, `translate(${expectedForwardX}px, ${expectedForwardY}px)`);
    forward.flyers[0].dispatch('transitionend');
    await forwardDone;
    forward.finalRender(1);
    assert.deepEqual(forward.painted, scenario.after);

    const backward = harness({ ...scenario, fromPly: 1 });
    const backwardDone = backward.animatePlyChange(1, 0);
    assert.equal(backward.snapshots[0].ply, 1, 'backward snapshot keeps the current after ply');
    assert.deepEqual(backward.snapshots[0].hidden, [scenario.move.to]);
    assert.equal(backward.flyers[0].style.transform, `translate(${-expectedForwardX}px, ${-expectedForwardY}px)`);
    if (scenario.name === 'ordinary capture') assert.equal(backward.snapshots[0].board.has('d5'), false, 'capture is not restored mid-flight');
    backward.flyers[0].dispatch('transitionend');
    await backwardDone;
    backward.finalRender(0);
    assert.deepEqual(backward.painted, scenario.before, 'final render restores the complete before-position');
  });
}

test('flipped board reverses flyer geometry without changing chess squares', async () => {
  const scenario = cases[0];
  const h = harness({ ...scenario, fromPly: 0, flipped: true });
  const done = h.animatePlyChange(0, 1);
  assert.deepEqual(h.snapshots[0].hidden, ['e4']);
  assert.equal(h.flyers[0].style.transform, 'translate(80px, 80px)');
  h.flyers[0].dispatch('transitionend');
  await done;
});

test('reduced motion skips the snapshot and flyer so the caller can render immediately', async () => {
  const scenario = cases[0];
  const h = harness({ ...scenario, fromPly: 1, reduced: true });
  await h.animatePlyChange(1, 0);
  assert.equal(h.snapshots.length, 0);
  assert.equal(h.flyers.length, 0);
  h.finalRender(0);
  assert.deepEqual(h.painted, scenario.before);
});

test('animation cancellation settles an in-flight flyer for rapid navigation and autoplay stop', async () => {
  const scenario = cases[0];
  const h = harness({ ...scenario, fromPly: 0 });
  const done = h.animatePlyChange(0, 1);
  h.state.animating = true;
  h.cancelPieceAnim();
  await done;
  assert.equal(h.flyers[0].removed, true);
  assert.equal(h.state.animCancel, null);
  assert.equal(h.state.animating, false);
});
