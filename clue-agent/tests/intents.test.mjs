// Funding from NEAR or another chain through NEAR Intents: what is offered, what is refused, what is asked of the service, and what is shown back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { offered, quote, status, toUnits, checkRefund, forgetTokens, forgetFloor, limits, MIN_FLOOR_USD, MAX_USD } from '../intents.mjs';

const WALLET = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const BRIDGE_EVM = '0xcCBa13a8d2803b2Ed5c9576796A03b4b6bCb917d';
const TOKENS = [
  { assetId: 'nep141:wrap.near', blockchain: 'near', symbol: 'wNEAR', decimals: 24, price: 3.5 },
  { assetId: 'nep141:base-usdc.omft.near', blockchain: 'base', symbol: 'USDC', decimals: 6, price: 1 },
  { assetId: 'nep141:eth-weird.omft.near', blockchain: 'eth', symbol: 'SHITCOIN', decimals: 18, price: 1 },
  { assetId: 'nep245:polygon-usdc', blockchain: 'pol', symbol: 'USDC', decimals: 6, price: 1 },
];
const NEAR_ACCOUNT = 'alice.near';

// One fake service that plays NEAR Intents, Polymarket's deposit service and a NEAR node.
function fakeServices() {
  const seen = { quotes: [], auth: [], bridge: [], status: [] };
  const state = { bridgeOk: true, floor: 2, quoteStatus: 201, statusBody: { status: 'PENDING_DEPOSIT' } };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/v0/tokens') return send(200, TOKENS);
    if (url.pathname === '/v0/quote') {
      const q = JSON.parse(body); seen.quotes.push(q); seen.auth.push(req.headers.authorization || null);
      if (state.quoteStatus !== 201) return send(state.quoteStatus, { message: 'Internal server error' });
      return send(201, { quote: { amountOutFormatted: '6.96', amountOutUsd: '6.96', minAmountOutFormatted: '6.89', timeEstimate: 24, ...(q.dry ? {} : { depositAddress: 'a'.repeat(64), deadline: '2026-11-09T09:00:00.000Z' }) } });
    }
    if (url.pathname === '/v0/status') { seen.status.push(url.searchParams.get('depositAddress')); return send(200, state.statusBody); }
    if (url.pathname === '/supported-assets') return send(200, { supportedAssets: [{ chainName: 'Polygon', token: { symbol: 'USDC' }, minCheckoutUsd: state.floor }, { chainName: 'Polygon', token: { symbol: 'USDC.e' }, minCheckoutUsd: 99 }, { chainName: 'Ethereum', token: { symbol: 'USDC' }, minCheckoutUsd: 7 }] });
    if (url.pathname === '/deposit') { seen.bridge.push(JSON.parse(body).address); return state.bridgeOk ? send(201, { address: { evm: BRIDGE_EVM, svm: 'x', btc: 'y', tron: 'z' } }) : send(500, {}); }
    if (url.pathname === '/rpc') { const p = JSON.parse(body).params; return send(200, p.account_id === NEAR_ACCOUNT ? { result: { amount: '1' } } : { error: { name: 'UNKNOWN_ACCOUNT' } }); }
    send(404, {});
  });
  return { server, seen, state };
}
const { server: fake, seen, state } = fakeServices();
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const P = fake.address().port;
process.env.ONECLICK_BASE = `http://127.0.0.1:${P}/v0`; process.env.POLYMARKET_BRIDGE_BASE = `http://127.0.0.1:${P}`; process.env.NEAR_RPC_URL = `http://127.0.0.1:${P}/rpc`;
const deps = { jwt: 'jwt-secret' };
const NEAR_ASSET = 'nep141:wrap.near', BASE_ASSET = 'nep141:base-usdc.omft.near';

test('only listed coins are offered, with the Polygon USDC receive side', async () => {
  forgetTokens();
  const o = await offered();
  assert.deepEqual(o.assets.map((a) => `${a.symbol}/${a.chainName}`), ['wNEAR/NEAR', 'USDC/Base']);   // the unlisted coin is not offered
  assert.equal(o.dest.assetId, 'nep245:polygon-usdc');
});

test('amounts are plain decimals that fit the coin', () => {
  assert.equal(toUnits('2', 24), 2n * 10n ** 24n);
  assert.equal(toUnits('2.5', 6), 2500000n);
  assert.equal(toUnits('0.0000001', 6), null);                                  // more places than the coin has
  for (const bad of ['', '-1', '1e6', '1,5', ' 5', 'abc', '0x10', null, 5]) assert.equal(toUnits(bad, 6), null, String(bad));
});

