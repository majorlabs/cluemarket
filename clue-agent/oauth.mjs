// Sign in with Clue, for AI apps. Claude, ChatGPT and other apps that support connectors add Clue by its address, and a
// Clue sign-in page opens: the person signs in, chooses what the app may do, and approves. No key to copy. This is the
// standard way connectors sign in (OAuth 2.1 with PKCE and dynamic client registration). The app ends up holding an
// assistant key (agent-keys.mjs), the same as one made by hand, and it shows on the Agents page where it can be disconnected.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createKey } from './agent-keys.mjs';

const REQUEST_MS = 10 * 60000, CODE_MS = 5 * 60000;
const hash = (t) => createHash('sha256').update(String(t)).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fail = (status, error, description) => Object.assign(new Error(description || error), { status, oauth: error });

export function resourceMetadata(base) {
  return { resource: `${base}/api/mcp`, authorization_servers: [base], scopes_supported: ['research', 'trade'], bearer_methods_supported: ['header'], resource_name: 'Clue' };
}
export function serverMetadata(base) {
  return {
    issuer: base, authorization_endpoint: `${base}/api/oauth/authorize`, token_endpoint: `${base}/api/oauth/token`, registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['research', 'trade'], service_documentation: `${base}/#/docs/agents`,
  };
}

// Where an app may be sent back to: its own https address, or the person's own computer (for apps like Claude Code).
export function okRedirect(uri) {
  let u; try { u = new URL(String(uri)); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

export async function register(store, body, { now = new Date() } = {}) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) throw fail(400, 'invalid_redirect_uri', 'Each redirect address must be https, or on this computer.');
  const name = String(body.client_name || 'AI app').replace(/\p{Cc}/gu, '').trim().slice(0, 60) || 'AI app';
  const id = 'clue_app_' + randomUUID().replace(/-/g, '');
  await store.run('INSERT INTO oauth_clients (id,name,redirect_uris,created_at) VALUES (?,?,?,?)', id, name, JSON.stringify(uris), now.toISOString());
  return { client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], client_id_issued_at: Math.floor(now / 1000) };
}

async function client(store, id) {
  const c = await store.get('SELECT id, name, redirect_uris FROM oauth_clients WHERE id=?', String(id || ''));
  return c ? { id: c.id, name: c.name, redirectUris: JSON.parse(c.redirect_uris) } : null;
}

// The app sends the person here. The request is checked and kept for ten minutes while they sign in and decide.
export async function authorize(store, q, { now = new Date() } = {}) {
  const c = await client(store, q.get('client_id'));
  const redirect = q.get('redirect_uri');
  if (!c || !redirect || !c.redirectUris.includes(redirect)) throw fail(400, 'invalid_request', 'This app is not registered with Clue for that address.');
  const back = (error) => { const u = new URL(redirect); u.searchParams.set('error', error); if (q.get('state')) u.searchParams.set('state', q.get('state')); return { redirect: u.href }; };
  if (q.get('response_type') !== 'code') return back('unsupported_response_type');
  const challenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back('invalid_request');
  const scope = String(q.get('scope') || 'research');
  const id = randomUUID();
  await store.run('DELETE FROM oauth_requests WHERE expires<?', now.getTime());
  await store.run('INSERT INTO oauth_requests (id,client_id,redirect_uri,state,code_challenge,wants_trade,expires) VALUES (?,?,?,?,?,?,?)',
    id, c.id, redirect, String(q.get('state') || '').slice(0, 500), challenge, /\btrade\b/.test(scope) ? 1 : 0, now.getTime() + REQUEST_MS);
  return { request: id };
}

export async function describeRequest(store, id, { now = new Date() } = {}) {
  const r = await store.get('SELECT client_id, redirect_uri, wants_trade, expires FROM oauth_requests WHERE id=?', String(id || ''));
  if (!r || r.expires < now.getTime()) throw fail(404, 'expired', 'This connection request has expired. Start again from your AI app.');
  const c = await client(store, r.client_id);
  return { app: c?.name || 'AI app', returnsTo: new URL(r.redirect_uri).host, asksToTrade: Boolean(r.wants_trade) };
}

// The signed-in person approves (or turns down) the request. Approving gives the app a one-time code, good for five minutes.
export async function decide(store, userId, id, { approve, canTrade }, { now = new Date() } = {}) {
  const r = await store.get('SELECT client_id, redirect_uri, state, code_challenge, expires FROM oauth_requests WHERE id=?', String(id || ''));
  if (!r || r.expires < now.getTime()) throw fail(404, 'expired', 'This connection request has expired. Start again from your AI app.');
  await store.run('DELETE FROM oauth_requests WHERE id=?', String(id));
  const u = new URL(r.redirect_uri);
  if (r.state) u.searchParams.set('state', r.state);
  if (!approve) { u.searchParams.set('error', 'access_denied'); return { redirect: u.href }; }
  const code = b64url(randomBytes(32));
  await store.run('INSERT INTO oauth_codes (code_hash,client_id,user_id,redirect_uri,code_challenge,can_trade,expires) VALUES (?,?,?,?,?,?,?)',
    hash(code), r.client_id, userId, r.redirect_uri, r.code_challenge, canTrade ? 1 : 0, now.getTime() + CODE_MS);
  u.searchParams.set('code', code);
  return { redirect: u.href };
}

// The app trades the one-time code for its key, proving with PKCE that it is the same app that started.
export async function token(store, b, { now = new Date() } = {}) {
  if (b.grant_type !== 'authorization_code') throw fail(400, 'unsupported_grant_type');
  const row = await store.get('SELECT code_hash, client_id, user_id, redirect_uri, code_challenge, can_trade, expires FROM oauth_codes WHERE code_hash=?', hash(b.code || ''));
  if (row) await store.run('DELETE FROM oauth_codes WHERE code_hash=?', row.code_hash);           // one use only, whatever happens next
  if (!row || row.expires < now.getTime()) throw fail(400, 'invalid_grant', 'The code has expired or was already used.');
  if (String(b.client_id || '') !== row.client_id || String(b.redirect_uri || '') !== row.redirect_uri) throw fail(400, 'invalid_grant', 'The code was not issued to this app.');
  const verifier = String(b.code_verifier || '');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b64url(createHash('sha256').update(verifier).digest()) !== row.code_challenge) throw fail(400, 'invalid_grant', 'The code check did not match.');
  const c = await client(store, row.client_id);
  // One live key per app per person: connecting the same app again replaces its old key.
  await store.run('UPDATE agent_keys SET revoked_at=? WHERE user_id=? AND client_id=? AND revoked_at IS NULL', now.toISOString(), row.user_id, row.client_id);
  const k = await createKey(store, row.user_id, c?.name || 'AI app', { now, canTrade: Boolean(row.can_trade), clientId: row.client_id });
  return { access_token: k.token, token_type: 'Bearer', scope: row.can_trade ? 'research trade' : 'research' };
}

// Token requests arrive as a form (the standard) or as JSON.
export async function readForm(req) {
  let v = ''; for await (const c of req) { v += c; if (v.length > 16384) throw fail(413, 'invalid_request', 'Request too large.'); }
  if (String(req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(v || '{}'); } catch { throw fail(400, 'invalid_request'); } }
  return Object.fromEntries(new URLSearchParams(v));
}
