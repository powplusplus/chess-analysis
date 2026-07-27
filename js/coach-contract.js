// The model may select facts and templates, but it never gets to write prose.
const ITEM_FIELDS = {
  assessment: ['type', 'refs', 'move', 'classification'],
  evaluation: ['type', 'refs', 'before', 'after'],
  percentage: ['type', 'refs', 'before', 'after', 'drop'],
  alternative: ['type', 'refs', 'played', 'best'],
  variation: ['type', 'refs', 'moves'],
  opening: ['type', 'refs', 'name'],
  piece_square: ['type', 'refs', 'position', 'piece', 'square'],
};

const FACT_REFS = new Set([
  'played_move', 'engine_class', 'eval_before', 'eval_after', 'best_move',
  'best_pv', 'reply_pv', 'opening', 'win_before', 'win_after', 'win_drop',
  'fen_before', 'fen_after',
]);

function sameNumber(a, b) {
  const scalar = value => typeof value === 'number' || typeof value === 'string';
  return scalar(a) && scalar(b) && Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    && Math.abs(Number(a) - Number(b)) < 0.0001;
}

function fenPiece(fen, square) {
  if (typeof fen !== 'string' || !/^[a-h][1-8]$/.test(square || '')) return null;
  const rows = fen.split(' ')[0]?.split('/');
  if (rows?.length !== 8) return null;
  const rank = 8 - Number(square[1]);
  let file = 0;
  for (const token of rows[rank]) {
    if (/\d/.test(token)) file += Number(token);
    else if (file++ === square.charCodeAt(0) - 97) return token;
  }
  return null;
}

const PIECES = {
  P: 'white pawn', N: 'white knight', B: 'white bishop', R: 'white rook', Q: 'white queen', K: 'white king',
  p: 'black pawn', n: 'black knight', b: 'black bishop', r: 'black rook', q: 'black queen', k: 'black king',
};

function exactRefs(item, needed, errors, i) {
  if (!Array.isArray(item.refs) || !item.refs.length) {
    errors.push(`items[${i}].refs must be a non-empty array`);
    return;
  }
  for (const ref of item.refs) if (!FACT_REFS.has(ref)) errors.push(`items[${i}] has unsupported reference ${ref}`);
  for (const ref of item.refs) if (!needed.includes(ref)) errors.push(`items[${i}] cannot use unrelated reference ${ref}`);
  for (const ref of needed) if (!item.refs.includes(ref)) errors.push(`items[${i}] must reference ${ref}`);
}

/** Validate a parsed model response exclusively against the supplied facts. */
export function validateCoachResponse(value, facts) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['response must be an object'] };
  for (const key of Object.keys(value)) if (key !== 'items') errors.push(`unknown top-level field ${key}`);
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 5) errors.push('items must contain 1 to 5 entries');
  for (const [i, item] of (Array.isArray(value.items) ? value.items : []).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push(`items[${i}] must be an object`); continue; }
    const allowed = ITEM_FIELDS[item.type];
    if (!allowed) { errors.push(`items[${i}] has unsupported type`); continue; }
    for (const key of Object.keys(item)) if (!allowed.includes(key)) errors.push(`items[${i}] has unknown field ${key}`);
    if (item.type === 'assessment') {
      exactRefs(item, ['played_move', 'engine_class'], errors, i);
      if (item.move !== facts.played_move || item.classification !== facts.engine_class) errors.push(`items[${i}] assessment is not supplied`);
    } else if (item.type === 'evaluation') {
      exactRefs(item, ['eval_before', 'eval_after'], errors, i);
      if (!sameNumber(item.before, facts.eval_before) || !sameNumber(item.after, facts.eval_after)) errors.push(`items[${i}] evaluations are not supplied`);
    } else if (item.type === 'percentage') {
      exactRefs(item, ['win_before', 'win_after', 'win_drop'], errors, i);
      if (![sameNumber(item.before, facts.win_before), sameNumber(item.after, facts.win_after), sameNumber(item.drop, facts.win_drop)].every(Boolean)) errors.push(`items[${i}] percentages are not supplied`);
    } else if (item.type === 'alternative') {
      exactRefs(item, ['played_move', 'best_move'], errors, i);
      if (item.played !== facts.played_move || item.best !== facts.best_move) errors.push(`items[${i}] SAN is not supplied`);
    } else if (item.type === 'variation') {
      exactRefs(item, ['best_pv'], errors, i);
      if (!Array.isArray(item.moves) || item.moves.join(' ') !== (facts.best_pv || []).join(' ')) errors.push(`items[${i}] PV SAN is not supplied`);
    } else if (item.type === 'opening') {
      exactRefs(item, ['opening'], errors, i);
      if (typeof item.name !== 'string' || item.name !== facts.opening) errors.push(`items[${i}] opening is not supplied`);
    } else if (item.type === 'piece_square') {
      const ref = item.position === 'before' ? 'fen_before' : item.position === 'after' ? 'fen_after' : null;
      if (!ref) errors.push(`items[${i}] position must be before or after`);
      else exactRefs(item, [ref], errors, i);
      const actual = PIECES[fenPiece(facts[ref], item.square)];
      if (!actual || item.piece !== actual) errors.push(`items[${i}] piece-square claim is not supplied by the FEN`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseCoachResponse(text) {
  try { return { value: JSON.parse(String(text).trim()), errors: [] }; }
  catch { return { value: null, errors: ['response is not valid JSON'] }; }
}

export function renderCoachResponse(response) {
  return response.items.map(item => {
    if (item.type === 'assessment') return `${item.move} was classified as ${item.classification}.`;
    if (item.type === 'evaluation') return `The evaluation changed from ${item.before} to ${item.after}.`;
    if (item.type === 'percentage') return `The win chance changed from ${item.before}% to ${item.after}%, a drop of ${item.drop}%.`;
    if (item.type === 'alternative') return item.played === item.best ? `${item.played} matched the engine's best move.` : `Instead of ${item.played}, the engine preferred ${item.best}.`;
    if (item.type === 'variation') return `The supplied engine line was ${item.moves.join(' ')}.`;
    if (item.type === 'opening') return `The supplied opening was ${item.name}.`;
    return `In the ${item.position} position, the ${item.piece} was on ${item.square}.`;
  }).join('\n');
}

export function deterministicCoachFallback(facts) {
  const bits = [];
  if (facts.played_move && facts.engine_class) bits.push(`${facts.played_move} was classified as ${facts.engine_class}.`);
  if (facts.eval_before != null && facts.eval_after != null) bits.push(`The evaluation changed from ${facts.eval_before} to ${facts.eval_after}.`);
  if (facts.best_move) bits.push(facts.best_move === facts.played_move ? 'It matched the engine best move.' : `The engine preferred ${facts.best_move}.`);
  return bits.join(' ') || 'The engine analysis is available, but no verified coach explanation was returned.';
}

export function structuredCoachPrompt(basePrompt, facts, validationErrors = []) {
  const retry = validationErrors.length ? `\nPrevious response errors:\n- ${validationErrors.join('\n- ')}\nCorrect them using the same facts.` : '';
  return `${basePrompt}\n\nRESPONSE CONTRACT (strict): Return JSON only, with exactly {"items":[...]}. Every item must include a non-empty refs array of supplied fact identifiers. Allowed item shapes: ${JSON.stringify(ITEM_FIELDS)}. Do not add fields. Do not write prose. Facts (authoritative): ${JSON.stringify(facts)}.${retry}`;
}
