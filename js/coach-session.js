/**
 * Lifecycle decisions for an in-flight coach request, kept pure so they can be
 * tested without a DOM. Both exist because getting them wrong fails silently:
 * the panel empties, the button goes live again, and nothing reaches the
 * console for the user to report.
 */

/**
 * The note is about the move on screen, so only moving off that move is a
 * reason to cancel. Re-analysis or a seat becoming known leaves the request
 * still answering the question the user asked.
 */
export function shouldCancelCoachRequest({ busy, targetPly, ply }) {
  return Boolean(busy) && targetPly != null && targetPly !== ply;
}

/**
 * Keyed on what the note is actually about. The engine's analysis token is
 * deliberately absent: a background re-run does not change which move is being
 * explained, and folding it in here invalidated live requests.
 */
export function coachCacheKeyFor({ ply, seat }) {
  return `${ply}:${seat || '-'}`;
}
