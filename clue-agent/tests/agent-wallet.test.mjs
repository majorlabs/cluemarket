// Assistant trading: a person connects their own OutLayer wallet and sets their own limits. Clue signs only sign-in, orders
// on Polymarket's exchanges within those limits, and permissions for Polymarket's own contracts. A stand-in plays OutLayer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { production } from '@polymarket/client';

const ADDR = '0x6f0d2a94fb8296a34629b9876debff2a6673d24a', SIG = '0x' + 'ab'.repeat(65);
const seen = [];
const outlayer = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    const key = String(req.headers.authorization || '').slice(7);
    if (key !== 'wk_goodkey1234567890abcdef') { res.writeHead(401); return res.end('{"message":"bad key"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/wallet/v1/address')) return res.end(JSON.stringify({ address: ADDR }));
    if (req.url === '/wallet/v1/evm/sign-typed-data') { seen.push(JSON.parse(raw)); return setTimeout(() => res.end(JSON.stringify({ signature: SIG })), signDelay); }
    res.end('{}');
  });
});
await new Promise((r) => outlayer.listen(0, '127.0.0.1', r));
let mid = '0.5', clobUp = true, signDelay = 0;
const clob = http.createServer((req, res) => {
  if (!clobUp) { res.writeHead(503); return res.end('{}'); }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ mid }));
});
await new Promise((r) => clob.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-aw-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, OUTLAYER_BASE: `http://127.0.0.1:${outlayer.address().port}`, CLOB_BASE: `http://127.0.0.1:${clob.address().port}` };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); outlayer.close(); clob.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 400; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const site = async (method, path, cookie, body) => {
  const r = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const agent = async (key, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const C = production.contracts;
const orderTypes = { EIP712Domain: [], Order: [{ name: 'tokenId', type: 'uint256' }] };
const order = (dollars, side = 0, exchange = C.exchangeV3, price = 0.5) => ({ domain: { name: 'Polymarket CTF Exchange', version: '3', chainId: 137, verifyingContract: exchange }, primaryType: 'Order', types: orderTypes,
  message: { maker: '0x' + '1'.repeat(40), signer: ADDR, tokenId: '123', makerAmount: String(Math.round((side === 0 ? dollars : dollars / price) * 1e6)), takerAmount: String(Math.round((side === 0 ? dollars / price : dollars) * 1e6)), side, signatureType: 3, salt: '1', timestamp: '1', metadata: '0x' + '0'.repeat(64), builder: '0x' + '0'.repeat(64) } });
const wrapped = (dollars) => { const o = order(dollars); return { ...o, primaryType: 'TypedDataSign', message: { contents: o.message, name: 'x', version: '1', chainId: 137, verifyingContract: ADDR, salt: '0x' + '0'.repeat(64) } }; };
const pad = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const batch = (target, selector, who) => ({ domain: { chainId: 137, verifyingContract: '0x' + '2'.repeat(40) }, primaryType: 'Batch', types: { Batch: [] }, message: { wallet: '0x' + '2'.repeat(40), nonce: '0', deadline: '0', calls: [{ target, value: '0', data: selector + pad(who) + 'f'.repeat(64) }] } });

let ann, key;
test('a person connects their own wallet with their own limits, and it starts switched off', async () => {
  await ready();
  ann = signup('ann'); key = (await site('POST', '/api/agent-keys', ann, { canTrade: true })).body.token;
  assert.equal((await site('POST', '/api/agent-wallet', ann, { key: 'nope', maxOrder: 5, maxDay: 10 })).status, 400);
  assert.equal((await site('POST', '/api/agent-wallet', ann, { key: 'wk_wrongkey1234567890abcdef', maxOrder: 5, maxDay: 10 })).status, 400);
  assert.equal((await site('POST', '/api/agent-wallet', ann, { key: 'wk_goodkey1234567890abcdef', maxOrder: 50, maxDay: 10 })).status, 400);   // per order over per day
  const r = await site('POST', '/api/agent-wallet', ann, { key: 'wk_goodkey1234567890abcdef', maxOrder: 250, maxDay: 1000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ ...r.body.wallet, connectedAt: 0 }, { provider: 'outlayer', address: ADDR, enabled: false, maxOrder: 250, maxDay: 1000, spentToday: 0, connectedAt: 0 });
  assert.equal(JSON.stringify(r.body).includes('wk_'), false);                                  // the key never comes back
  const db = new Database(join(dir, 'clue.sqlite')); const row = db.prepare('SELECT key_sealed FROM agent_wallets').get(); db.close();
  assert.equal(row.key_sealed.includes('goodkey'), false);                                       // and is stored sealed
  assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: order(1) })).status, 403);   // off until they switch it on
});

