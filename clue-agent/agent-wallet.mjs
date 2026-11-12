// Assistant trading. A person connects their own OutLayer agent wallet (its keys live in OutLayer's secure hardware) and
// sets their own limits. Their assistant can then ask Clue to sign Polymarket orders with that wallet. Clue signs only:
//   - Polymarket sign-in (ClobAuth) for that wallet,
//   - orders on Polymarket's exchanges, a buy only if it fits the person's per-order and per-day limits,
//   - the one-time approvals that let Polymarket's exchanges use the wallet's pUSD and shares.
// Anything else, such as a transfer or a withdrawal, is refused. Clue never sends orders: the assistant sends the signed
// order to Polymarket from the person's own machine, so Polymarket sees where the person really is.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { production } from '@polymarket/client';

const OUTLAYER = () => process.env.OUTLAYER_BASE || 'https://api.outlayer.ai';
const C = production.contracts;
const lower = (a) => String(a || '').toLowerCase();
const EXCHANGES = new Set([C.standardExchange, C.negRiskExchange, C.exchangeV3].map(lower));
// Contracts the wallet may give permission to: Polymarket's own trading contracts, nothing else.
const SPENDERS = new Set([C.standardExchange, C.negRiskExchange, C.exchangeV3, C.negRiskAdapter, C.collateralAdapter, C.negRiskCollateralAdapter, C.protocolV2Router, C.binaryModule, C.negRiskModule, C.positionManager].map(lower));
const TOKENS = new Set([C.collateralToken, C.conditionalTokens].map(lower));
const APPROVE = '0x095ea7b3', APPROVE_ALL = '0xa22cb465';
const KEY_RE = /^wk_[A-Za-z0-9]{16,200}$/;
const fail = (status, error) => Object.assign(new Error(error), { status });
const today = (now) => now.toISOString().slice(0, 10);
const money = (n) => Math.round(n * 100) / 100;

export function seal(key, text) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.'); }
export function unseal(key, sealed) { const [iv, tag, body] = sealed.split('.').map((x) => Buffer.from(x, 'base64')); const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); return Buffer.concat([d.update(body), d.final()]).toString('utf8'); }

async function outlayer(key, method, path, body) {
  const r = await fetch(OUTLAYER() + path, { method, headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw fail(400, j.message || 'OutLayer refused that key, or the wallet policy does not allow EVM signing. Check that evm_sign is on.');
  if (!r.ok) throw fail(502, j.message || `OutLayer returned ${r.status}.`);
  return j;
}

const limits = (b) => {
  const maxOrder = Number(b.maxOrder), maxDay = Number(b.maxDay);
  if (!Number.isFinite(maxOrder) || maxOrder <= 0 || maxOrder > 1e7 || !Number.isFinite(maxDay) || maxDay <= 0 || maxDay > 1e8) throw fail(400, 'Set a limit per order and per day, in dollars, above zero.');
  if (maxOrder > maxDay) throw fail(400, 'The limit per order cannot be more than the limit per day.');
  return { maxOrder: money(maxOrder), maxDay: money(maxDay) };
};

async function spentToday(store, userId, now) {
  const r = await store.get("SELECT COALESCE(SUM(usd),0) AS total FROM agent_orders WHERE user_id=? AND day=? AND side='BUY'", userId, today(now));
  return money(Number(r?.total || 0));
}

export async function describeWallet(store, userId, { now = new Date() } = {}) {
  const w = await store.get('SELECT address, enabled, max_order, max_day, created_at, updated_at FROM agent_wallets WHERE user_id=?', userId);
  if (!w) return { wallet: null };
  return { wallet: { provider: 'outlayer', address: w.address, enabled: Boolean(w.enabled), maxOrder: w.max_order, maxDay: w.max_day, spentToday: await spentToday(store, userId, now), connectedAt: w.created_at } };
}

export async function connectWallet(store, sealingKey, userId, b, { now = new Date() } = {}) {
  const key = String(b.key || '').trim();
  if (!KEY_RE.test(key)) throw fail(400, 'That does not look like an OutLayer wallet key. It starts with wk_.');
  const { maxOrder, maxDay } = limits(b);
  const a = await outlayer(key, 'GET', '/wallet/v1/address?chain=ethereum');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(a.address || ''))) throw fail(502, 'OutLayer did not return a wallet address.');
  const iso = now.toISOString();
  await store.run('INSERT INTO agent_wallets (user_id,provider,key_sealed,address,enabled,max_order,max_day,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_sealed=excluded.key_sealed, address=excluded.address, enabled=0, max_order=excluded.max_order, max_day=excluded.max_day, updated_at=excluded.updated_at',
    userId, 'outlayer', seal(sealingKey, key), a.address, 0, maxOrder, maxDay, iso, iso);
  return describeWallet(store, userId, { now });
}

