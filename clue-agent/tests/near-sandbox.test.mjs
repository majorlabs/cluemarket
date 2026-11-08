// NEAR wallet sign-in against a real local NEAR chain (near-kit sandbox): no mainnet, no faucet, no real tokens.
// Needs the sandbox binary to start, which needs the process to be allowed 65,535 open files. Where it cannot start
// (some containers cap the limit), these tests are skipped with the reason, never failed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from '@near-js/crypto';

const dir = mkdtempSync(join(tmpdir(), 'clue-sbx-'));
process.env.CLUE_DATA_DIR = dir;
const { messageDigest } = await import('../wallet-auth.mjs');

let sandbox = null, why = '';
try {
  const { Sandbox, EMPTY_CODE_HASH } = await import('near-kit/sandbox');
  sandbox = await Sandbox.start();
  var CODE_HASH = EMPTY_CODE_HASH;
} catch (e) { why = 'the local NEAR chain could not start here: ' + String(e.message || e).split('\n')[0].slice(0, 160); }

let server = null;
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
if (sandbox) {
  const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, NEAR_RPC_URL: sandbox.rpcUrl };
  for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
  server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
}
after(async () => { try { server?.kill(); await sandbox?.stop(); } catch {} await rm(dir, { recursive: true, force: true }); });

async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const acct = (id, amount = '5000000000000000000000000') => ({ Account: { account_id: id, account: { amount, locked: '0', code_hash: CODE_HASH, storage_usage: 182 } } });
const fullKey = (id, pk) => ({ AccessKey: { account_id: id, public_key: pk, access_key: { nonce: 0, permission: 'FullAccess' } } });
const limitedKey = (id, pk) => ({ AccessKey: { account_id: id, public_key: pk, access_key: { nonce: 0, permission: { FunctionCall: { allowance: null, receiver_id: 'app.test.near', method_names: [] } } } } });

// Clue asks the chain about the finalized state, which trails the newest block. After changing accounts or keys,
// let the local chain move ahead so the change is final, as it would be on a real chain a few seconds later.
async function patch(records) { await sandbox.patchState(records); await sandbox.fastForward(40); await new Promise((r) => setTimeout(r, 1500)); }

// One full sign-in as a wallet would do it: ask for a challenge, sign it, send the answer.
async function signIn({ accountId, key, tamper = false }) {
  const ch = await fetch(base + '/api/wallet/challenge', { method: 'POST', headers: { Origin: base } });
  const c = await ch.json();
  const binding = /clue_challenge=([^;]+)/.exec(ch.headers.get('set-cookie') || '')?.[1];
  const sig = Buffer.from(key.sign(messageDigest(c.message, c.nonce, c.recipient)).signature);
  if (tamper) sig[0] ^= 0xff;
  const r = await fetch(base + '/api/wallet/verify', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: `clue_challenge=${binding}` }, body: JSON.stringify({ id: c.id, accountId, publicKey: key.getPublicKey().toString(), signature: sig.toString('base64') }) });
  const session = /clue_wallet=([^;]+)/.exec(r.headers.get('set-cookie') || '')?.[1];
  return { status: r.status, body: await r.json().catch(() => null), session, binding, challenge: c };
}

test('real chain: a full-access key signs in; wrong, limited and unknown keys do not', { skip: sandbox ? false : why }, async () => {
  await ready();
  const owner = KeyPair.fromRandom('ed25519'), limited = KeyPair.fromRandom('ed25519'), stranger = KeyPair.fromRandom('ed25519');
  await patch([
    acct('alice.test.near'), fullKey('alice.test.near', owner.getPublicKey().toString()),
    acct('carol.test.near'), limitedKey('carol.test.near', limited.getPublicKey().toString()),
  ]);

  // 1. The real owner signs in and gets a private session.
  const ok = await signIn({ accountId: 'alice.test.near', key: owner });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.name, 'alice.test.near');
  const me = await (await fetch(base + '/api/wallet/session', { headers: { Cookie: `clue_wallet=${ok.session}` } })).json();
  assert.equal(me.user.name, 'alice.test.near');
  assert.equal((await fetch(base + '/api/threads', { headers: { Cookie: `clue_wallet=${ok.session}` } })).status, 200);

  // 2. A real signature from a key the account does not have is refused.
  assert.equal((await signIn({ accountId: 'alice.test.near', key: stranger })).status, 401);

  // 3. A key that exists but can only call one contract (not a full-access key) is refused.
  const lim = await signIn({ accountId: 'carol.test.near', key: limited });
  assert.equal(lim.status, 401);
  assert.match(lim.body.error, /full-access/);

  // 4. An account that does not exist is refused.
  assert.equal((await signIn({ accountId: 'nobody.test.near', key: stranger })).status, 401);

  // 5. A tampered signature is refused before the chain is even asked.
  assert.equal((await signIn({ accountId: 'alice.test.near', key: owner, tamper: true })).status, 401);

  // 6. Signing in as someone else's account with your own valid key is refused.
  assert.equal((await signIn({ accountId: 'carol.test.near', key: owner })).status, 401);

  // 7. A signed answer cannot be used twice.
  const c = await (await fetch(base + '/api/wallet/challenge', { method: 'POST', headers: { Origin: base } }));
  const binding = /clue_challenge=([^;]+)/.exec(c.headers.get('set-cookie') || '')?.[1], ch = await c.json();
  const body = JSON.stringify({ id: ch.id, accountId: 'alice.test.near', publicKey: owner.getPublicKey().toString(), signature: Buffer.from(owner.sign(messageDigest(ch.message, ch.nonce, ch.recipient)).signature).toString('base64') });
  const send = () => fetch(base + '/api/wallet/verify', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: `clue_challenge=${binding}` }, body });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 401);
});

test('real chain: a key added to the account later is accepted only once it is on the chain', { skip: sandbox ? false : why }, async () => {
  const first = KeyPair.fromRandom('ed25519'), second = KeyPair.fromRandom('ed25519');
  await patch([acct('dave.test.near'), fullKey('dave.test.near', first.getPublicKey().toString())]);
  assert.equal((await signIn({ accountId: 'dave.test.near', key: first })).status, 200);
  assert.equal((await signIn({ accountId: 'dave.test.near', key: second })).status, 401);          // not on the account yet
  await patch([fullKey('dave.test.near', second.getPublicKey().toString())]);          // the user adds a key
  assert.equal((await signIn({ accountId: 'dave.test.near', key: second })).status, 200);
});