test('a refund address must suit its chain; a NEAR account must exist', async () => {
  assert.equal(await checkRefund('evm', WALLET), WALLET);
  await assert.rejects(checkRefund('evm', '0x123'), /0x followed by 40/);
  await assert.rejects(checkRefund('sol', 'not base58 0OIl'), /Solana/);
  assert.equal(await checkRefund('near', NEAR_ACCOUNT), NEAR_ACCOUNT);
  await assert.rejects(checkRefund('near', 'nobody-home.near'), /not found/);
  await assert.rejects(checkRefund('near', 'Not A Name'), /yourname\.near/);
  await assert.rejects(checkRefund('near', ''), /yourname\.near/);
});

test('a price check asks NEAR Intents for the right swap, to the address Polymarket gave, and shows only safe fields', async () => {
  seen.quotes.length = 0; seen.bridge.length = 0;
  const q = await quote({ assetId: NEAR_ASSET, amount: '2', refundTo: NEAR_ACCOUNT, wallet: WALLET, dry: true }, deps);
  const sent = seen.quotes[0];
  assert.equal(sent.dry, true);
  assert.equal(sent.originAsset, NEAR_ASSET);
  assert.equal(sent.destinationAsset, 'nep245:polygon-usdc');
  assert.equal(sent.amount, (2n * 10n ** 24n).toString());
  assert.equal(sent.recipient, BRIDGE_EVM);                                      // Polymarket's address, not the wallet and not from the browser
  assert.equal(sent.recipientType, 'DESTINATION_CHAIN');
  assert.equal(sent.refundTo, NEAR_ACCOUNT); assert.equal(sent.refundType, 'ORIGIN_CHAIN');
  assert.equal(sent.swapType, 'EXACT_INPUT'); assert.equal(sent.referral, 'clue');
  assert.equal(seen.bridge[0], WALLET);
  assert.equal(seen.auth[0], 'Bearer jwt-secret');
  assert.equal(q.depositAddress, undefined);
  assert.deepEqual(q.send, { symbol: 'wNEAR', chain: 'NEAR', amount: '2', usd: 7 });
  assert.equal(q.receive.amount, '6.96'); assert.equal(q.seconds, 24);
  assert.ok(!JSON.stringify(q).includes('jwt-secret'));
});

test('asking for the real thing returns a deposit address and a deadline', async () => {
  const q = await quote({ assetId: BASE_ASSET, amount: '5', refundTo: WALLET, wallet: WALLET, dry: false }, deps);
  assert.equal(seen.quotes.at(-1).dry, false);
  assert.equal(q.depositAddress, 'a'.repeat(64)); assert.match(q.deadline, /^2026-/);
});

test('each unsafe or silly request is refused before any money can move', async () => {
  const ok = { assetId: NEAR_ASSET, amount: '2', refundTo: NEAR_ACCOUNT, wallet: WALLET, dry: false };
  const before = seen.quotes.length;
  await assert.rejects(quote({ ...ok, assetId: 'nep141:eth-weird.omft.near' }, deps), /listed coins/);
  await assert.rejects(quote({ ...ok, assetId: 'made-up' }, deps), /listed coins/);
  await assert.rejects(quote({ ...ok, amount: '0.1' }, deps), /smallest amount is about \$2\.50/);   // under the floor
  await assert.rejects(quote({ ...ok, amount: '0.7' }, deps), /smallest amount is about \$2\.50/);   // $2.45: under the floor
  await assert.rejects(quote({ ...ok, amount: '15000' }, deps), /most you can add at once is about \$50,000/);   // $52,500: over the ceiling
  await assert.rejects(quote({ ...ok, amount: '1e3' }, deps), /Enter an amount/);
  await assert.rejects(quote({ ...ok, refundTo: 'nobody-home.near' }, deps), /not found/);
  await assert.rejects(quote({ ...ok, wallet: '0xabc' }, deps), /Set up trading first/);
  state.bridgeOk = false;
  await assert.rejects(quote(ok, deps), /Polymarket could not give a deposit address/);
  state.bridgeOk = true;
  assert.equal(seen.quotes.length, before);                                      // none of those reached NEAR Intents
});

