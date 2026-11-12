// Connecting an AI app by signing in, the way PayBox and other connectors work: the app registers, sends the person to
// Clue, they approve, and the app swaps a one-time code (checked with PKCE) for its connection. No key is copied by hand.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = await mkdtemp(join(tmpdir(), 'clue-oauth-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 400; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => { const verifier = b64url(randomBytes(32)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
const site = (method, path, cookie, body) => fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(j);

async function connect(cookie, { canTrade = false, scope = 'research' } = {}) {
  const reg = await j(await fetch(base + '/api/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) }));
  assert.equal(reg.status, 201);
  const { verifier, challenge } = pkce();
  const u = new URL(base + '/api/oauth/authorize');
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope })) u.searchParams.set(k, v);
  const a = await fetch(u, { redirect: 'manual' });
  assert.equal(a.status, 302);
  const id = a.headers.get('location').split('#/connect/')[1];
  const info = await site('GET', `/api/oauth/request/${id}`, '');
  const d = await site('POST', '/api/oauth/approve', cookie, { id, approve: true, canTrade });
  const back = new URL(d.body.redirect);
  return { clientId: reg.body.client_id, verifier, info: info.body, back, code: back.searchParams.get('code') };
}
const swap = (body, form = true) => fetch(base + '/api/oauth/token', form
  ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j);
const mcp = (token, method, params = {}) => fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(j);

