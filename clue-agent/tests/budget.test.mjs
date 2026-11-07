// Finding #4: many free accounts must not be able to drain NEAR AI credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HourlyBudget } from '../budget.mjs';
test('overall budget stops research across many accounts; it refills after an hour', () => {
  let t = 0; const now = () => t;
  const perUser = new HourlyBudget(10, now), overall = new HourlyBudget(60, now);
  let served = 0;
  for (let acct = 0; acct < 500; acct++) for (let i = 0; i < 10; i++) if (perUser.take('u' + acct) && overall.take()) served++;
  assert.equal(served, 60, 'no more than the overall hourly budget, however many accounts');
  assert.equal(perUser.take('fresh'), true); assert.equal(overall.take(), false);
  t += 3600001; assert.equal(overall.take(), true, 'refills after an hour');
});
test('one account is limited to its own budget', () => {
  const b = new HourlyBudget(10, () => 0); let n = 0; for (let i = 0; i < 25; i++) if (b.take('a')) n++; assert.equal(n, 10);
});
