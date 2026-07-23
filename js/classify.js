// Turning raw engine scores into the things a player actually wants to read:
// win percentage, accuracy, and a label for every move.

import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { isBookMove } from './book.js';

const MATE_CP = 10000;
const VALUES = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };
const NON_PAWN = { n: 3, b: 3.2, r: 5, q: 9, k: 0 };

// Great / Brilliant specials (base EP bands unchanged).
const GREAT_LOSING = 40;
const GREAT_WINNING = 60;
const ONLY_MOVE_GAP = 20;
const BRILLIANT_CP_MAX = 200;
const SAC_MIN = 3;

// Engine score -> centipawns from White's point of view.
export function toWhiteCp(line, sideToMove) {
  let cp;
  if (line.mate !== null && line.mate !== undefined) {
    cp = line.mate > 0 ? MATE_CP - Math.abs(line.mate) * 10 : -MATE_CP + Math.abs(line.mate) * 10;
  } else {
    cp = Math.max(-MATE_CP, Math.min(MATE_CP, line.cp));
  }
  return sideToMove === 'w' ? cp : -cp;
}

// Standard logistic mapping from centipawns to expected score, in percent.
export function winPct(cpWhite) {
  const c = Math.max(-1000, Math.min(1000, cpWhite));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function winPctFor(cpWhite, color) {
  const w = winPct(cpWhite);
  return color === 'w' ? w : 100 - w;
}

export function moveAccuracy(drop) {
  const a = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export function gameAccuracy(accs) {
  if (!accs.length) return null;
  const arith = accs.reduce((s, a) => s + a, 0) / accs.length;
  const harm = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return Math.max(0, Math.min(100, (arith + harm) / 2));
}

// Fitted so a ~76% game lands near 900 and a ~90% game near 1750.
export function estimateRating(acc) {
  if (acc == null) return null;
  return Math.max(100, Math.min(3000, Math.round(21.2 * Math.exp(0.049 * acc))));
}

function materialBalance(chess, color, table = VALUES) {
  const board = chess.board();
  let mine = 0, theirs = 0;
  for (const row of board) for (const sq of row) {
    if (!sq) continue;
    const v = table[sq.type] || 0;
    if (sq.color === color) mine += v; else theirs += v;
  }
  return mine - theirs;
}

function nonPawnBalance(chess, color) {
  return materialBalance(chess, color, NON_PAWN);
}

// Walk the engine's principal variation a few plies and find the worst
// material balance the mover has to accept. Used to spot real sacrifices.
function lowestMaterialInPv(fenAfter, pv, color, plies = 6, table = VALUES) {
  const c = new Chess(fenAfter);
  let low = materialBalance(c, color, table);
  for (let i = 0; i < Math.min(pv.length, plies); i++) {
    const uci = pv[i];
    try {
      const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
      if (!mv) break;
    } catch (_) { break; }
    low = Math.min(low, materialBalance(c, color, table));
  }
  return low;
}

function playUci(chess, uci) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
}

function isOutcomeSwing(wFrom, wTo) {
  return (wFrom < GREAT_LOSING && wTo >= GREAT_LOSING)
      || (wFrom < GREAT_WINNING && wTo >= GREAT_WINNING);
}

function isPieceSacrifice(beforeFen, afterFen, uci, pv, mover) {
  const c = new Chess(beforeFen);
  const matBefore = materialBalance(c, mover);
  const nonPawnBefore = nonPawnBalance(c, mover);
  try {
    if (!playUci(c, uci)) return false;
  } catch (_) { return false; }
  const immediateDrop = matBefore - materialBalance(c, mover);
  const immediateNonPawn = nonPawnBefore - nonPawnBalance(c, mover);
  if (immediateDrop >= SAC_MIN && immediateNonPawn >= SAC_MIN) return true;

  const low = lowestMaterialInPv(afterFen, pv, mover, 6, VALUES);
  const lowNonPawn = lowestMaterialInPv(afterFen, pv, mover, 6, NON_PAWN);
  return low <= matBefore - SAC_MIN && lowNonPawn <= nonPawnBefore - SAC_MIN;
}

/**
 * Classify one move.
 * ctx = {
 *   before: { fen, sideToMove, best (uci), lines[] },   // analysis of position before the move
 *   after:  { fen, lines[] },                            // analysis of position after the move
 *   uci, san, sansSoFar,
 *   wBeforePrev?, hasPrev?                              // prior same-colour wBefore (2-ply Great)
 * }
 */
export function classifyMove(ctx) {
  const { before, after, uci, sansSoFar, wBeforePrev, hasPrev } = ctx;
  const mover = before.sideToMove;

  const cpBefore = before.lines.length ? toWhiteCp(before.lines[0], mover) : 0;
  const cpAfter = after.lines.length
    ? toWhiteCp(after.lines[0], mover === 'w' ? 'b' : 'w')
    : (after.terminalCp ?? cpBefore);

  const wBefore = winPctFor(cpBefore, mover);
  const wAfter = winPctFor(cpAfter, mover);
  const drop = Math.max(0, wBefore - wAfter);
  const accuracy = moveAccuracy(drop);
  const moverCp = mover === 'w' ? cpBefore : -cpBefore;

  const isBest = before.best && uci === before.best;

  // Second-best line, for "only move" detection.
  let gap = 0;
  let wSecond = 100;
  if (before.lines.length > 1) {
    const w1 = winPctFor(toWhiteCp(before.lines[0], mover), mover);
    wSecond = winPctFor(toWhiteCp(before.lines[1], mover), mover);
    gap = w1 - wSecond;
  }

  const book = isBookMove(sansSoFar);

  let cls;
  if (book) cls = 'book';
  else if (isBest || drop < 0.5) cls = 'best';
  else if (drop < 2) cls = 'excellent';
  else if (drop < 5) cls = 'good';
  else if (drop < 10) cls = 'inaccuracy';
  else if (drop < 20) cls = 'mistake';
  else cls = 'blunder';

  // A missed knockout: you were clearly winning and let it slip.
  if (!book && drop >= 10) {
    const hadMate = before.lines[0] && before.lines[0].mate > 0;
    const stillMate = after.lines[0] && toWhiteCp(after.lines[0], mover === 'w' ? 'b' : 'w') !== null
      && Math.abs(cpAfter) > 9000 && winPctFor(cpAfter, mover) > 90;
    if ((hadMate && !stillMate) || (wBefore >= 75 && wAfter <= 55)) cls = 'miss';
  }

  // Great: outcome swing (incl. 2-ply capitalisation) or strict only-move.
  let sacrifice = false;
  if (!book && (isBest || drop < 1)) {
    const swingNow = drop <= 2 && isOutcomeSwing(wBefore, wAfter);
    const swingPrev = hasPrev && drop <= 2 && isOutcomeSwing(wBeforePrev, wAfter);
    const onlyMove = gap >= ONLY_MOVE_GAP && wSecond < GREAT_LOSING && Math.abs(cpBefore) < 900;
    if (swingNow || swingPrev || onlyMove) cls = 'great';
  }

  // Brilliant: best-only sound piece sac, not already winning, position holds.
  if (!book && isBest && wAfter >= wBefore - 0.5 && moverCp < BRILLIANT_CP_MAX) {
    const pv = after.lines[0] ? after.lines[0].pv : [];
    if (isPieceSacrifice(before.fen, after.fen, uci, pv, mover)) {
      sacrifice = true;
      cls = 'brilliant';
    }
  }

  return { cls, cpBefore, cpAfter, wBefore, wAfter, drop, accuracy, gap, isBest, book, sacrifice,
           bestUci: before.best, bestPv: before.lines[0] ? before.lines[0].pv : [] };
}
