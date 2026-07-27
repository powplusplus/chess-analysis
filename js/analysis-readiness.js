/** Return whether coaching for one played move has all of its local inputs. */
export function moveAnalysisReady(state, ply) {
  if (!Number.isInteger(ply) || ply < 1 || ply > state.moves.length) return false;
  const before = ply - 1;
  return Boolean(
    state.results[before] && state.results[ply]
    && state.evals[before] && state.evals[ply]
    && state.reports[before]
  );
}

/** The overview is deliberately final-only; partial reports are never totalled. */
export function overviewAnalysisReady(state) {
  return state.moves.length > 0
    && state.reports.length === state.moves.length
    && state.reports.every(Boolean);
}

export function targetAnalysisReady(state, ply = state.ply) {
  return ply === 0 ? overviewAnalysisReady(state) : moveAnalysisReady(state, ply);
}

/** Put the selected move's before/after positions first, without duplicating work. */
export function priorityPositionIndexes(positionCount, ply, unavailable = new Set()) {
  const preferred = ply > 0 ? [ply - 1, ply] : [];
  const ordered = [...preferred, ...Array.from({ length: positionCount }, (_, i) => i)];
  return [...new Set(ordered)].filter(i => i >= 0 && i < positionCount && !unavailable.has(i));
}
