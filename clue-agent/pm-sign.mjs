// Builder signing for Polymarket's relayer. The browser asks this server to sign a relayer request; the builder
// secret (POLYMARKET_BUILDER_*) never leaves the server. Orders do NOT pass through here: they go from the user's own
// browser straight to Polymarket, so Polymarket sees the user's real location.
import { createHmac } from 'node:crypto';

// HMAC-SHA256 over timestamp + method + path + body, keyed by the base64url-decoded secret; output is base64url.
// This is the same scheme Polymarket's own package uses (its `builderApiKey`), checked against it in the tests.
export function builderHeaders({ method, path, body }, { key, secret, passphrase, now = Date.now() }) {
  const timestamp = Math.floor(now / 1000);
  const message = `${timestamp}${method}${path}${body === undefined ? '' : body}`;
  const raw = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const signature = createHmac('sha256', raw).update(message).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return { POLY_BUILDER_API_KEY: key, POLY_BUILDER_PASSPHRASE: passphrase, POLY_BUILDER_SIGNATURE: signature, POLY_BUILDER_TIMESTAMP: String(timestamp) };
}

// The only relayer requests this server will sign.
const ALLOWED = [
  ['GET', /^\/deployed\?[A-Za-z0-9=&%._-]{1,200}$/],
  ['GET', /^\/v1\/account\/transactions\/params\?[A-Za-z0-9=&%._-]{1,200}$/],
  ['GET', /^\/v1\/account\/transactions\/[A-Za-z0-9-]{8,80}$/],
  ['POST', /^\/submit$/],
];
const MAX_BODY = 20000;
const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

// Decides whether to sign. `wallet` is the Ethereum address Privy holds for the signed-in user (from the server, never the browser).
export function checkSignRequest(input, wallet) {
  const bad = (status, error) => ({ ok: false, status, error });
  if (!isAddress(wallet)) return bad(403, 'Trading needs an email or Ethereum wallet account.');
  if (!input || typeof input !== 'object') return bad(400, 'Invalid request.');
  const { method, path } = input;
  const body = input.body === undefined || input.body === null ? undefined : input.body;
  if (typeof method !== 'string' || typeof path !== 'string' || path.length > 300) return bad(400, 'Invalid request.');
  if (body !== undefined && (typeof body !== 'string' || body.length > MAX_BODY)) return bad(400, 'Invalid request.');
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) return bad(403, 'That request cannot be signed.');
  if (method === 'GET' && body) return bad(400, 'Invalid request.');
  if (method === 'POST') {
    let parsed; try { parsed = JSON.parse(body || ''); } catch { return bad(400, 'Invalid request.'); }
    // The request must come from the user's own wallet: no one can use our builder account to act for someone else's.
    if (!parsed || typeof parsed !== 'object' || String(parsed.from || '').toLowerCase() !== wallet.toLowerCase()) return bad(403, 'That request is not from your wallet.');
  }
  return { ok: true, method, path, body };
}