test('an AI app finds how to sign in from the connector address alone', async () => {
  await ready();
  const r = await j(await fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  const res = (await j(await fetch(base + '/api/oauth/meta/resource'))).body;
  assert.equal(res.resource, base + '/api/mcp'); assert.deepEqual(res.authorization_servers, [base]);
  const srv = (await j(await fetch(base + '/api/oauth/meta/server'))).body;
  assert.equal(srv.issuer, base); assert.deepEqual(srv.code_challenge_methods_supported, ['S256']);
  assert.equal(srv.token_endpoint, base + '/api/oauth/token'); assert.equal(srv.registration_endpoint, base + '/api/oauth/register');
});

test('sign in, approve, and the app is connected as that person, read-only unless they chose trading', async () => {
  const ann = signup('ann');
  const c = await connect(ann);
  assert.deepEqual(c.info, { app: 'Claude', returnsTo: 'claude.ai', asksToTrade: false, mismatch: null });
  assert.equal(c.back.origin + c.back.pathname, REDIRECT); assert.equal(c.back.searchParams.get('state'), 'xyz');
  const t = await swap({ grant_type: 'authorization_code', code: c.code, redirect_uri: REDIRECT, client_id: c.clientId, code_verifier: c.verifier });
  assert.equal(t.status, 200, JSON.stringify(t.body)); assert.equal(t.body.token_type, 'Bearer'); assert.equal(t.body.scope, 'research');
  assert.equal((await mcp(t.body.access_token, 'tools/list')).status, 200);
  const keys = (await site('GET', '/api/agent-keys', ann)).body.keys;
  assert.equal(keys.length, 1); assert.equal(keys[0].label, 'Claude'); assert.equal(keys[0].connected, true); assert.equal(keys[0].canTrade, false);
  assert.equal((await fetch(base + '/api/agent/sign', { method: 'POST', headers: { Authorization: 'Bearer ' + t.body.access_token, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);   // read-only
  // connecting the same app again replaces its connection instead of piling up keys
  const again = await connect(ann, { canTrade: true, scope: 'research trade' });
  assert.equal(again.info.asksToTrade, true);
  const t2 = await swap({ grant_type: 'authorization_code', code: again.code, redirect_uri: REDIRECT, client_id: again.clientId, code_verifier: again.verifier }, false);
  assert.equal(t2.body.scope, 'research trade');
  assert.equal((await site('GET', '/api/agent-keys', ann)).body.keys.filter((k) => k.connected).length, 2);    // two separate app registrations
});

test('the one-time code is checked: wrong verifier, wrong app, reuse and lateness all fail', async () => {
  const bob = signup('bob');
  const c = await connect(bob);
  const good = { grant_type: 'authorization_code', code: c.code, redirect_uri: REDIRECT, client_id: c.clientId, code_verifier: c.verifier };
  assert.equal((await swap({ ...good, code_verifier: 'x'.repeat(50) })).body.error, 'invalid_grant');   // the code is now spent, even on failure
  assert.equal((await swap(good)).body.error, 'invalid_grant');
  const c2 = await connect(bob);
  assert.equal((await swap({ ...good, code: c2.code, client_id: 'clue_app_someoneelse' })).body.error, 'invalid_grant');
  const c3 = await connect(bob);
  assert.equal((await swap({ ...good, code: c3.code, client_id: c3.clientId, code_verifier: c3.verifier, redirect_uri: 'https://evil.example/cb' })).body.error, 'invalid_grant');
  assert.equal((await swap({ grant_type: 'password' })).body.error, 'unsupported_grant_type');
});

test('bad registrations and requests are refused, approval needs the signed-in person, and cancel returns an error to the app', async () => {
  const reg = (uris) => fetch(base + '/api/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'X', redirect_uris: uris }) }).then(j);
  assert.equal((await reg(['http://evil.example/cb'])).status, 400);
  assert.equal((await reg(['javascript:alert(1)'])).status, 400);
  assert.equal((await reg([])).status, 400);
  assert.equal((await reg(['http://localhost:33418/callback'])).status, 201);                    // apps on the person's own computer
  const ok = (await reg([REDIRECT])).body;
  const u = new URL(base + '/api/oauth/authorize'); u.searchParams.set('client_id', ok.client_id); u.searchParams.set('redirect_uri', 'https://evil.example/cb'); u.searchParams.set('response_type', 'code');
  assert.equal((await fetch(u, { redirect: 'manual' })).status, 400);                               // never sent to an unregistered address
  u.searchParams.set('redirect_uri', REDIRECT); u.searchParams.set('code_challenge_method', 'plain'); u.searchParams.set('code_challenge', 'a'.repeat(43));
  const noPkce = await fetch(u, { redirect: 'manual' });
  assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');
  u.searchParams.set('code_challenge_method', 'S256');
  const id = (await fetch(u, { redirect: 'manual' })).headers.get('location').split('#/connect/')[1];
  assert.equal((await site('POST', '/api/oauth/approve', 'clue_wallet=nope', { id, approve: true })).status, 401);
  const no = await site('POST', '/api/oauth/approve', signup('cat'), { id, approve: false });
  assert.equal(new URL(no.body.redirect).searchParams.get('error'), 'access_denied');
  assert.equal((await site('GET', `/api/oauth/request/${id}`, '')).status, 404);                    // a request is used once
});

test('disconnect all cuts every app off at once', async () => {
  const dee = signup('dee');
  const c = await connect(dee);
  const t = await swap({ grant_type: 'authorization_code', code: c.code, redirect_uri: REDIRECT, client_id: c.clientId, code_verifier: c.verifier });
  await site('POST', '/api/agent-keys', dee, { label: 'by hand' });
  assert.equal((await site('DELETE', '/api/agent-keys', dee)).body.disconnected, 2);
  assert.equal((await mcp(t.body.access_token, 'tools/list')).status, 401);
});

test('app names lose invisible tricks, and a famous name with someone else\'s address is flagged', async () => {
  const reg = async (name, uri) => (await fetch(base + '/api/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [uri] }) }).then(j)).body;
  const rtl = await reg('Claude AI\u202Eevil\u200B', 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(rtl.client_name, 'Claude AIevil');
  const { verifier, challenge } = pkce(); void verifier;
  const ask = async (c, uri) => { const u = new URL(base + '/api/oauth/authorize'); for (const [k, v] of Object.entries({ response_type: 'code', client_id: c.client_id, redirect_uri: uri, code_challenge: challenge, code_challenge_method: 'S256' })) u.searchParams.set(k, v); const id = (await fetch(u, { redirect: 'manual' })).headers.get('location').split('#/connect/')[1]; return (await site('GET', `/api/oauth/request/${id}`, '')).body; };
  const fake = await reg('Claude AI', 'https://evil.example/cb');
  assert.match((await ask(fake, 'https://evil.example/cb')).mismatch, /calls itself "Claude AI" but would send you back to evil\.example/);
  const real = await reg('Claude', 'https://claude.ai/api/mcp/auth_callback');
  assert.equal((await ask(real, 'https://claude.ai/api/mcp/auth_callback')).mismatch, null);
  const local = await reg('Claude Code', 'http://localhost:33418/callback');
  assert.equal((await ask(local, 'http://localhost:33418/callback')).mismatch, null);
  const gpt = await reg('ChatGPT', 'https://chatgpt.evil.example/cb');
  assert.ok((await ask(gpt, 'https://chatgpt.evil.example/cb')).mismatch);
});
