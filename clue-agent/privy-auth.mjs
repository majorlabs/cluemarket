// Privy sign-in. Verifies a Privy access token (ES256 JWT) with Privy's PUBLIC verification key,
// then starts the same private Clue session the NEAR wallet login uses.
// The app secret is used only to look up a display name; sign-in works without it.
import { createVerify, createPublicKey } from 'node:crypto';
import { store, auth } from './auth.mjs';
import { startSession } from './wallet-auth.mjs';

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Privy returns its public key as ONE line ("-----BEGIN PUBLIC KEY-----MFkw...-----END PUBLIC KEY-----"), with no line breaks.
// Node cannot read that, so rebuild the standard layout. A key that already has line breaks passes through unchanged in meaning.
export function normalizePem(pem) {
  if (!String(pem).includes('-----BEGIN PUBLIC KEY-----')) return pem;
  const body = String(pem).replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return pem;
  return '-----BEGIN PUBLIC KEY-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----\n';
}

// Pure function so it can be tested with a locally generated key.
export function verifyPrivyToken(token, { appId, publicKeyPem, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 8192) throw fail('Invalid sign-in token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw fail('Invalid sign-in token.');
  let header, claims;
  try { header = JSON.parse(b64(parts[0]).toString()); claims = JSON.parse(b64(parts[1]).toString()); } catch { throw fail('Invalid sign-in token.'); }
  if (header.alg !== 'ES256') throw fail('Unsupported token type.');
  const sig = b64(parts[2]);
  let ok = false;
  try { ok = sig.length === 64 && createVerify('SHA256').update(parts[0] + '.' + parts[1]).verify({ key: createPublicKey(normalizePem(publicKeyPem)), dsaEncoding: 'ieee-p1363' }, sig); } catch { ok = false; }
  if (!ok) throw fail('Sign-in could not be verified.');
  if (claims.iss !== 'privy.io' || claims.aud !== appId) throw fail('Sign-in was issued for a different app.');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw fail('Sign-in expired. Try again.');
  if (typeof claims.sub !== 'string' || !/^did:privy:[A-Za-z0-9]+$/.test(claims.sub)) throw fail('Invalid sign-in token.');
  return { did: claims.sub };
}
const fail = (message, status = 401) => Object.assign(new Error(message), { status });

let keyCache = null;
async function publicKey(appId) {
  if (keyCache && keyCache.at > Date.now() - 3600000) return keyCache.pem;
  const r = await fetch(`https://auth.privy.io/api/v1/apps/${appId}`, { headers: { 'privy-app-id': appId }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw fail('Sign-in service unavailable. Try again.', 502);
  const pem = (await r.json()).verification_key;
  if (typeof pem !== 'string' || !pem.includes('PUBLIC KEY')) throw fail('Sign-in service unavailable. Try again.', 502);
  keyCache = { pem, at: Date.now() };
  return pem;
}

// Friendly label (email or wallet) via Privy's API. Needs the app secret; falls back to a short id.
async function label(appId, did) {
  const fallback = 'privy:' + did.slice(-8);
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) return fallback;
  try {
    const r = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
      headers: { 'privy-app-id': appId, Authorization: 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64') },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return fallback;
    const accounts = (await r.json()).linked_accounts || [];
    const email = accounts.find((a) => a.type === 'email')?.address;
    if (email) return String(email).slice(0, 64);
    const w = accounts.find((a) => a.type === 'wallet')?.address;
    if (w) return `${w.slice(0, 6)}…${w.slice(-4)}`;
  } catch { /* use fallback */ }
  return fallback;
}

// The Ethereum wallet Privy holds for this person: the one made for them, else a wallet they connected.
export function pickWallet(accounts) {
  const wallets = (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.type === 'wallet' && /^0x[0-9a-fA-F]{40}$/.test(String(a.address)) && (!a.chain_type || a.chain_type === 'ethereum'));
  const made = wallets.find((a) => a.wallet_client_type === 'privy' || a.connector_type === 'embedded' || a.wallet_client === 'privy');
  const chosen = made || wallets[0];
  return chosen ? { address: chosen.address, madeForYou: Boolean(made) } : null;
}

async function walletOf(appId, did) {
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) return null;
  try {
    const r = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
      headers: { 'privy-app-id': appId, Authorization: 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64') },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return pickWallet((await r.json()).linked_accounts);
  } catch { return null; }
}

export async function privyWalletRoute(userId) {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId || typeof userId !== 'string' || !userId.startsWith('privy:did:privy:')) return { wallet: null, reason: 'not-privy' };
  return { wallet: await walletOf(appId, userId.slice('privy:'.length)) };
}

export async function privyRoute(req, res, path, body, origin) {
  const appId = process.env.PRIVY_APP_ID;
  if (path === '/api/privy/config' && req.method === 'GET') return { enabled: Boolean(appId), appId: appId || null };
  if (!appId) throw fail('Privy sign-in is not configured.', 503);
  if (path === '/api/privy/login' && req.method === 'POST') {
    const { did } = verifyPrivyToken(body.accessToken, { appId, publicKeyPem: await publicKey(appId) });
    const userId = 'privy:' + did;
    const email = did + '@privy.wallet.invalid';
    const name = await label(appId, did);
    let user = await store.get('SELECT id FROM "user" WHERE email=?', email);
    if (!user) {
      await (await auth.$context).internalAdapter.createUser({ id: userId, name, email, emailVerified: false });
      user = await store.get('SELECT id FROM "user" WHERE email=?', email);
    }
    await startSession(res, origin, user.id, name);
    return { user: { id: user.id, name, email: name } };
  }
  throw fail('Not found', 404);
}
