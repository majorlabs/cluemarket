import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = await mkdtemp(join(tmpdir(), 'clue-pw-'));
process.env.CLUE_DATA_DIR = dir;
const { pickWallet, privyWalletRoute } = await import('../privy-auth.mjs');

const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';

test('picks the wallet made for the user, else one they connected', () => {
  const made = { type: 'wallet', address: A, chain_type: 'ethereum', wallet_client_type: 'privy', connector_type: 'embedded' };
  const own = { type: 'wallet', address: B, chain_type: 'ethereum', wallet_client_type: 'metamask' };
  assert.deepEqual(pickWallet([own, made]), { address: A, madeForYou: true });
  assert.deepEqual(pickWallet([own]), { address: B, madeForYou: false });
  assert.deepEqual(pickWallet([{ type: 'email', address: 'a@b.c' }, made]), { address: A, madeForYou: true });
});

test('ignores anything that is not a plain Ethereum address', () => {
  assert.equal(pickWallet([]), null);
  assert.equal(pickWallet(undefined), null);
  assert.equal(pickWallet([{ type: 'email', address: 'a@b.c' }]), null);
  assert.equal(pickWallet([{ type: 'wallet', address: 'near.near', chain_type: 'ethereum' }]), null);
  assert.equal(pickWallet([{ type: 'wallet', address: '0x123', chain_type: 'ethereum' }]), null);
  assert.equal(pickWallet([{ type: 'wallet', address: A, chain_type: 'solana' }]), null);   // wrong chain
  assert.equal(pickWallet([null, 5, 'x']), null);
});

test('only Privy accounts are looked up', async () => {
  assert.deepEqual(await privyWalletRoute('near:alice.near'), { wallet: null, reason: 'not-privy' });
  assert.deepEqual(await privyWalletRoute(undefined), { wallet: null, reason: 'not-privy' });
  assert.deepEqual(await privyWalletRoute('privy:../../etc'), { wallet: null, reason: 'not-privy' });
});

// ---- through the real server ----
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir };
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

test('server: sign-in required; a NEAR user gets no wallet lookup', async () => {
  await ready();
  assert.equal((await fetch(base + '/api/privy/wallet')).status, 401);
  const near = signup('near:alice.near', 'alice.near');
  const r = await fetch(base + '/api/privy/wallet', { headers: { Cookie: near } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { wallet: null, reason: 'not-privy' });
});

test('an email is never sent back to the browser, even if one was stored as the account name', async () => {
  const cookie = signup('privy:did:privy:cmemail1', 'private.person@example.com');       // an older session that stored the email as its name
  const r = await fetch(base + '/api/wallet/session', { headers: { Cookie: cookie } });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.ok(!/@|example\.com|private\.person/.test(text), text);
  assert.equal(JSON.parse(text).user.name, 'Account');
  // NEAR accounts are public by nature, so their account name is still shown
  const near = signup('near:zoe.near', 'zoe.near');
  assert.equal((await (await fetch(base + '/api/wallet/session', { headers: { Cookie: near } })).json()).user.name, 'zoe.near');
});
