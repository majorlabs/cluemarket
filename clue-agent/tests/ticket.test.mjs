import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sandbox = {};
new Function('window', readFileSync(new URL('../public/ticket.js', import.meta.url), 'utf8'))(sandbox);
const { previewBuy, checkGeoblock, orderPlan, validDepositAddress, cashCall, cashParse, positionState, positionNumbers, portfolioTotals } = sandbox.ClueTicket;
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

// ---- Checking an order before it is sent ----
const ready = { signedIn: true, geo: { state: 'ok' }, setUp: true, accepting: true, minSize: 5, tickSize: 0.01, balance: 100 };
const plan = (spend, extra = {}) => orderPlan({ ...ready, ...extra, preview: previewBuy({ mode: 'market', asks, spend, ...feeOpts }) });

test('a good order is allowed, with the worst price set 1% above the last price it touches', () => {
  const p = plan(60);
  assert.equal(p.ok, true);
  assert.equal(p.worstFill, 0.52);
  assert.equal(p.maxPrice, 0.53);            // 0.52 x 1.01 = 0.5252, rounded up to the next 1¢ step
  near(p.spend, 60);
  assert.ok(p.expectedCost > 60);            // the fee is on top
});

test('each safety check refuses with a plain reason', () => {
  assert.match(plan(60, { signedIn: false }).reason, /Sign in/);
  assert.match(plan(60, { geo: { state: 'blocked' } }).reason, /isn't available where you are/);
  assert.match(plan(60, { geo: { state: 'unknown' } }).reason, /couldn't be checked/);
  assert.match(plan(60, { setUp: false }).reason, /Set up trading/);
  assert.match(plan(60, { accepting: false }).reason, /isn't accepting orders/);
  assert.match(plan(60, { balance: 10 }).reason, /Add money/);
  assert.match(plan(60, { balance: null }).reason, /balance couldn't be read/);
});

test('an order under the 5-share minimum, or bigger than the book, is refused', () => {
  assert.match(plan(1).reason, /minimum order is 5 shares/);          // $1 at 50¢ is 2 shares
  assert.match(plan(5000).reason, /aren't enough sellers/);           // the whole book is under $1,500
  assert.match(orderPlan({ ...ready, preview: previewBuy({ mode: 'market', asks: [], spend: 10, ...feeOpts }) }).reason, /Nobody is selling/);
});

test('the worst price never goes above 99¢', () => {
  const p = orderPlan({ ...ready, preview: previewBuy({ mode: 'market', asks: [{ price: 0.99, size: 1000 }], spend: 20, ...feeOpts }) });
  assert.equal(p.ok, true);
  assert.equal(p.maxPrice, 0.99);
});

test('only well-formed deposit addresses are ever shown', () => {
  assert.equal(validDepositAddress('evm', '0x0CA3d6F8e10d5C9D717BAd215EA7B9ec7997e5Ad'), true);
  assert.equal(validDepositAddress('evm', '0x0CA3d6F8e10d5C9D717BAd215EA7B9ec7997e5A'), false);   // one character short
  assert.equal(validDepositAddress('evm', 'Ai1UZasfgnHdst7JNTB72WfwhtjcmrDuTezpvxeyBBC1'), false);
  assert.equal(validDepositAddress('svm', 'Ai1UZasfgnHdst7JNTB72WfwhtjcmrDuTezpvxeyBBC1'), true);
  assert.equal(validDepositAddress('svm', '0x0CA3d6F8e10d5C9D717BAd215EA7B9ec7997e5Ad'), false);
  assert.equal(validDepositAddress('svm', 'Ai1UZasfgnHdst7JNTB72Wfwhtjc<script>'), false);
  assert.equal(validDepositAddress('btc', 'bc1q0uv3ke7j7ljshjcj2k9s2jnrmqy0typqtc0p28'), false);   // not offered
  assert.equal(validDepositAddress('evm', undefined), false);
});

// ---- The same checks must hold for every market, whatever its own rules are ----
const marketWith = (rules, book) => orderPlan({ ...ready, ...rules, preview: previewBuy({ mode: 'market', asks: book, spend: rules.spend, feesEnabled: false, minSize: rules.minSize, tickSize: rules.tickSize, accepting: true }) });

test('each market uses its own minimum size', () => {
  const book = [{ price: 0.5, size: 1000 }];
  assert.equal(marketWith({ spend: 3, minSize: 5, tickSize: 0.01 }, book).ok, true);          // 6 shares, minimum 5
  assert.match(marketWith({ spend: 3, minSize: 15, tickSize: 0.01 }, book).reason, /minimum order is 15 shares/);
  assert.equal(marketWith({ spend: 8, minSize: 15, tickSize: 0.01 }, book).ok, true);         // 16 shares
});

test('each market uses its own price step when setting the worst price', () => {
  const book = [{ price: 0.376, size: 1000 }];
  const fine = marketWith({ spend: 5, minSize: 5, tickSize: 0.001 }, book);
  assert.equal(fine.maxPrice, 0.38);                      // 0.376 x 1.01 = 0.37976, up to the next 0.001 step
  const coarse = marketWith({ spend: 5, minSize: 5, tickSize: 0.01 }, [{ price: 0.37, size: 1000 }]);
  assert.equal(coarse.maxPrice, 0.38);                    // 0.3737 up to the next 0.01 step
  const wide = marketWith({ spend: 5, minSize: 5, tickSize: 0.1 }, [{ price: 0.4, size: 1000 }]);
  assert.equal(wide.maxPrice, 0.5);                       // 0.404 up to the next 0.1 step
});

test('a worst price never lands on a price the market cannot take', () => {
  for (const tick of [0.1, 0.01, 0.001, 0.0001]) {
    for (const price of [0.02, 0.137, 0.5, 0.876, 0.97]) {
      const p = marketWith({ spend: 50, minSize: 5, tickSize: tick }, [{ price: Math.round(price / tick) * tick, size: 100000 }]);
      if (!p.ok) continue;
      const steps = p.maxPrice / tick;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `${p.maxPrice} is not a multiple of ${tick}`);
      assert.ok(p.maxPrice <= 1 - tick + 1e-9 && p.maxPrice >= p.worstFill - 1e-9);
    }
  }
});

test('the cash balance is read from the trading account\'s pUSD, and only well-formed answers count', () => {
  const call = cashCall('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  assert.equal(call.to, '0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb');                         // pUSD
  assert.equal(call.data, '0x70a08231' + '000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045');   // balanceOf(address)
  assert.equal(cashCall('0x123'), null); assert.equal(cashCall(null), null); assert.equal(cashCall('<script>'), null);
  assert.equal(cashParse('0x1f47d0'), 2.05);                                                  // 2,050,000 units of 6 decimals
  assert.equal(cashParse('0x0'), 0);
  assert.equal(cashParse('0x' + '0'.repeat(63) + '1'), 0.000001);
  for (const bad of ['0x', '', 'nope', null, undefined, 5, '0xzz', '0x' + 'f'.repeat(65)]) assert.equal(cashParse(bad), null, String(bad));
});

// ---- the portfolio ----
const pos = (o) => ({ redeemable: false, current_price: 0.5, current_size: 10, avg_price: 0.4, entry_cost_usdc: 4, total_cost_usdc: 4.05, current_value: 5, unrealized_pnl: 1, ...o });

test('a position is open, won or lost, by whether its market has ended and what it pays', () => {
  assert.equal(positionState(pos({})), 'open');
  assert.equal(positionState(pos({ redeemable: true, current_price: 1 })), 'won');
  assert.equal(positionState(pos({ redeemable: true, current_price: 0.995 })), 'won');
  assert.equal(positionState(pos({ redeemable: true, current_price: 0 })), 'lost');
  assert.equal(positionState(pos({ redeemable: true, current_price: 0.5 })), 'lost');       // ended without paying out in full
  assert.equal(positionState(null), 'open');
});

test('profit and loss is value now minus what was paid, as a share of what was paid', () => {
  const n = positionNumbers(pos({}));
  assert.equal(n.value, 5); assert.equal(n.pnl, 1); assert.equal(n.pct, 0.25); assert.equal(n.shares, 10); assert.equal(n.paid, 4.05);
  const down = positionNumbers(pos({ current_value: 3, unrealized_pnl: -1 }));
  assert.equal(down.pct, -0.25);
  assert.equal(positionNumbers(pos({ entry_cost_usdc: 0, total_cost_usdc: 0, unrealized_pnl: 0 })).pct, 0);   // nothing paid: no divide by zero
  assert.equal(positionNumbers({}).value, 0);                                                                 // missing numbers count as zero
});

test('the totals add up open positions, open profit and what is waiting to be claimed', () => {
  const list = [pos({}), pos({ current_value: 3, unrealized_pnl: -1 }), pos({ redeemable: true, current_price: 1, current_value: 8, unrealized_pnl: 4 }), pos({ redeemable: true, current_price: 0, current_value: 0, unrealized_pnl: -4 })];
  assert.deepEqual(portfolioTotals(list), { value: 8, openPnl: 0, toClaim: 8, open: 2 });
  assert.deepEqual(portfolioTotals([]), { value: 0, openPnl: 0, toClaim: 0, open: 0 });
  assert.deepEqual(portfolioTotals(undefined), { value: 0, openPnl: 0, toClaim: 0, open: 0 });
});
