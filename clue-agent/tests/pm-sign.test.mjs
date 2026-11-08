import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { builderApiKey } from '@polymarket/client/node';
import { builderHeaders, checkSignRequest } from '../pm-sign.mjs';

const creds = { key: 'test-key', secret: Buffer.from('a secret that is not real, only for tests').toString('base64url'), passphrase: 'test-pass' };
const ME = '0x1111111111111111111111111111111111111111', OTHER = '0x2222222222222222222222222222222222222222';

test("the headers are exactly what Polymarket's own package produces", async () => {
  const realNow = Date.now; Date.now = () => 1_800_000_123_456;
  try {
    for (const input of [
      { method: 'GET', path: '/deployed?address=0xabc&type=WALLET' },
      { method: 'POST', path: '/submit', body: JSON.stringify({ from: ME, data: '0x', nonce: '7' }) },
      { method: 'GET', path: '/v1/account/transactions/params?address=0xabc', body: undefined },
    ]) {
      const theirs = await builderApiKey(creds).authorize(input);
      const ours = builderHeaders(input, { ...creds, now: Date.now() });
      assert.deepEqual(ours, theirs, JSON.stringify(input));
    }
  } finally { Date.now = realNow; }
});

test('only the four relayer requests Clue needs can be signed', () => {
  const ok = (m, p, b) => checkSignRequest({ method: m, path: p, body: b }, ME).ok;
  const post = JSON.stringify({ from: ME });
  assert.ok(ok('GET', '/deployed?address=0xabc&type=WALLET'));
  assert.ok(ok('GET', '/v1/account/transactions/params?address=0xabc&type=WALLET'));
  assert.ok(ok('GET', '/v1/account/transactions/0190a7c2-1111-7000-8000-abcdef012345'));
  assert.ok(ok('POST', '/submit', post));
  for (const [m, p] of [['GET', '/'], ['GET', '/submit'], ['POST', '/deployed?address=0xabc'], ['POST', '/v1/session-signers/authorizations'], ['POST', '/v1/session-signers/revocations'],
    ['GET', '/v1/account/transactions/../../admin'], ['GET', '/deployed?address=0xabc#frag'], ['GET', '/deployed?address=<script>'], ['DELETE', '/submit'], ['POST', '/submit/'], ['POST', '/Submit']])
    assert.ok(!ok(m, p, post), `${m} ${p} should not be signed`);
});

test("a request to act for someone else's wallet is refused", () => {
  const r = (body) => checkSignRequest({ method: 'POST', path: '/submit', body }, ME);
  assert.ok(r(JSON.stringify({ from: ME.toUpperCase().replace('0X', '0x') })).ok);          // case does not matter
  assert.equal(r(JSON.stringify({ from: OTHER })).status, 403);
  assert.equal(r(JSON.stringify({})).status, 403);
  assert.equal(r('not json').status, 400);
  assert.equal(r(undefined).status, 400);
  assert.equal(r('x'.repeat(20001)).status, 400);
  assert.equal(r(JSON.stringify({ from: ME, junk: 'x'.repeat(30000) })).status, 400);       // over the size limit
});

test('no wallet means nothing is signed, and bad input is refused', () => {
  for (const wallet of [undefined, null, '', 'near.near', '0x123', 5])
    assert.equal(checkSignRequest({ method: 'GET', path: '/deployed?address=0xabc' }, wallet).status, 403);
  for (const input of [null, undefined, 'x', 5, {}, { method: 5, path: '/deployed?a=b' }, { method: 'GET', path: 'x'.repeat(301) }, { method: 'GET', path: '/deployed?a=b', body: 'x' }, { method: 'GET', path: '/deployed?a=b', body: 5 }])
    assert.equal(checkSignRequest(input, ME).ok, false, JSON.stringify(input));
});

// ---- through the real server ----
const dir = await mkdtemp(join(tmpdir(), 'clue-pmsign-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, POLYMARKET_BUILDER_API_KEY: 'k-from-env', POLYMARKET_BUILDER_SECRET: creds.secret, POLYMARKET_BUILDER_PASSPHRASE: 'p-from-env' };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'PRIVY_APP_ID', 'PRIVY_APP_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const signup = (id, name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(id, name, id + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, name, Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const sign = (cookie, body, origin = base) => fetch(base + '/api/pm/sign', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

test('server: signed-out and NEAR accounts get nothing, and no secret is ever returned', async () => {
  await ready();
  const req = { method: 'GET', path: '/deployed?address=0xabc&type=WALLET' };
  assert.equal((await sign(null, req)).status, 401);
  const near = await sign(signup('near:alice.near', 'alice.near'), req);
  assert.equal(near.status, 403);
  const text = await near.text();
  assert.ok(!text.includes('k-from-env') && !text.includes(creds.secret) && !text.includes('p-from-env'));
  assert.equal((await sign(signup('privy:did:privy:cmx1', 'x@y.z'), req)).status, 403);      // Privy account with no wallet found
  assert.equal((await sign(signup('near:bob.near', 'bob.near'), req, 'https://evil.example')).status, 403);   // another site cannot ask
});