test('orders within the limits are signed, and anything over them is refused before OutLayer is asked', async () => {
  assert.equal((await site('PATCH', '/api/agent-wallet', ann, { enabled: true })).body.wallet.enabled, true);
  seen.length = 0;
  const ok = await agent(key, 'POST', '/api/agent/sign', { typedData: order(200) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.signature, SIG);
  assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: wrapped(240) })).status, 200);
  assert.match((await agent(key, 'POST', '/api/agent/sign', { typedData: order(300) })).body.error, /over your limit of \$250 per order/);
  for (let i = 0; i < 2; i++) assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: order(250) })).status, 200);
  const day = await agent(key, 'POST', '/api/agent/sign', { typedData: order(100) });
  assert.match(day.body.error, /over your limit of \$1000 a day/);                                // 200+240+250+250 = 940 already
  assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: order(5000, 1) })).status, 200);   // selling what you hold is not spending
  assert.equal(seen.length, 5);                                                                    // refusals never reached OutLayer
  assert.equal((await agent(key, 'GET', '/api/agent/wallet')).body.wallet.spentToday, 940);
  await site('PATCH', '/api/agent-wallet', ann, { maxDay: 5000 });                                // the person can raise it
  assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: order(100) })).status, 200);
});

test('only sign-in, Polymarket orders and Polymarket permissions are signed', async () => {
  const sign = (td) => agent(key, 'POST', '/api/agent/sign', { typedData: td });
  const auth = { domain: { name: 'ClobAuthDomain', version: '1', chainId: 137 }, primaryType: 'ClobAuth', types: { ClobAuth: [] }, message: { address: ADDR, timestamp: '1', nonce: 0, message: 'x' } };
  assert.equal((await sign(auth)).status, 200);
  assert.equal((await sign({ ...auth, message: { ...auth.message, address: '0x' + '9'.repeat(40) } })).status, 403);
  assert.equal((await sign(order(1, 0, '0x' + '7'.repeat(40)))).status, 403);                                     // someone else's "exchange"
  assert.equal((await sign(batch(C.collateralToken, '0x095ea7b3', C.exchangeV3))).status, 200);                 // pUSD permission for the exchange
  assert.equal((await sign(batch(C.conditionalTokens, '0xa22cb465', C.negRiskAdapter))).status, 200);
  assert.equal((await sign(batch(C.collateralToken, '0x095ea7b3', '0x' + '6'.repeat(40)))).status, 403);       // permission for anyone else
  assert.equal((await sign(batch(C.collateralToken, '0xa9059cbb', '0x' + '6'.repeat(40)))).status, 403);       // a transfer
  assert.equal((await sign({ ...auth, primaryType: 'Withdraw', message: {} })).status, 403);
  assert.equal((await sign({ ...auth, domain: { ...auth.domain, chainId: 1 } })).status, 403);
});

