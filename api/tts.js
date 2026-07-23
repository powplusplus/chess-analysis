const TTS_MODELS = [
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-preview-tts',
];
const VOICE = 'Charon';

const STYLE_PREFIX = `# AUDIO PROFILE: Magnus
## Norwegian chess grandmaster reviewing a game

## THE SCENE
Quiet study after a rapid. Soft room, board between you and a student. Intimate, low-energy, conversational — not a broadcast, not hype.

### DIRECTOR'S NOTES
Style:
* Dry, understated Scandinavian male. Calm confidence. Slight wry humor. Never theatrical, never American radio coach.
* Soft mid-low chest voice. Relaxed jaw. Matter-of-fact, like thinking aloud at the board.
Pace: Unhurried. Natural pauses between thoughts. Never rushed, never robotic.
Accent: Light Oslo / Eastern Norwegian English. Soft consonants, slight Scandinavian vowel rhythm. Speak English only — do not switch to Norwegian.

#### TRANSCRIPT
`;

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function extractAudio(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      return {
        b64: inline.data,
        mime: inline.mimeType || inline.mime_type || 'audio/L16;codec=pcm;rate=24000',
      };
    }
  }
  return null;
}

function parseSampleRate(mime) {
  const m = /rate=(\d+)/i.exec(mime || '');
  return m ? parseInt(m[1], 10) : 24000;
}

function pcmToWav(b64, sampleRate) {
  const pcm = Buffer.from(b64, 'base64');
  const channels = 1;
  const bits = 16;
  const blockAlign = channels * (bits / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function callModel(key, model, text) {
  const r = await fetch(`${endpoint(model)}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: STYLE_PREFIX + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE },
          },
        },
      },
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error(data?.error?.message || `TTS ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const audio = extractAudio(data);
  if (!audio) throw new Error('Empty TTS audio');
  const rate = parseSampleRate(audio.mime);
  return pcmToWav(audio.b64, rate);
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
  const text = body && body.text;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text' });
  }

  let lastErr;
  for (const model of TTS_MODELS) {
    try {
      const wav = await callModel(key, model, text);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(wav);
    } catch (ex) {
      lastErr = ex;
      // try next model on quota / overload
      if (/quota|rate|high demand|overloaded|429|503/i.test(ex.message || '')) continue;
      break;
    }
  }
  const status = lastErr?.status && lastErr.status >= 400 ? lastErr.status : 502;
  return res.status(status).json({ error: lastErr?.message || 'TTS failed' });
}
