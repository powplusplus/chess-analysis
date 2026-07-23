const MODEL = 'gemma-4-31b-it';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 1_000_000;
// LOW thinking is plenty for a grounded 2-4 paragraph note and much faster than
// MAX; HIGH is the fallback if a build rejects LOW.
const THINK_LEVELS = ['LOW', 'HIGH'];

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
      const msg = data?.error?.message || `Gemini error ${status}`;
      return res.status(status).json({ error: msg });
    }
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

async function generateWithFallback(key, parts) {
  let last = null;
  for (const level of THINK_LEVELS) {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
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
    const data = await r.json();
    if (r.ok) return { data, status: 200 };
    const msg = data?.error?.message || '';
    last = { data, status: r.status };
    if (!/thinking[_ ]?level|invalid.*(MAX|LOW|HIGH)|unsupported.*thinking/i.test(msg)) {
      return last;
    }
  }
  return last || { data: { error: { message: 'Gemini request failed' } }, status: 502 };
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  const spoken = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  if (spoken) return spoken;
  return parts.filter(p => p.text).map(p => p.text).join('').trim();
}
