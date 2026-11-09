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

// The only requests this server will sign. Polymarket's package attaches the builder signature to its relayer requests (wallet
// creation and permissions) and to its order-server requests (sign-in and orders). It never signs anything that manages our
// builder account itself (for example /auth/builder-api-key): those are refused.
const QUERY = '(\\?[A-Za-z0-9=&%._,:-]{1,300})?';
const ALLOWED = [
  // relayer
  ['GET', new RegExp(`^/deployed${QUERY}$`)],
  ['GET', new RegExp(`^/v1/account/transactions/params${QUERY}$`)],
  ['GET', /^\/v1\/account\/transactions\/[A-Za-z0-9-]{8,80}$/],
  ['POST', /^\/submit$/, { mustBeFromWallet: true }],
  // order server: sign-in
  ['POST', /^\/auth\/api-key$/],
  ['GET', new RegExp(`^/auth/derive-api-key${QUERY}$`)],
  // order server: orders and the account's own trading data
  ['POST', /^\/orders?$/],
  ['DELETE', /^\/(order|orders|cancel-all|cancel-orders|cancel-market-orders)$/],
  ['GET', new RegExp(`^/(data/(orders|order/[A-Za-z0-9x]{1,100}|trades)|balance-allowance|order-scoring|orders-scoring)${QUERY}$`)],
  ['POST', /^\/(orders-scoring|heartbeats?)$/],
  ['GET', new RegExp(`^/balance-allowance/update${QUERY}$`)],
  // order server: read-only market information that building an order asks for (which market a token belongs to, its price step,
  // whether it is a multi-outcome market, the fee rates). All of it is public data; signing it gives no extra power.
  ['GET', /^\/(markets-by-token|clob-markets)\/[A-Za-z0-9x]{1,100}$/],
  ['GET', /^\/fees\/builder-fees\/[A-Za-z0-9x]{1,100}$/],
  ['GET', new RegExp(`^/(tick-size|neg-risk|spread|price|midpoint|last-trade-price|book)${QUERY}$`)],
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
  const rule = ALLOWED.find(([m, re]) => m === method && re.test(path));
  if (!rule) return bad(403, 'That request cannot be signed.');
  if (method === 'GET' && body) return bad(400, 'Invalid request.');
  if (rule[2] && rule[2].mustBeFromWallet) {
    let parsed; try { parsed = JSON.parse(body || ''); } catch { return bad(400, 'Invalid request.'); }
    // A relayer submit must come from the user's own wallet: no one can use our builder account to act for someone else's.
    if (!parsed || typeof parsed !== 'object' || String(parsed.from || '').toLowerCase() !== wallet.toLowerCase()) return bad(403, 'That request is not from your wallet.');
  }
  return { ok: true, method, path, body };
}