test('when NEAR Intents cannot do it, the person gets a plain sentence, not the provider\'s error', async () => {
  state.quoteStatus = 400;
  await assert.rejects(quote({ assetId: NEAR_ASSET, amount: '2', refundTo: NEAR_ACCOUNT, wallet: WALLET, dry: true }, deps),
    (e) => e.status === 502 && /not available right now/.test(e.message) && !/Internal server error|400/.test(e.message));
  state.quoteStatus = 201;
});

test('status is one plain word, with what arrived once it is done', async () => {
  const addr = 'b'.repeat(64);
  for (const [raw, word] of [['PENDING_DEPOSIT', 'waiting'], ['KNOWN_DEPOSIT_TX', 'seen'], ['PROCESSING', 'swapping'], ['REFUNDED', 'refunded'], ['FAILED', 'failed'], ['INCOMPLETE_DEPOSIT', 'short']]) {
    state.statusBody = { status: raw };
    assert.equal((await status(addr, deps)).state, word, raw);
  }
  state.statusBody = { status: 'SUCCESS', swapDetails: { amountOutFormatted: '6.96', amountOutUsd: '6.95' } };
  assert.deepEqual(await status(addr, deps), { state: 'done', delivered: { amount: '6.96', usd: 6.95 } });
  await assert.rejects(status('../etc/passwd', deps), /does not look right/);
  await assert.rejects(status('short', deps), /does not look right/);
});

// ---- through the real server ----
const dir = await mkdtemp(join(tmpdir(), 'clue-intents-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, ONECLICK_JWT: 'server-jwt-secret' };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); fake.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 300; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const call = async (method, path, cookie, body) => {
  const r = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', Origin: base } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
};
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};

test('server: the coin list is public; prices, deposit addresses and status need a sign-in', async () => {
  await ready();
  const list = await call('GET', '/api/fund/intents/assets');
  assert.equal(list.status, 200); assert.equal(JSON.parse(list.text).assets.length, 2);
  assert.ok(!list.text.includes('server-jwt-secret'));
  const body = { assetId: NEAR_ASSET, amount: '2', refundTo: NEAR_ACCOUNT, wallet: WALLET, dry: true };
  assert.equal((await call('POST', '/api/fund/intents/quote', null, body)).status, 401);
  assert.equal((await call('GET', `/api/fund/intents/status?deposit=${'c'.repeat(64)}`)).status, 401);
  const cookie = signup('carol');
  const ok = await call('POST', '/api/fund/intents/quote', cookie, body);
  assert.equal(ok.status, 200); assert.equal(JSON.parse(ok.text).receive.amount, '6.96');
  assert.ok(!ok.text.includes('server-jwt-secret'));
  assert.equal(seen.auth.at(-1), 'Bearer server-jwt-secret');                    // the server's key is used, and never shown
  assert.equal((await call('POST', '/api/fund/intents/quote', cookie, { ...body, amount: '0.1' })).status, 400);
  assert.equal((await call('GET', `/api/fund/intents/status?deposit=${'c'.repeat(64)}`, cookie)).status, 200);
});

test('server: a person can ask for at most 10 real deposit addresses an hour', async () => {
  const cookie = signup('dave');
  const real = { assetId: NEAR_ASSET, amount: '2', refundTo: NEAR_ACCOUNT, wallet: WALLET, dry: false };
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/fund/intents/quote', cookie, real);
  assert.equal(last.status, 429);
});

test('the limits: $2.50 at least, or a little above Polymarket\'s own floor if that is higher; $50,000 at most', async () => {
  forgetFloor(); state.floor = 2;
  assert.deepEqual(await limits(), { minUsd: 2.5, maxUsd: 50000 });
  assert.equal(MIN_FLOOR_USD, 2.5); assert.equal(MAX_USD, 50000);
  forgetFloor(); state.floor = 4;                                              // Polymarket raises its floor: Clue follows
  assert.equal((await limits()).minUsd, 4);
  const ok = { assetId: 'nep141:wrap.near', amount: '1', refundTo: 'alice.near', wallet: WALLET, dry: true };      // 1 wNEAR = $3.50
  await assert.doesNotReject(quote({ ...ok, amount: '1.2' }, deps));                                                   // $4.20
  await assert.rejects(quote(ok, deps), /smallest amount is about \$4\.00/);                                       // $3.50 is now under
  forgetFloor(); state.floor = 2;
  await assert.doesNotReject(quote({ ...ok, amount: '0.72' }, deps));                                                  // $2.52: just over $2.50
  const big = await quote({ ...ok, amount: '14000' }, deps);                                                           // $49,000: allowed
  assert.equal(big.send.amount, '14000');
});
