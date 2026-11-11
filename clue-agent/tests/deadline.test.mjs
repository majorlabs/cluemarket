// A slow step must not leave a screen waiting for ever: it gets a deadline and then fails with a plain error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline } from '../deadline.mjs';

test('a step that finishes in time gives its answer', async () => {
  assert.equal(await withDeadline(new Promise((r) => setTimeout(() => r('done'), 20)), 500, 'The step'), 'done');
});

test('a step that never comes back fails at the deadline and says which step', async () => {
  const t0 = Date.now();
  await assert.rejects(withDeadline(new Promise(() => {}), 150, 'Reading your balance'), (e) => e.name === 'TimeoutError' && /Reading your balance took longer than 0 seconds|Reading your balance took longer than \d+ seconds/.test(e.message));
  assert.ok(Date.now() - t0 < 1000);
});

test('a step that fails keeps its own error', async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error('rpc said no')), 500, 'The step'), /rpc said no/);
});

test('the shipped trading bundle reads the balance with a deadline and a backup server, like the source does', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Script } = await import('node:vm');
  const bundle = await readFile(new URL('../public/trading.js', import.meta.url), 'utf8');
  new Script(bundle);                                                                   // it still parses
  assert.match(bundle, /Reading your balance took longer than 15 seconds/);
  assert.match(bundle, /balance read failed, trying the next server/);
  assert.match(bundle, /Could not read your balance right now/);
});
