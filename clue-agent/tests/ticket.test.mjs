import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sandbox = {};
new Function('window', readFileSync(new URL('../public/ticket.js', import.meta.url), 'utf8'))(sandbox);
const { previewBuy, checkGeoblock } = sandbox.ClueTicket;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} should be within ${eps} of ${b}`);

const asks = [{ price: 0.5, size: 100 }, { price: 0.52, size: 100 }, { price: 0.6, size: 1000 }];
const feeOpts = { feesEnabled: true, feeRate: 0.04, minSize: 5, tickSize: 0.01, accepting: true, bestBid: 0.49 };

test('market buy walks the book, averages the price and applies the published fee formula', () => {
  const r = previewBuy({ mode: 'market', asks, spend: 60, ...feeOpts });
  // 100 shares at 0.50 = $50, then $10 at 0.52 = 19.2308 shares
  near(r.sharesFilled, 100 + 10 / 0.52);
  near(r.cost, 60);
  near(r.avgPrice, 60 / (100 + 10 / 0.52));
  near(r.platformFee, 100 * 0.04 * 0.5 * 0.5 + (10 / 0.52) * 0.04 * 0.52 * 0.48);
  near(r.maxPayout, r.sharesFilled);
  near(r.profitIfWin, r.sharesFilled - 60 - r.platformFee);
  assert.equal(r.ok, true);
});

test('no fee when the market has none; builder fee is a flat share of what you spend', () => {
  const r = previewBuy({ mode: 'market', asks, spend: 60, feesEnabled: false, feeRate: 0.04, builderFeeBps: 100, minSize: 5, accepting: true });
  assert.equal(r.platformFee, 0);
  near(r.builderFee, 0.6);
});

test('not enough sellers: partial fill is reported, not hidden', () => {
  const r = previewBuy({ mode: 'market', asks: [{ price: 0.5, size: 10 }], spend: 100, ...feeOpts });
  near(r.sharesFilled, 10); near(r.cost, 5); near(r.unfilledBudget, 95);
  assert.ok(r.warnings.some((w) => /could fill/.test(w.text)));
});

test('limit buy: fills what crosses, the rest rests as a maker with no fee', () => {
  const r = previewBuy({ mode: 'limit', asks: [{ price: 0.5, size: 20 }, { price: 0.52, size: 100 }], shares: 50, limitPrice: 0.51, ...feeOpts });
  near(r.sharesFilled, 20); near(r.restingShares, 30); near(r.restingPrice, 0.51);
  near(r.platformFee, 20 * 0.04 * 0.5 * 0.5);
  near(r.maxPayout, 50);
});

test('blocks orders below the minimum size, closed markets, empty books and off-tick prices', () => {
  assert.equal(previewBuy({ mode: 'market', asks, spend: 1, ...feeOpts }).ok, false); // 2 shares < 5
  assert.equal(previewBuy({ mode: 'market', asks, spend: 60, ...feeOpts, accepting: false }).ok, false);
  const empty = previewBuy({ mode: 'market', asks: [], spend: 10, ...feeOpts });
  assert.equal(empty.ok, false); assert.equal(empty.sharesFilled, 0);
  const off = previewBuy({ mode: 'limit', asks, shares: 10, limitPrice: 0.505, ...feeOpts });
  assert.ok(off.warnings.some((w) => /multiple of/.test(w.text)));
});

test('warns about slippage and thin markets', () => {
  const r = previewBuy({ mode: 'market', asks: [{ price: 0.5, size: 10 }, { price: 0.7, size: 1000 }], spend: 100, ...feeOpts, bestBid: 0.2 });
  assert.ok(r.slippagePts > 2);
  assert.ok(r.warnings.some((w) => /above the best price/.test(w.text)));
  assert.ok(r.warnings.some((w) => /Thin market/.test(w.text)));
});

test('location check reports blocked, ok and unknown honestly', async () => {
  const mk = (body, ok = true) => async () => ({ ok, json: async () => body });
  assert.deepEqual(await checkGeoblock(mk({ blocked: true, country: 'US', region: 'OH' })), { state: 'blocked', country: 'US', region: 'OH' });
  assert.equal((await checkGeoblock(mk({ blocked: false, country: 'NG' }))).state, 'ok');
  assert.equal((await checkGeoblock(async () => { throw new Error('network'); })).state, 'unknown');
  assert.equal((await checkGeoblock(mk({}, false))).state, 'unknown');
});
