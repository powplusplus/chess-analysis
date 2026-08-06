const MODEL = 'gemma-4-31b-it';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 1_000_000;
// Gemma 4 accepts only MINIMAL or HIGH; LOW is a 400. MINIMAL is also the only
// setting that emits no thought tokens, and thought tokens are drawn from
// maxOutputTokens, so HIGH can starve the reply of room. HIGH stays as the
// fallback for a build that rejects MINIMAL.
const THINK_LEVELS = ['MINIMAL', 'HIGH'];
// A grounded note plus its JSON envelope needs more room than a bare template
// list, and thinking tokens are drawn from the same budget. Still compact:
// enough for 2 to 3 short paragraphs, not an essay.
const MAX_OUTPUT_TOKENS = 1024;
// Gemma is frequently overloaded for a second or two. Retry those, and only
// those: a 400 is our bug and repeating it just burns the request budget.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [350];
// Sized against how long this model actually answers in, not against a latency
// target it cannot meet: a 4.5s cap cut off calls that were about to succeed.
// A refusal comes back fast, so a retry still fits; a slow call that is working
// gets the full attempt and is not retried. RETRY_BUDGET_MS is the worst case
// for the whole handler and must stay under the caller's FIRST_RESPONSE_MS.
const PER_ATTEMPT_MS = 12_000;
const RETRY_BUDGET_MS = 20_000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const prompt = body && body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const images = sanitizeImages(body.images);
  const parts = [];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  parts.push({ text: prompt });

  try {
    const { data, status } = await generateWithFallback(key, parts);
    if (status !== 200) {
      // Overload survived the retries. Say what to do rather than forwarding
      // Google's wording, which reads like the app is broken.
      if (status === 429 || status === 503 || status === 504) {
        return res.status(status === 504 ? 503 : status)
          .json({ error: 'The coach model is busy. Press Analyze again in a moment.' });
      }
      const msg = data?.error?.message || `Gemini error ${status}`;
      return res.status(status).json({ error: msg });
    }
    if (truncated(data)) return res.status(502).json({ error: truncationMessage(data) });
    const text = extractText(data);
    if (!text) return res.status(502).json({ error: 'Empty coach reply' });
    return res.status(200).json({ text });
  } catch (ex) {
    return res.status(502).json({ error: ex.message || 'Coach request failed' });
  }
}

function sanitizeImages(images) {
  if (!Array.isArray(images) || !images.length) return [];
  const out = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    if (!img || typeof img.data !== 'string' || !img.data) continue;
    const mime = typeof img.mimeType === 'string' && img.mimeType.startsWith('image/')
      ? img.mimeType
      : 'image/png';
    const bytes = Math.floor(img.data.length * 0.75);
    if (bytes > MAX_IMAGE_BYTES) continue;
    out.push({ mimeType: mime, data: img.data });
  }
  return out;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isThinkingLevelError(msg) {
  return /thinking[_ ]?level|invalid.*(MINIMAL|MAX|LOW|HIGH)|unsupported.*thinking/i.test(msg || '');
}

async function generateOnce(key, parts, level) {
  try {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: level },
        },
      }),
      signal: AbortSignal.timeout(PER_ATTEMPT_MS),
    });
    const data = await r.json().catch(() => ({}));
    return { data, status: r.status, ok: r.ok };
  } catch (ex) {
    // A hung upstream call is the same problem as a refused one, and must not
    // be allowed to consume the caller's whole deadline.
    const timedOut = ex.name === 'TimeoutError' || ex.name === 'AbortError';
    return {
      data: { error: { message: timedOut ? `Upstream call exceeded ${PER_ATTEMPT_MS}ms` : (ex.message || 'fetch failed') } },
      status: 504,
      ok: false,
    };
  }
}

async function generateWithFallback(key, parts) {
  const startedAt = Date.now();
  let last = null;
  for (const level of THINK_LEVELS) {
    for (let attempt = 0; ; attempt++) {
      const { data, status, ok } = await generateOnce(key, parts, level);
      if (ok) return { data, status: 200 };
      const msg = data?.error?.message || '';
      last = { data, status };
      // Nothing else records why a coach request failed, so an upstream refusal
      // is otherwise invisible: the browser sees a bare status and the function
      // log shows only that it ran.
      console.error(`[coach] upstream ${status} thinkingLevel=${level}: ${msg || '(no message)'}`);
      // Retry only if the retry itself could still finish in time. Budgeting
      // for the delay alone was the bug: the call after it ran long, the
      // handler returned 200 past the browser's deadline, and the caller had
      // already given up on a response it never read.
      const delay = RETRY_DELAYS_MS[attempt];
      const finishesBy = Date.now() - startedAt + delay + PER_ATTEMPT_MS;
      if (TRANSIENT_STATUS.has(status) && delay != null && finishesBy <= RETRY_BUDGET_MS) {
        await sleep(delay);
        continue;
      }
      if (isThinkingLevelError(msg)) break;
      return last;
    }
  }
  return last || { data: { error: { message: 'Gemini request failed' } }, status: 502 };
}

// A reply cut off at the token cap is valid HTTP but invalid JSON downstream.
// Thought tokens come out of the same budget, so a high thinking level can
// starve the answer. Name the cause rather than letting the parser guess.
function truncated(data) {
  return data?.candidates?.[0]?.finishReason === 'MAX_TOKENS';
}

function truncationMessage(data) {
  const thoughts = data?.usageMetadata?.thoughtsTokenCount;
  const spent = thoughts ? ` after spending ${thoughts} on thinking` : '';
  return `Coach reply hit the ${MAX_OUTPUT_TOKENS} token cap${spent}.`;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  const spoken = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  if (spoken) return spoken;
  return parts.filter(p => p.text).map(p => p.text).join('').trim();
}
