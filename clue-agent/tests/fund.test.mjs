import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { toUnits, checkRequest, fundingQuote, SOURCES } from '../fund.mjs';

const ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const goodBody = { code: 0, msg: 'success', data: { bestQuote: { router: 'rango', routerName: 'Rango', amountOut: '24950394', minAmountOut: '24825642', timeEstimate: 30, fee: [{ expenseType: 'FROM_SOURCE_WALLET', amount: '1112832000000', token: { symbol: 'ETH', decimals: 18, usdPrice: 2236.11 } }] } } };

test('amounts: only plain decimals with up to 6 places become units', () => {
  assert.equal(toUnits('25', 6), 25000000n);
  assert.equal(toUnits('25.5', 6), 25500000n);
  assert.equal(toUnits('0.000001', 6), 1n);
  for (const bad of ['', '-1', '1e6', '1,5', '1.1234567', ' 5', '5 ', 'abc', '0x10', null, 5, '1'.repeat(10)]) assert.equal(toUnits(bad, 6), null, String(bad));
});

test('requests: source must be listed, address well formed, amount in range', () => {
  const ok = { source: SOURCES[0].id, amount: '25', address: ADDR };
  assert.ok(!checkRequest(ok).error);
  assert.ok(checkRequest({ ...ok, source: 'solana-sol' }).error);
  assert.ok(checkRequest({ ...ok, address: '0x123' }).error);
  assert.ok(checkRequest({ ...ok, address: 'near.near' }).error);
  assert.ok(checkRequest({ ...ok, amount: '0.5' }).error);          // under the $1 minimum
  assert.ok(checkRequest({ ...ok, amount: '10001' }).error);         // over the $10,000 limit
});

test('a good quote is reported with cost, minimum, gas in dollars and no key', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { json: async () => goodBody }; };
  const q = await fundingQuote({ source: 'base-usdc', amount: '25', address: ADDR }, { fetchImpl, key: 'secret-key', base: 'https://rhea.test' });
  assert.equal(seen.url, 'https://rhea.test/api/v2/swap/quote');
  assert.equal(seen.init.headers.Authorization, 'Bearer secret-key');
  const sent = JSON.parse(seen.init.body);
  assert.equal(sent.amountIn, '25000000'); assert.equal(sent.toChain, '137'); assert.equal(sent.tokenOut, '0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb');
  assert.equal(q.receive, 24.950394); assert.equal(q.minimumReceive, 24.825642);
  assert.equal(q.costUsd, 0.0496); assert.equal(q.networkFeeUsd, 0.0025); assert.equal(q.seconds, 30);
  assert.ok(!JSON.stringify(q).includes('secret-key'));
  assert.match(q.note, /Nothing has been sent/);
});

test('provider failures become one plain sentence, never the provider text', async () => {
  const fail = { code: -1, msg: 'Cross-chain quote failed: stableflow: StableFlow HTTP 403 ... 非法请求 ... 1click.chaindefuser.com' };
  await assert.rejects(fundingQuote({ source: 'base-usdc', amount: '25', address: ADDR }, { fetchImpl: async () => ({ json: async () => fail }), key: 'k' }), e => e.status === 502 && !/chaindefuser|stableflow|403/i.test(e.message));
  await assert.rejects(fundingQuote({ source: 'base-usdc', amount: '25', address: ADDR }, { fetchImpl: async () => { throw new Error('ECONNRESET secret-key'); }, key: 'k' }), e => e.status === 502 && !/ECONN|secret/.test(e.message));
  await assert.rejects(fundingQuote({ source: 'base-usdc', amount: '25', address: ADDR }, { fetchImpl: async () => ({ json: async () => ({ code: 0, data: { bestQuote: { router: 'x', amountOut: 'NaN', minAmountOut: '1' } } }) }), key: 'k' }), e => e.status === 502);
  await assert.rejects(fundingQuote({ source: 'base-usdc', amount: '25', address: ADDR }, { fetchImpl: async () => ({}), key: '' }), e => e.status === 503);
});

// ---- through the real server, with a stand-in for Rhea ----
let lastAuth = null, calls = 0;
const fake = http.createServer((req, res) => { calls++; lastAuth = req.headers.authorization; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(goodBody)); });
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-fund-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, RHEA_API_KEY: 'server-secret-key', RHEA_API_BASE: `http://127.0.0.1:${fake.address().port}` };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise(r => server.once('exit', r)); fake.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const get = async (path, cookie) => { const r = await fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} }); return { status: r.status, text: await r.text() }; };
const signup = name => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};

test('server: sign-in required, inputs checked before Rhea is called, key never reaches the browser', async () => {
  await ready();
  const q = `/api/fund/quote?source=base-usdc&amount=25&address=${ADDR}`;
  assert.equal((await get(q)).status, 401);
  const cookie = signup('alice');
  assert.equal((await get('/api/fund/quote?source=nope&amount=25&address=' + ADDR, cookie)).status, 400);
  assert.equal((await get('/api/fund/quote?source=base-usdc&amount=abc&address=' + ADDR, cookie)).status, 400);
  assert.equal(calls, 0);                                  // bad requests never reach Rhea
  const ok = await get(q, cookie);
  assert.equal(ok.status, 200);
  assert.equal(calls, 1);
  assert.equal(lastAuth, 'Bearer server-secret-key');
  assert.ok(!ok.text.includes('server-secret-key'));
  assert.equal(JSON.parse(ok.text).receive, 24.950394);
  const options = await get('/api/fund/options');
  assert.equal(options.status, 200);
  assert.ok(!options.text.includes('server-secret-key'));
});

test('server: a user is limited to 30 quotes an hour', async () => {
  const cookie = signup('bob');
  const q = `/api/fund/quote?source=base-usdc&amount=25&address=${ADDR}`;
  let last;
  for (let i = 0; i < 31; i++) last = await get(q, cookie);
  assert.equal(last.status, 429);
});
