// The model selects facts and templates, and may add one short coaching note.
// Templates stay verbatim-grounded; the note is checked so every number and
// every move it names was supplied by the analysis.
const ITEM_FIELDS = {
  // Selected-move items.
  assessment: ['type', 'refs', 'move', 'classification'],
  evaluation: ['type', 'refs', 'before', 'after'],
  percentage: ['type', 'refs', 'before', 'after', 'drop'],
  alternative: ['type', 'refs', 'played', 'best'],
  variation: ['type', 'refs', 'moves'],
  opening: ['type', 'refs', 'name'],
  piece_square: ['type', 'refs', 'position', 'piece', 'square'],
  // Game-overview items. Without these an overview has no supplied fact to
  // stand on and can never pass validation.
  result: ['type', 'refs', 'text'],
  accuracy: ['type', 'refs', 'yours', 'opponent'],
  rating: ['type', 'refs', 'yours', 'opponent'],
  tally: ['type', 'refs', 'text'],
  critical_moment: ['type', 'refs', 'line'],
};

export const FACT_REFS = new Set([
  'played_move', 'engine_class', 'eval_before', 'eval_after', 'best_move',
  'best_pv', 'reply_pv', 'opening', 'win_before', 'win_after', 'win_drop',
  'fen_before', 'fen_after',
  'result', 'your_accuracy', 'opponent_accuracy', 'your_rating',
  'opponent_rating', 'tallies', 'critical_moments',
]);

const MAX_NOTE_CHARS = 1200;

