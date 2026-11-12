// The server can find a person's trading account from the wallet that owns it, the same way Polymarket's software does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { candidates, findTradingWallet } from '../trading-wallet.mjs';

test('the same owner always gives the same two possible addresses, and anything else gives none', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const a = candidates(owner);
  assert.equal(a.length, 2); assert.ok(a.every((x) => /^0x[0-9a-fA-F]{40}$/.test(x))); assert.notEqual(a[0], a[1]);
  assert.deepEqual(candidates(owner.toUpperCase().replace('0X', '0x')), a);
  assert.notDeepEqual(candidates('0x2222222222222222222222222222222222222222'), a);
  assert.deepEqual(candidates('nope'), []); assert.deepEqual(candidates(undefined), []);
});

test('only an address that exists on the chain counts', async () => {
  const owner = '0x3333333333333333333333333333333333333333', [first, second] = candidates(owner);
  let deployed = second;
  const rpc = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { const { params } = JSON.parse(b); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: params[0].toLowerCase() === String(deployed).toLowerCase() ? '0x6080' : '0x' })); }); });
  await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
  process.env.POLYGON_RPCS = `http://127.0.0.1:${rpc.address().port}`;
  try {
    assert.equal(await findTradingWallet(owner), second);
    deployed = first; assert.equal(await findTradingWallet(owner), first);
    deployed = null; assert.equal(await findTradingWallet(owner), null);
  } finally { rpc.close(); delete process.env.POLYGON_RPCS; }
});
