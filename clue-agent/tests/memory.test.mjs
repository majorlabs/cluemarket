import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, summarize, brier, liveState, validMarketId } from '../memory.mjs';

const NOW = Date.parse('2026-11-08T00:00:00Z');
const open = (p, extra = {}) => ({ closed: false, outcomePrices: [String(p), String(1 - p)], endDate: '2027-01-01T00:00:00Z', ...extra });
const f = (probability, market_price, outcome_index = 0) => ({ probability, market_price, outcome_index });

test('brier score: confident and right is near 0, confident and wrong is near 1', () => {
  assert.ok(Math.abs(brier(90, true) - 0.01) < 1e-9);
  assert.ok(Math.abs(brier(90, false) - 0.81) < 1e-9);
  assert.equal(brier(50, true), 0.25);
});

test('an open market is not resolved, even at a very high price', () => {
  assert.equal(liveState(open(0.995), 0).state, 'open');
  assert.equal(assess(f(60, 0.5), open(0.995), NOW).state, 'open');
});

test('resolution needs a closed market with a price of 1 on one side', () => {
  assert.equal(liveState({ closed: true, outcomePrices: ['1', '0'] }, 0).won, true);
  assert.equal(liveState({ closed: true, outcomePrices: ['1', '0'] }, 1).won, false);
  assert.equal(liveState({ closed: true, outcomePrices: ['0.55', '0.45'] }, 0).state, 'closed');
  assert.equal(liveState({ closed: true, outcomePrices: ['1'] , }, 1).state, 'closed'); // missing price for that outcome
  assert.equal(liveState(null, 0).state, 'unknown');
});

test('flags a price move and a gap, with signed numbers', () => {
  const a = assess(f(70, 0.40), open(0.52), NOW);
  assert.equal(a.movePoints, 12);
  assert.equal(a.gapPoints, 18);
  assert.deepEqual(a.flags.sort(), ['gap', 'moved']);
  const quiet = assess(f(52, 0.50), open(0.51), NOW);
  assert.deepEqual(quiet.flags, []);
});

test('no move is reported when the price at forecast time was not recorded', () => {
  const a = assess(f(70, null), open(0.52), NOW);
  assert.equal(a.movePoints, undefined);
  assert.ok(!a.flags.includes('moved'));
});

test('closing soon is flagged only inside the window and only for future dates', () => {
  assert.ok(assess(f(50, 0.5), open(0.5, { endDate: '2026-11-12T00:00:00Z' }), NOW).flags.includes('closing-soon'));
  assert.ok(!assess(f(50, 0.5), open(0.5, { endDate: '2026-12-12T00:00:00Z' }), NOW).flags.includes('closing-soon'));
  assert.ok(!assess(f(50, 0.5), open(0.5, { endDate: '2026-11-01T00:00:00Z' }), NOW).flags.includes('closing-soon'));
});

test('a resolved forecast is scored against the market price at the time', () => {
  const win = assess(f(80, 0.60), { closed: true, outcomePrices: ['1', '0'] }, NOW);
  assert.equal(win.happened, true);
  assert.ok(win.score.beatMarket);                       // 80% beats 60% when it happens
  const loss = assess(f(80, 0.60), { closed: true, outcomePrices: ['0', '1'] }, NOW);
  assert.equal(loss.happened, false);
  assert.ok(!loss.score.beatMarket);                     // 80% is worse than 60% when it does not
  const second = assess(f(30, 0.45, 1), { closed: true, outcomePrices: ['0', '1'] }, NOW); // forecast was about outcome #2
  assert.equal(second.happened, true);
});

test('the summary does not claim skill from a few results', () => {
  const r = (p, m, yes) => assess(f(p, m), { closed: true, outcomePrices: yes ? ['1', '0'] : ['0', '1'] }, NOW);
  const few = summarize([r(90, 0.5, true), r(80, 0.5, true)]);
  assert.equal(few.resolved, 2);
  assert.equal(few.verdict, 'too-few');
  assert.equal(summarize([]).verdict, 'none');
  const many = summarize(Array.from({ length: 6 }, () => r(90, 0.5, true)));
  assert.equal(many.verdict, 'better');
  assert.equal(many.beatMarket, 6);
  const bad = summarize(Array.from({ length: 6 }, () => r(90, 0.5, false)));
  assert.equal(bad.verdict, 'worse');
  assert.equal(summarize([...many ? [r(70, null, true), r(70, null, true), r(70, null, true), r(70, null, true), r(70, null, true)] : []]).verdict, 'no-market');
});

test('open and unknown items are counted but not scored', () => {
  const s = summarize([assess(f(60, 0.5), open(0.5), NOW), assess(f(60, 0.5), null, NOW)]);
  assert.equal(s.resolved, 0);
  assert.equal(s.open, 1);
});

test('market ids must be plain numbers before they are used in a URL', () => {
  assert.ok(validMarketId('512340'));
  for (const bad of ['', '12/../x', '1?x=2', 'abc', 123, null, '1'.repeat(30)]) assert.ok(!validMarketId(bad));
});
