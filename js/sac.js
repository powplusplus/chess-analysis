// Static-exchange evaluation and sacrifice detection.
//
// A brilliant move (chess.com's "!!") is a *sound sacrifice*: it leaves real
// material where the opponent could win it, yet the position stays good. The
// key subtlety is that the opponent usually should DECLINE — so we can't just
// walk the engine's best line and check whether it grabs the piece back. We
// have to ask, statically, "if the opponent took the offered material, would
// they come out ahead?" That's a static exchange evaluation (SEE).
//
// The `Chess` constructor is injected rather than imported so this module runs
// unchanged under Node tests (classify.js gets chess.js from a CDN URL).

export const SAC_VALUES = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

const val = (type, values) => values[type] || 0;

/**
 * Net material the side to move wins by initiating captures on `square`,
 * both sides recapturing with their least valuable attacker. Never negative:
 * a side that would lose material simply declines to capture.
 */
export function see(Chess, fen, square, values = SAC_VALUES) {
  let chess;
  try { chess = new Chess(fen); } catch (_) { return 0; }
  const caps = chess.moves({ verbose: true })
    .filter(m => m.to === square && m.captured);
  if (!caps.length) return 0;

  // Least valuable attacker captures first.
  caps.sort((a, b) => val(a.piece, values) - val(b.piece, values));
  const cap = caps[0];
  const captured = val(cap.captured, values);

  let next;
  try {
    next = new Chess(fen);
    next.move({ from: cap.from, to: cap.to, promotion: cap.promotion || 'q' });
  } catch (_) { return 0; }

  return Math.max(0, captured - see(Chess, next.fen(), square, values));
}

/**
 * Largest SEE gain the side NOT owning `ownerColor` can realise by capturing
 * one of `ownerColor`'s pieces in `fen`. `fen` must have the opponent to move.
 * Zero when nothing is hanging (every capture loses material for them).
 */
export function maxHangingCapture(Chess, fen, ownerColor, values = SAC_VALUES) {
  let chess;
  try { chess = new Chess(fen); } catch (_) { return 0; }
  const opp = ownerColor === 'w' ? 'b' : 'w';
  if (chess.turn() !== opp) return 0;

  let best = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== ownerColor) continue;
      const g = see(Chess, fen, cell.square, values);
      if (g > best) best = g;
    }
  }
  return best;
}

// Same FEN, opposite side to move, en-passant cleared — a "null move" used to
// measure material that was already hanging before the mover played.
function flipSideToMove(fen, color) {
  const parts = fen.split(' ');
  parts[1] = color;
  parts[3] = '-';
  return parts.join(' ');
}

/**
 * True when `mover`'s move offers material: afterwards the opponent could win
 * at least `minSee` by capturing one of the mover's pieces, and it was THIS
 * move that put that material en prise.
 *
 * We judge this per-square rather than by a global material count, so an
 * unrelated piece that happens to be loose elsewhere can't mask (or fake) the
 * offer. The overwhelmingly common case — the piece you just moved is now
 * hanging (Bxg6, a queen check next to the king, …) — is checked first; a
 * secondary pass catches deflection / clearance sacrifices where a *different*
 * piece is freshly exposed by the move.
 */
export function moveCreatesSacrifice(Chess, beforeFen, afterFen, uci, mover, minSee, values = SAC_VALUES) {
  let after;
  try { after = new Chess(afterFen); } catch (_) { return false; }
  const opp = mover === 'w' ? 'b' : 'w';
  if (after.turn() !== opp) return false;

  const to = uci.slice(2, 4);

  // (a) The piece that just moved is left en prise — a direct offer.
  if (see(Chess, afterFen, to, values) >= minSee) return true;

  // (b) A different own piece was newly exposed by the move. Ignore pieces
  //     that were already loose before we moved (nothing to do with this move).
  let beforeFlipped = null;
  try { beforeFlipped = flipSideToMove(beforeFen, opp); } catch (_) { beforeFlipped = null; }

  for (const row of after.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== mover || cell.square === to) continue;
      if (see(Chess, afterFen, cell.square, values) < minSee) continue;
      const wasLoose = beforeFlipped
        ? see(Chess, beforeFlipped, cell.square, values) >= minSee
        : false;
      if (!wasLoose) return true;
    }
  }
  return false;
}
