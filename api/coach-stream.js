// Streaming coach proxy. Pipes streamGenerateContent SSE straight to the
// browser so text (and therefore speech) starts as soon as the model emits its
// first words, instead of waiting for the whole note to render. Keeps
// GOOGLE_API_KEY on the server.
const MODEL = 'gemma-4-31b-it';
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 1_000_000;
// LOW thinking is plenty for a grounded note and much faster than HIGH; HIGH is
// the fallback if a build rejects LOW.
const THINK_LEVELS = ['LOW', 'HIGH'];

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
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

function isThinkingLevelError(msg) {
  return /thinking[_ ]?level|invalid.*(MAX|LOW|HIGH)|unsupported.*thinking/i.test(msg || '');
}

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

  const parts = [];
  for (const img of sanitizeImages(body.images)) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  parts.push({ text: prompt });

  let lastErr = null;
  let lastStatus = 502;
  for (const level of THINK_LEVELS) {
    let upstream;
    try {
      upstream = await fetch(`${endpoint(MODEL)}?alt=sse&key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingLevel: level },
          },
        }),
      });
    } catch (ex) {
      lastErr = ex.message || 'Coach stream fetch failed';
      continue;
    }

    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({}));
      lastErr = data?.error?.message || `Coach stream ${upstream.status}`;
      lastStatus = upstream.status || 502;
      // A rejected thinking level retries at the next level; anything else stops.
      if (isThinkingLevelError(lastErr)) continue;
      break;
    }

    // Headers can only be set once — commit before piping any bytes.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(200);
    try {
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
    } catch (ex) {
      // Upstream dropped mid-stream — end what we have; client keeps the text
      // it already received.
      lastErr = ex.message || 'Coach stream interrupted';
    }
    return res.end();
  }

  const status = lastStatus >= 400 ? lastStatus : 502;
  return res.status(status).json({ error: lastErr || 'Coach stream failed' });
}
