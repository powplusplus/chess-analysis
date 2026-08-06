import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GOOGLE_API_KEY = 'test-key';
const { default: handler } = await import('../api/coach.js');

function reply(status, body) {
  return { ok: status === 200, status, json: async () => body };
}

const OK_BODY = {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"items":[]}' }] } }],
};

/** Collect what the handler sends back, and every thinkingLevel it asked for. */
function harness(responses) {
  const levels = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    levels.push(JSON.parse(init.body).generationConfig.thinkingConfig.thinkingLevel);
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra upstream call');
    return next;
  };
  const sent = {};
  const res = {
    status(code) { sent.status = code; return res; },
    json(body) { sent.body = body; return res; },
    setHeader() { return res; },
    end() { return res; },
  };
  return { res, sent, levels, restore: () => { globalThis.fetch = original; } };
}

const req = { method: 'POST', body: { prompt: 'coach me' } };

test('a brief upstream overload is retried instead of failing the click', async () => {
  const h = harness([reply(503, {}), reply(503, {}), reply(200, OK_BODY)]);
  try {
    await handler(req, h.res);
  } finally {
    h.restore();
  }
  assert.equal(h.sent.status, 200, `expected recovery, got ${JSON.stringify(h.sent)}`);
  assert.equal(h.sent.body.text, '{"items":[]}');
  assert.equal(h.levels.length, 3, 'should have retried twice before succeeding');
  assert.deepEqual(h.levels, ['MINIMAL', 'MINIMAL', 'MINIMAL'], 'retries must not escalate thinking');
});

test('sustained overload reports what to do, not Google wording', async () => {
  const h = harness([reply(503, { error: { message: 'The model is overloaded.' } }),
    reply(503, {}), reply(503, {})]);
  try {
    await handler(req, h.res);
  } finally {
    h.restore();
  }
  assert.equal(h.sent.status, 503);
  assert.match(h.sent.body.error, /busy.*Press Analyze again/i);
  assert.equal(h.levels.length, 3, 'retries are capped');
});

test('a 400 is our bug and is never retried', async () => {
  const h = harness([reply(400, { error: { message: 'Invalid value at generation_config.temperature' } })]);
  try {
    await handler(req, h.res);
  } finally {
    h.restore();
  }
  assert.equal(h.sent.status, 400);
  assert.equal(h.levels.length, 1, 'a client error must not be repeated');
  assert.match(h.sent.body.error, /Invalid value/);
});

test('a rejected thinking level falls back to HIGH rather than retrying MINIMAL', async () => {
  const h = harness([
    reply(400, { error: { message: 'Invalid value at generation_config.thinking_config.thinking_level' } }),
    reply(200, OK_BODY),
  ]);
  try {
    await handler(req, h.res);
  } finally {
    h.restore();
  }
  assert.equal(h.sent.status, 200);
  assert.deepEqual(h.levels, ['MINIMAL', 'HIGH']);
});

test('a reply truncated at the token cap names its cause', async () => {
  const truncatedBody = {
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"items":[' }] } }],
    usageMetadata: { thoughtsTokenCount: 940 },
  };
  const h = harness([reply(200, truncatedBody)]);
  try {
    await handler(req, h.res);
  } finally {
    h.restore();
  }
  assert.equal(h.sent.status, 502);
  assert.match(h.sent.body.error, /token cap.*940.*thinking/i);
});
