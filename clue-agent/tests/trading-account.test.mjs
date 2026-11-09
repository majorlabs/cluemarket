// The server remembers each person's trading account, so a new phone or a cleared browser does not ask them to set up again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = await mkdtemp(join(tmpdir(), 'clue-acct-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 300; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const call = async (method, path, cookie, body) => {
  const r = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', Origin: base } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const W1 = '0x1111111111111111111111111111111111111111', S1 = '0x2222222222222222222222222222222222222222', W2 = '0x3333333333333333333333333333333333333333';

test('sign-in is required, and nothing is remembered until setup is done', async () => {
  await ready();
  assert.equal((await call('GET', '/api/trading/account')).status, 401);
  assert.equal((await call('POST', '/api/trading/account', null, { wallet: W1 })).status, 401);
  const cookie = signup('erin');
  assert.deepEqual((await call('GET', '/api/trading/account', cookie)).body, { account: null });
});

test('a saved account comes back on any device, is updated in place, and belongs to one person only', async () => {
  const erin = signup('erin2'), frank = signup('frank');
  assert.equal((await call('POST', '/api/trading/account', erin, { wallet: W1, signer: S1 })).status, 200);
  assert.deepEqual((await call('GET', '/api/trading/account', erin)).body, { account: { wallet: W1, signer: S1 } });
  assert.deepEqual((await call('GET', '/api/trading/account', frank)).body, { account: null });              // not shared
  await call('POST', '/api/trading/account', erin, { wallet: W2, signer: S1 });                                // corrected later
  assert.equal((await call('GET', '/api/trading/account', erin)).body.account.wallet, W2);
  await call('POST', '/api/trading/account', frank, { wallet: W1 });                                           // no signer given
  assert.deepEqual((await call('GET', '/api/trading/account', frank)).body, { account: { wallet: W1, signer: null } });
});

test('only a well-formed address is accepted', async () => {
  const cookie = signup('gina');
  for (const wallet of ['', 'nope', '0x123', '<script>', W1 + '0', undefined]) assert.equal((await call('POST', '/api/trading/account', cookie, { wallet })).status, 400, String(wallet));
  assert.equal((await call('POST', '/api/trading/account', cookie, { wallet: W1, signer: 'junk' })).status, 200);
  assert.equal((await call('GET', '/api/trading/account', cookie)).body.account.signer, null);                // a junk signer is dropped, not stored
});