export async function updateWallet(store, userId, b, { now = new Date() } = {}) {
  const w = await store.get('SELECT max_order, max_day FROM agent_wallets WHERE user_id=?', userId);
  if (!w) throw fail(404, 'Connect a wallet first.');
  const next = limits({ maxOrder: b.maxOrder ?? w.max_order, maxDay: b.maxDay ?? w.max_day });
  const enabled = b.enabled === undefined ? null : b.enabled === true ? 1 : 0;
  await store.run('UPDATE agent_wallets SET max_order=?, max_day=?, enabled=COALESCE(?,enabled), updated_at=? WHERE user_id=?', next.maxOrder, next.maxDay, enabled, now.toISOString(), userId);
  return describeWallet(store, userId, { now });
}

export async function removeWallet(store, userId) { return Boolean((await store.run('DELETE FROM agent_wallets WHERE user_id=?', userId)).changes); }

// Works out what a signature request is, and refuses anything Clue does not sign.
export function classify(td, address) {
  if (!td || typeof td !== 'object' || !td.domain || !td.message || !td.types || typeof td.primaryType !== 'string') throw fail(400, 'Invalid signing request.');
  if (td.domain.chainId !== undefined && Number(td.domain.chainId) !== 137) throw fail(403, 'Only Polygon is supported.');
  const t = td.primaryType;
  if (t === 'ClobAuth') {
    if (lower(td.message.address) !== lower(address)) throw fail(403, 'Sign-in must be for this wallet.');
    return { kind: 'signin' };
  }
  if (t === 'Order' || t === 'TypedDataSign') {
    const o = t === 'Order' ? td.message : td.message.contents;
    if (!o || !td.types.Order) throw fail(400, 'Invalid order.');
    if (!EXCHANGES.has(lower(td.domain.verifyingContract))) throw fail(403, 'Orders can only be for Polymarket\'s exchanges.');
    const side = String(o.side) === '0' || o.side === 'BUY' ? 'BUY' : String(o.side) === '1' || o.side === 'SELL' ? 'SELL' : null;
    if (!side) throw fail(400, 'Invalid order side.');
    let maker; try { maker = BigInt(o.makerAmount); BigInt(o.takerAmount); BigInt(o.tokenId); } catch { throw fail(400, 'Invalid order amounts.'); }
    return { kind: 'order', side, tokenId: String(o.tokenId), usd: side === 'BUY' ? Number(maker) / 1e6 : 0 };
  }
  if (t === 'Batch') {
    const calls = td.message.calls;
    if (!Array.isArray(calls) || !calls.length || calls.length > 12) throw fail(403, 'That request cannot be signed.');
    for (const c of calls) {
      const data = lower(c.data);
      if (BigInt(c.value || 0) !== 0n || !TOKENS.has(lower(c.target))) throw fail(403, 'Only Polymarket trading permissions can be signed.');
      if (!(data.startsWith(APPROVE) || data.startsWith(APPROVE_ALL)) || data.length !== 138) throw fail(403, 'Only Polymarket trading permissions can be signed.');
      const who = '0x' + data.slice(34, 74);
      if (!SPENDERS.has(who)) throw fail(403, 'Permissions can only go to Polymarket\'s own contracts.');
    }
    return { kind: 'approval' };
  }
  throw fail(403, 'That request cannot be signed. Clue signs only sign-in, orders and trading permissions.');
}

export async function signFor(store, sealingKey, userId, td, { now = new Date() } = {}) {
  const w = await store.get('SELECT key_sealed, address, enabled, max_order, max_day FROM agent_wallets WHERE user_id=?', userId);
  if (!w) throw fail(404, 'No assistant wallet is connected. Connect one in Clue: account menu, Assistant trading.');
  if (!w.enabled) throw fail(403, 'Assistant trading is switched off. Switch it on in Clue: account menu, Assistant trading.');
  const what = classify(td, w.address);
  if (what.kind === 'order' && what.side === 'BUY') {
    if (what.usd > w.max_order + 1e-9) throw fail(403, `This order is $${money(what.usd)}, over your limit of $${w.max_order} per order.`);
    const spent = await spentToday(store, userId, now);
    if (spent + what.usd > w.max_day + 1e-9) throw fail(403, `This order would take today's total to $${money(spent + what.usd)}, over your limit of $${w.max_day} a day.`);
  }
  const key = unseal(sealingKey, w.key_sealed);
  const r = await outlayer(key, 'POST', '/wallet/v1/evm/sign-typed-data', { chain: 'ethereum', typed_data: td });
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(r.signature || ''))) throw fail(502, 'OutLayer did not return a signature.');
  if (what.kind === 'order') await store.run('INSERT INTO agent_orders (id,user_id,created_at,day,side,token_id,usd) VALUES (?,?,?,?,?,?,?)', randomUUID(), userId, now.toISOString(), today(now), what.side, what.tokenId, money(what.usd));
  return { signature: r.signature, kind: what.kind };
}