// SAN is distinctive enough that ordinary coaching prose does not trip it: a
// destination square (file + rank) or castling is always required.
const SAN_RE = /\b(?:O-O-O|O-O|(?:[KQRBN][a-h]?[1-8]?|[a-h])?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

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

/** Every string the facts contain, flattened, so the note can be checked against them. */
function factStrings(facts) {
  const out = [];
  const walk = value => {
    if (value == null) return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (typeof value === 'object') { Object.values(value).forEach(walk); return; }
    out.push(String(value));
  };
  walk(facts);
  return out;
}

/** Moves and numbers the note is allowed to mention, taken only from the facts. */
function groundingVocabulary(facts) {
  const blob = factStrings(facts).join(' ');
  const moves = new Set(blob.match(SAN_RE) || []);
  const numbers = new Set((blob.match(NUMBER_RE) || []).map(n => String(Number(n))));
  // Move numbers are addressable whenever a move list was supplied.
  const plies = Number(facts?.total_plies) || 0;
  for (let i = 1; i <= Math.ceil(plies / 2); i++) numbers.add(String(i));
  return { moves, numbers };
}

/**
 * The note is the only prose the model writes, so it may not introduce a move
 * or a figure the analysis did not supply. Wording stays free.
 */
function validateNote(note, facts, errors) {
  if (note === undefined) return;
  if (typeof note !== 'string' || !note.trim()) {
    errors.push('note must be a non-empty string when present');
    return;
  }
  if (note.length > MAX_NOTE_CHARS) errors.push(`note must be ${MAX_NOTE_CHARS} characters or fewer`);
  if (/[—–]/.test(note)) errors.push('note must not use em dashes or en dashes');
  const { moves, numbers } = groundingVocabulary(facts);
  for (const san of note.match(SAN_RE) || []) {
    if (!moves.has(san)) errors.push(`note names move ${san}, which is not supplied`);
  }
  for (const raw of note.match(NUMBER_RE) || []) {
    if (!numbers.has(String(Number(raw)))) errors.push(`note states ${raw}, which is not supplied`);
  }
}

/** Validate a parsed model response exclusively against the supplied facts. */
export function validateCoachResponse(value, facts) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['response must be an object'] };
  for (const key of Object.keys(value)) if (key !== 'items' && key !== 'note') errors.push(`unknown top-level field ${key}`);
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 5) errors.push('items must contain 1 to 5 entries');
  validateNote(value.note, facts, errors);
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
    } else if (item.type === 'result') {
      exactRefs(item, ['result'], errors, i);
      if (typeof item.text !== 'string' || item.text !== facts.result) errors.push(`items[${i}] result is not supplied`);
    } else if (item.type === 'accuracy') {
      exactRefs(item, ['your_accuracy', 'opponent_accuracy'], errors, i);
      if (!sameNumber(item.yours, facts.your_accuracy) || !sameNumber(item.opponent, facts.opponent_accuracy)) errors.push(`items[${i}] accuracies are not supplied`);
    } else if (item.type === 'rating') {
      exactRefs(item, ['your_rating', 'opponent_rating'], errors, i);
      if (!sameNumber(item.yours, facts.your_rating) || !sameNumber(item.opponent, facts.opponent_rating)) errors.push(`items[${i}] ratings are not supplied`);
    } else if (item.type === 'tally') {
      exactRefs(item, ['tallies'], errors, i);
      if (typeof item.text !== 'string' || item.text !== facts.tallies) errors.push(`items[${i}] tallies are not supplied`);
    } else if (item.type === 'critical_moment') {
      exactRefs(item, ['critical_moments'], errors, i);
      const supplied = Array.isArray(facts.critical_moments) ? facts.critical_moments : [];
      if (typeof item.line !== 'string' || !supplied.includes(item.line)) errors.push(`items[${i}] critical moment is not supplied`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseCoachResponse(text) {
  const raw = String(text).trim();
  // Models routinely wrap JSON in a ```json fence even when told not to.
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced ? fenced[1] : raw;
  try { return { value: JSON.parse(body), errors: [] }; }
  catch { return { value: null, errors: ['response is not valid JSON'] }; }
}

function renderItem(item) {
  if (item.type === 'assessment') return `${item.move} was classified as ${item.classification}.`;
  if (item.type === 'evaluation') return `The evaluation changed from ${item.before} to ${item.after}.`;
  if (item.type === 'percentage') return `The win chance changed from ${item.before}% to ${item.after}%, a drop of ${item.drop}%.`;
  if (item.type === 'alternative') return item.played === item.best ? `${item.played} matched the engine's best move.` : `Instead of ${item.played}, the engine preferred ${item.best}.`;
  if (item.type === 'variation') return `The supplied engine line was ${item.moves.join(' ')}.`;
  if (item.type === 'opening') return `The supplied opening was ${item.name}.`;
  if (item.type === 'result') return `Result: ${item.text}.`;
  if (item.type === 'accuracy') return `Your accuracy was ${item.yours}, the opponent's was ${item.opponent}.`;
  if (item.type === 'rating') return `That plays around ${item.yours}, against roughly ${item.opponent}.`;
  if (item.type === 'tally') return `Move quality: ${item.text}.`;
  // Tally lines are display shorthand; the coach panel is also read aloud, so
  // the separators become words.
  if (item.type === 'critical_moment') return `Critical moment: ${item.line.replace(' · ', ': ').replace(' = ', ' was ')}.`;
  return `In the ${item.position} position, the ${item.piece} was on ${item.square}.`;
}

/** Facts first as one compact paragraph, then the coach's note. */
export function renderCoachResponse(response) {
  const facts = response.items.map(renderItem).join(' ');
  const note = typeof response.note === 'string' ? response.note.trim() : '';
  return [facts, note].filter(Boolean).join('\n\n');
}

export function deterministicCoachFallback(facts) {
  const bits = [];
  if (facts.result) bits.push(`Result: ${facts.result}.`);
  if (facts.played_move && facts.engine_class) bits.push(`${facts.played_move} was classified as ${facts.engine_class}.`);
  if (facts.eval_before != null && facts.eval_after != null) bits.push(`The evaluation changed from ${facts.eval_before} to ${facts.eval_after}.`);
  if (facts.best_move) bits.push(facts.best_move === facts.played_move ? 'It matched the engine best move.' : `The engine preferred ${facts.best_move}.`);
  if (facts.your_accuracy != null) {
    bits.push(facts.opponent_accuracy != null
      ? `Your accuracy was ${facts.your_accuracy}, the opponent's was ${facts.opponent_accuracy}.`
      : `Your accuracy was ${facts.your_accuracy}.`);
  }
  if (facts.tallies) bits.push(`Move quality: ${facts.tallies}.`);
  if (Array.isArray(facts.critical_moments) && facts.critical_moments.length) {
    bits.push(`Critical moments: ${facts.critical_moments.join('; ')}.`);
  }
  if (facts.opening) bits.push(`Opening: ${facts.opening}.`);
  return bits.join(' ') || 'The engine analysis is available, but no verified coach explanation was returned.';
}

export function structuredCoachPrompt(basePrompt, facts, validationErrors = []) {
  const retry = validationErrors.length ? `\nPrevious response errors:\n- ${validationErrors.join('\n- ')}\nCorrect them using the same facts.` : '';
  const shapes = JSON.stringify(ITEM_FIELDS);
  return `${basePrompt}

RESPONSE CONTRACT (strict): Return JSON only, no markdown fence, shaped as {"items":[...],"note":"..."}.

"items" holds 1 to 5 fact restatements. Every item needs a non-empty refs array naming the supplied facts it uses, and its values must be copied verbatim from those facts. Allowed item shapes: ${shapes}. Do not add fields to items.

"note" is your coaching in plain prose, 2 to 3 short paragraphs, ${MAX_NOTE_CHARS} characters max, following the voice rules above. Explain the idea, the plan, and what to take away. Do not merely restate the items. In the note you may name ONLY moves that appear in the facts and cite ONLY numbers that appear in the facts. Everything else must be qualitative. No dashes of any kind.

Facts (authoritative): ${JSON.stringify(facts)}.${retry}`;
}
