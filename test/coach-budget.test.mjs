import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const num = (source, name) => {
  const m = source.match(new RegExp(`const ${name} = ([\\d_]+);`));
  assert.ok(m, `expected ${name} to be declared`);
  return Number(m[1].replace(/_/g, ''));
};

/**
 * These budgets are nested, and every layer has been sized wrong at least once:
 * a server that answered after the browser stopped listening, then a per-call
 * cap that killed calls which were about to succeed. The ordering is the
 * contract, so it is asserted rather than left to comments.
 */
test('the server answers inside the deadline its caller holds', async () => {
  const app = await read('../js/app.js');
  const api = await read('../api/coach.js');

  const firstResponse = num(app, 'FIRST_RESPONSE_MS');
  const total = num(app, 'COACH_TOTAL_MS');
  const perAttempt = num(api, 'PER_ATTEMPT_MS');
  const budget = num(api, 'RETRY_BUDGET_MS');

  assert.ok(perAttempt < budget,
    `a single attempt (${perAttempt}) must fit inside the handler budget (${budget})`);
  assert.ok(budget < firstResponse,
    `handler worst case (${budget}) must land before the caller gives up (${firstResponse})`);
  assert.ok(firstResponse < total,
    `the first-response deadline (${firstResponse}) must leave room in the total (${total})`);
  // Two contract attempts have to fit, or the retry on a validation failure is
  // dead code.
  assert.ok(firstResponse * 2 <= total,
    `the total (${total}) must allow a second attempt after ${firstResponse}`);
});

test('the platform gives the handler longer than the handler takes', async () => {
  const api = await read('../api/coach.js');
  const vercel = JSON.parse(await read('../vercel.json'));
  const budget = num(api, 'RETRY_BUDGET_MS');

  const fn = vercel.functions?.['api/*.js'];
  assert.ok(fn, 'api functions need an explicit maxDuration; the default is not guaranteed');
  assert.ok(fn.maxDuration * 1000 > budget,
    `maxDuration ${fn.maxDuration}s must exceed the ${budget}ms handler budget`);
});

test('a per-call cap cannot be tighter than a working call needs', async () => {
  // Observed: gemma-4-31b-it answers this prompt in more than 4.5s under load.
  // A cap below that turns success into a 504.
  const OBSERVED_SLOW_CALL_MS = 10_000;
  const api = await read('../api/coach.js');
  assert.ok(num(api, 'PER_ATTEMPT_MS') >= OBSERVED_SLOW_CALL_MS,
    'PER_ATTEMPT_MS must allow the slow-but-working calls seen in production');
});