test('the key\'s owner only: other people, cookies and switched-off wallets get nothing', async () => {
  const bob = signup('bob'); const bobKey = (await site('POST', '/api/agent-keys', bob, { canTrade: true })).body.token;
  assert.equal((await agent(bobKey, 'POST', '/api/agent/sign', { typedData: order(1) })).status, 404);   // Bob has no wallet; Ann's is not his
  assert.equal((await agent('clue_ak_' + '0'.repeat(48), 'GET', '/api/agent/wallet')).status, 401);
  assert.equal((await fetch(base + '/api/agent/sign', { method: 'POST', headers: { Cookie: ann, Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await site('GET', '/api/agent-wallet', bob)).body.wallet, null);
  await site('PATCH', '/api/agent-wallet', ann, { enabled: false });
  assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: order(1) })).status, 403);
  assert.equal((await agent(key, 'POST', '/api/pm/sign', { method: 'POST', path: '/order', body: '{}' })).status, 403);
  assert.equal((await site('DELETE', '/api/agent-wallet', ann)).body.removed, true);
  assert.equal((await agent(key, 'POST', '/api/agent/sign', { typedData: order(1) })).status, 404);
});

test('orders far from the market price are refused, and so is everything when the price cannot be read', async () => {
  const cara = signup('cara'); const k = (await site('POST', '/api/agent-keys', cara, { canTrade: true })).body.token;
  await site('POST', '/api/agent-wallet', cara, { key: 'wk_goodkey1234567890abcdef', maxOrder: 100, maxDay: 1000 });
  await site('PATCH', '/api/agent-wallet', cara, { enabled: true });
  const sign = (td) => agent(k, 'POST', '/api/agent/sign', { typedData: td });
  mid = '0.40';
  assert.equal((await sign(order(10, 0, C.exchangeV3, 0.44))).status, 200);                       // a buy a little above the market
  assert.match((await sign(order(10, 0, C.exchangeV3, 0.95))).body.error, /above the market/);    // a buy far above it
  assert.equal((await sign(order(10, 1, C.exchangeV3, 0.37))).status, 200);                       // a sell a little below
  assert.match((await sign(order(10, 1, C.exchangeV3, 0.02))).body.error, /below the market/);    // dumping shares for nothing
  clobUp = false;
  assert.match((await sign(order(10, 0, C.exchangeV3, 0.40))).body.error, /could not read this market/);
  clobUp = true; mid = '0.5';
  const log = (await site('GET', '/api/agent-wallet', cara)).body.activity;
  assert.deepEqual(log.map((x) => x.status), ['refused', 'refused', 'signed', 'refused', 'signed']);   // newest first, every decision kept
});

test('orders sent at the same moment cannot slip past the daily limit together', async () => {
  const dan = signup('dan'); const k = (await site('POST', '/api/agent-keys', dan, { canTrade: true })).body.token;
  await site('POST', '/api/agent-wallet', dan, { key: 'wk_goodkey1234567890abcdef', maxOrder: 60, maxDay: 100 });
  await site('PATCH', '/api/agent-wallet', dan, { enabled: true });
  signDelay = 300;
  const results = await Promise.all([1, 2, 3, 4].map(() => agent(k, 'POST', '/api/agent/sign', { typedData: order(40) })));
  signDelay = 0;
  assert.equal(results.filter((r) => r.status === 200).length, 2);                                   // 40 + 40 fits in 100; a third would not
  assert.equal((await agent(k, 'GET', '/api/agent/wallet')).body.wallet.spentToday, 80);
});

test('a read-only key cannot ask for trades', async () => {
  const eve = signup('eve2'); const ro = (await site('POST', '/api/agent-keys', eve, {})).body;
  assert.equal(ro.canTrade, false);
  await site('POST', '/api/agent-wallet', eve, { key: 'wk_goodkey1234567890abcdef', maxOrder: 10, maxDay: 10 });
  await site('PATCH', '/api/agent-wallet', eve, { enabled: true });
  assert.match((await agent(ro.token, 'POST', '/api/agent/sign', { typedData: order(1) })).body.error, /can only read/);
  assert.equal((await agent(ro.token, 'POST', '/api/pm/sign', { method: 'POST', path: '/order', body: '{}' })).status, 403);
  assert.equal((await agent(ro.token, 'GET', '/api/agent/wallet')).status, 200);
});
