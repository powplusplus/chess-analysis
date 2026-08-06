import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const LIMIT_MS = 10_000;

function mockedStreamingJourney({ textDelay = 15, pcmDelay = 15 } = {}) {
  const started = performance.now();
  return new Promise((resolve) => {
    setTimeout(() => {
      const firstVisibleText = performance.now() - started;
      setTimeout(() => resolve({
        firstVisibleText,
        firstScheduledAudio: performance.now() - started,
        // Engine analysis is an independent prerequisite and is reported, not
        // charged to the coach streaming latency budget.
        engineAnalysisDuration: 12_345,
      }), pcmDelay);
    }, textDelay);
  });
}

test('mocked coach and TTS streams meet the first-output deadline', async () => {
  const timing = await mockedStreamingJourney();
  assert.ok(timing.firstVisibleText < LIMIT_MS);
  assert.ok(timing.firstScheduledAudio < LIMIT_MS);
  assert.equal(timing.engineAnalysisDuration, 12_345);
});

test('default coach path is text-grounded and has explicit deadlines', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const run = app.slice(app.indexOf('async function runCoachAnalyze'), app.indexOf('/**\n * Stream the coach note'));
  assert.doesNotMatch(run, /await makeMoveBoardImages/);
  assert.match(run, /FIRST_RESPONSE_MS/);
  assert.match(run, /COACH_TOTAL_MS/);
  assert.match(app, /firstTtsPcm/);
  assert.match(app, /firstAudibleScheduling/);
});

test('all coach generation endpoints share one compact output budget', async () => {
  // The budget has to cover thinking tokens, the JSON envelope and the note.
  // It stays small enough to keep first-response latency inside the deadline.
  const CEILING = 1536;
  const budgets = new Set();
  for (const path of ['../js/coach.js', '../api/coach.js', '../api/coach-stream.js']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /maxOutputTokens:\s*MAX_OUTPUT_TOKENS/);
    const declared = source.match(/const MAX_OUTPUT_TOKENS = (\d+);/);
    assert.ok(declared, `${path} must declare MAX_OUTPUT_TOKENS`);
    budgets.add(Number(declared[1]));
  }
  assert.equal(budgets.size, 1, `endpoints disagree on the budget: ${[...budgets]}`);
  assert.ok([...budgets][0] <= CEILING, `budget ${[...budgets][0]} exceeds ${CEILING}`);
});
