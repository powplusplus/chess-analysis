import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const ENDPOINTS = ['../js/coach.js', '../api/coach.js', '../api/coach-stream.js'];

async function sources() {
  return Promise.all(ENDPOINTS.map(async path => [path, await readFile(new URL(path, import.meta.url), 'utf8')]));
}

test('every endpoint asks for a thinking level Gemma 4 actually accepts', async () => {
  // Gemma 4 accepts MINIMAL or HIGH only. LOW is a 400 on every request, which
  // spent a round trip and then forced the HIGH fallback, and HIGH spends most
  // of the output budget on thought tokens.
  for (const [path, source] of await sources()) {
    const levels = source.match(/const THINK_LEVELS = \[([^\]]*)\]/);
    assert.ok(levels, `${path} must declare THINK_LEVELS`);
    const parsed = levels[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(parsed, ['MINIMAL', 'HIGH'], `${path} uses unsupported thinking levels`);
    assert.equal(parsed[0], 'MINIMAL', `${path} must try the cheapest level first`);
  }
});

test('a truncated reply is reported as truncation, not as malformed JSON', async () => {
  // Thought tokens are drawn from maxOutputTokens, so hitting the cap is the
  // likely failure. It arrives as HTTP 200 with an unparseable body.
  for (const path of ['../js/coach.js', '../api/coach.js']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /finishReason === 'MAX_TOKENS'/, `${path} must detect the token cap`);
    assert.match(source, /truncated\(data\)/, `${path} must check truncation before extracting text`);
    const extractIndex = source.indexOf('const text = extractText(data)');
    const checkIndex = source.indexOf('truncated(data)');
    assert.ok(checkIndex > -1 && checkIndex < extractIndex, `${path} must check truncation first`);
  }
});
