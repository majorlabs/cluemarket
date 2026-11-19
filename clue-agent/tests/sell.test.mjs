import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the trading bundle can sell shares, all-or-nothing, with plain messages', async () => {
  const src = await readFile(new URL('../trading-client.js', import.meta.url), 'utf8');
  assert.match(src, /window\.clueTrading\.sell = async function sell/);
  assert.match(src, /side: OrderSide\.SELL, shares: String\(size\), minPrice: String\(floor\), orderType: OrderType\.FOK/);
  const bundle = await readFile(new URL('../public/trading.js', import.meta.url), 'utf8');
  assert.match(bundle, /Your shares are still yours/);
  assert.match(bundle, /You cancelled the request in your wallet\. Nothing was sold\./);
});

test('the Portfolio offers Sell on open positions and checks location first', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /s === "open" && p\.token_id && n\.shares >= 0\.01 \? el\("button", \{ class: "btn small", type: "button", text: "Sell"/);
  const fn = app.slice(app.indexOf('async function sellShares'), app.indexOf('function positionRow'));
  assert.ok(fn.indexOf('checkGeoblock') > -1 && fn.indexOf('checkGeoblock') < fn.indexOf('clueTrading.sell'), 'location is checked before anything is sent');
});
