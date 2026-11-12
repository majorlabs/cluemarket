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
const CLOB = () => process.env.CLOB_BASE || 'https://clob.polymarket.com';
// How far from the market's middle price an order may be. A buy above it, or a sell below it, is refused.
const SLACK = () => Math.min(0.2, Math.max(0.01, Number(process.env.CLUE_AGENT_PRICE_SLACK) || 0.05));
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
  if (r.status === 401 || r.status === 403) throw fail(400, 'OutLayer refused. Check the wallet key, that the wallet is not frozen, and that its policy allows evm_sign.');
  if (!r.ok) { console.log('outlayer error', r.status, String(j.message || j.error || '').slice(0, 200)); throw fail(502, `OutLayer could not sign right now (${r.status}). Try again in a minute.`); }
  return j;
}

const limits = (b) => {
  const maxOrder = Number(b.maxOrder), maxDay = Number(b.maxDay);
  if (!Number.isFinite(maxOrder) || maxOrder <= 0 || maxOrder > 1e7 || !Number.isFinite(maxDay) || maxDay <= 0 || maxDay > 1e8) throw fail(400, 'Set a limit per order and per day, in dollars, above zero.');
  if (maxOrder > maxDay) throw fail(400, 'The limit per order cannot be more than the limit per day.');
  return { maxOrder: money(maxOrder), maxDay: money(maxDay) };
};

const SPENT = "SELECT COALESCE(SUM(usd),0) AS total FROM agent_orders WHERE user_id=? AND day=? AND side='BUY' AND status IN ('pending','signed')";
async function spentToday(db, userId, now) { const r = await db.get(SPENT, userId, today(now)); return money(Number(r?.total || 0)); }

// The market's middle price for one outcome, read from Polymarket's public prices. No price, no signature.
async function midpoint(tokenId) {
  try {
    const r = await fetch(`${CLOB()}/midpoint?token_id=${encodeURIComponent(tokenId)}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    const mid = Number((await r.json()).mid);
    return r.ok && mid > 0 && mid < 1 ? mid : null;
  } catch { return null; }
}

const log = (db, userId, now, e) => db.run('INSERT INTO agent_orders (id,user_id,created_at,day,kind,side,token_id,usd,price,status,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  randomUUID(), userId, now.toISOString(), today(now), e.kind, e.side || null, e.tokenId || null, e.usd || 0, e.price ?? null, e.status, e.reason || null);

export async function activity(store, userId, limit = 20) {
  return (await store.all('SELECT created_at, kind, side, usd, price, status, reason FROM agent_orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, limit))
    .map((r) => ({ at: r.created_at, kind: r.kind, side: r.side, usd: r.usd, price: r.price, status: r.status, reason: r.reason }));
}

export async function describeWallet(store, userId, { now = new Date() } = {}) {
  const w = await store.get('SELECT address, enabled, max_order, max_day, created_at, updated_at FROM agent_wallets WHERE user_id=?', userId);
  if (!w) return { wallet: null };
  return { wallet: { provider: 'outlayer', address: w.address, enabled: Boolean(w.enabled), maxOrder: w.max_order, maxDay: w.max_day, spentToday: await spentToday(store, userId, now), connectedAt: w.created_at }, activity: await activity(store, userId, 10) };
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
// The exact shapes Polymarket's own software signs. A request with any other field or type is refused, so a signature
// can never mean something different from what Clue checked.
const F = (list) => list.map(([name, type]) => ({ name, type }));
const SHAPES = {
  ClobAuth: F([['address', 'address'], ['timestamp', 'string'], ['nonce', 'uint256'], ['message', 'string']]),
  Order: F([['salt', 'uint256'], ['maker', 'address'], ['signer', 'address'], ['tokenId', 'uint256'], ['makerAmount', 'uint256'], ['takerAmount', 'uint256'], ['side', 'uint8'], ['signatureType', 'uint8'], ['timestamp', 'uint256'], ['metadata', 'bytes32'], ['builder', 'bytes32']]),
  TypedDataSign: F([['contents', 'Order'], ['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']]),
  Batch: F([['wallet', 'address'], ['nonce', 'uint256'], ['deadline', 'uint256'], ['calls', 'Call[]']]),
  Call: F([['target', 'address'], ['value', 'uint256'], ['data', 'bytes']]),
};
const NEEDS = { ClobAuth: ['ClobAuth'], Order: ['Order'], TypedDataSign: ['TypedDataSign', 'Order'], Batch: ['Batch', 'Call'] };
const DOMAIN_FIELDS = ['name', 'version', 'chainId', 'verifyingContract', 'salt'];
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((f, i) => f && f.name === b[i].name && f.type === b[i].type);
const big = (v) => { try { return BigInt(v); } catch { throw fail(400, 'Invalid number in the signing request.'); } };

function checkShape(td) {
  const want = NEEDS[td.primaryType];
  if (!want) throw fail(403, 'That request cannot be signed. Clue signs only sign-in, orders and trading permissions.');
  for (const [name, fields] of Object.entries(td.types)) {
    if (name === 'EIP712Domain') { if (!Array.isArray(fields) || !fields.every((f) => f && DOMAIN_FIELDS.includes(f.name))) throw fail(403, 'Unexpected signing domain.'); continue; }
    if (!want.includes(name) || !same(fields, SHAPES[name])) throw fail(403, 'That request does not match what Polymarket signs, so Clue did not sign it.');
  }
  for (const name of want) if (!td.types[name]) throw fail(400, 'Invalid signing request.');
  if (Number(td.domain.chainId) !== 137) throw fail(403, 'Only Polygon is supported.');
}

export function classify(td, address) {
  if (!td || typeof td !== 'object' || !td.domain || typeof td.domain !== 'object' || !td.message || typeof td.message !== 'object' || !td.types || typeof td.types !== 'object' || typeof td.primaryType !== 'string') throw fail(400, 'Invalid signing request.');
  checkShape(td);
  const t = td.primaryType, d = td.domain, m = td.message;
  if (t === 'ClobAuth') {
    if (d.name !== 'ClobAuthDomain' || String(d.version) !== '1' || d.verifyingContract !== undefined) throw fail(403, 'Unexpected sign-in request.');
    if (lower(m.address) !== lower(address)) throw fail(403, 'Sign-in must be for this wallet.');
    return { kind: 'signin' };
  }
  if (t === 'Order' || t === 'TypedDataSign') {
    if (d.name !== 'Polymarket CTF Exchange' || !EXCHANGES.has(lower(d.verifyingContract))) throw fail(403, 'Orders can only be for Polymarket\'s exchanges.');
    const o = t === 'Order' ? m : m.contents;
    if (!o || typeof o !== 'object') throw fail(400, 'Invalid order.');
    if (lower(o.maker) !== lower(o.signer)) throw fail(403, 'An order must be made and signed by the same account.');
    if (t === 'Order' && lower(o.signer) !== lower(address)) throw fail(403, 'Orders must be for this wallet.');
    if (t === 'TypedDataSign' && (m.name !== 'DepositWallet' || String(m.version) !== '1' || Number(m.chainId) !== 137 || lower(m.verifyingContract) !== lower(o.signer))) throw fail(403, 'Unexpected trading account in this order.');
    const side = String(o.side) === '0' || o.side === 'BUY' ? 'BUY' : String(o.side) === '1' || o.side === 'SELL' ? 'SELL' : null;
    if (!side) throw fail(400, 'Invalid order side.');
    const maker = big(o.makerAmount), taker = big(o.takerAmount); big(o.tokenId);
    if (maker <= 0n || taker <= 0n || maker > 10n ** 15n || taker > 10n ** 15n) throw fail(400, 'Invalid order amounts.');
    const price = side === 'BUY' ? Number(maker) / Number(taker) : Number(taker) / Number(maker);
    if (!(price > 0 && price < 1)) throw fail(403, 'An order price must be between 0 and 1 dollar a share.');
    // usd: what a buy spends, or what a sell brings in. Both are held to the limit per order; buys also count toward the day.
    return { kind: 'order', side, tokenId: String(o.tokenId), usd: Number(side === 'BUY' ? maker : taker) / 1e6, price };
  }
  // Batch: the trading account's one-time permissions.
  if (d.name !== 'DepositWallet' || String(d.version) !== '1' || lower(d.verifyingContract) !== lower(m.wallet)) throw fail(403, 'Unexpected trading account in this request.');
  const calls = m.calls;
  if (!Array.isArray(calls) || !calls.length || calls.length > 12) throw fail(403, 'That request cannot be signed.');
  for (const c of calls) {
    if (!c || typeof c !== 'object' || Object.keys(c).some((k) => !['target', 'value', 'data'].includes(k))) throw fail(403, 'That request cannot be signed.');
    const data = lower(c.data);
    if (big(c.value || 0) !== 0n || !TOKENS.has(lower(c.target))) throw fail(403, 'Only Polymarket trading permissions can be signed.');
    if (!(data.startsWith(APPROVE) || data.startsWith(APPROVE_ALL)) || data.length !== 138 || !/^0x[0-9a-f]+$/.test(data)) throw fail(403, 'Only Polymarket trading permissions can be signed.');
    if (data.startsWith(APPROVE) && lower(c.target) !== lower(C.collateralToken)) throw fail(403, 'Only Polymarket trading permissions can be signed.');
    if (data.startsWith(APPROVE_ALL) && lower(c.target) !== lower(C.conditionalTokens)) throw fail(403, 'Only Polymarket trading permissions can be signed.');
    const who = '0x' + data.slice(34, 74);
    if (data.slice(10, 34) !== '0'.repeat(24) || !SPENDERS.has(who)) throw fail(403, 'Permissions can only go to Polymarket\'s own contracts.');
  }
  return { kind: 'approval' };
}

// One signature at a time per person, so two orders sent together cannot both slip under the daily limit.
const queues = new Map();
function serial(userId, fn) {
  const prev = queues.get(userId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(userId, next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); }).catch(() => {}));
  return next;
}

export function signFor(store, sealingKey, userId, td, opts = {}) { return serial(userId, () => signNow(store, sealingKey, userId, td, opts)); }

async function signNow(store, sealingKey, userId, td, { now = new Date() } = {}) {
  const w = await store.get('SELECT key_sealed, address, enabled, max_order, max_day FROM agent_wallets WHERE user_id=?', userId);
  if (!w) throw fail(404, 'No assistant wallet is connected. Connect one in Clue: Agents, Assistant trading.');
  if (!w.enabled) throw fail(403, 'Assistant trading is switched off. Switch it on in Clue: Agents, Assistant trading.');
  let what;
  try { what = classify(td, w.address); } catch (e) { await log(store, userId, now, { kind: String(td?.primaryType || 'unknown').slice(0, 40), status: 'refused', reason: e.message }); throw e; }
  let entry = null;
  if (what.kind === 'order') {
    const refuse = async (reason) => { await log(store, userId, now, { ...what, status: 'refused', reason }); throw fail(403, reason); };
    const mid = await midpoint(what.tokenId);
    if (mid === null) await refuse('Clue could not read this market\'s price right now, so it did not sign. Try again in a minute.');
    const slack = SLACK();
    if (what.side === 'BUY' && what.price > mid + slack) await refuse(`This buy is at ${Math.round(what.price * 100)}¢ but the market is at about ${Math.round(mid * 100)}¢. Clue signs buys up to ${Math.round(slack * 100)}¢ above the market.`);
    if (what.side === 'SELL' && what.price < mid - slack) await refuse(`This sell is at ${Math.round(what.price * 100)}¢ but the market is at about ${Math.round(mid * 100)}¢. Clue signs sells down to ${Math.round(slack * 100)}¢ below the market.`);
    if (what.usd > w.max_order + 1e-9) await refuse(`This ${what.side === 'BUY' ? 'buy' : 'sell'} is $${money(what.usd)}, over your limit of $${w.max_order} per order.`);
    const spent = await spentToday(store, userId, now);
    if (what.side === 'BUY' && spent + what.usd > w.max_day + 1e-9) await refuse(`This order would take today's total to $${money(spent + what.usd)}, over your limit of $${w.max_day} a day.`);
    entry = randomUUID();
    await store.run('INSERT INTO agent_orders (id,user_id,created_at,day,kind,side,token_id,usd,price,status) VALUES (?,?,?,?,?,?,?,?,?,?)', entry, userId, now.toISOString(), today(now), 'order', what.side, what.tokenId, money(what.usd), what.price, 'pending');
  }
  let key;
  try { key = unseal(sealingKey, w.key_sealed); }
  catch { if (entry) await store.run("UPDATE agent_orders SET status='failed', reason=? WHERE id=?", 'wallet key could not be opened', entry); throw fail(409, 'Clue can no longer open your wallet key. Disconnect the wallet in Clue and connect it again.'); }
  let r;
  try { r = await outlayer(key, 'POST', '/wallet/v1/evm/sign-typed-data', { chain: 'ethereum', typed_data: td }); }
  catch (e) { if (entry) await store.run("UPDATE agent_orders SET status='failed', reason=? WHERE id=?", String(e.message).slice(0, 200), entry); throw e; }
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(r.signature || ''))) { if (entry) await store.run("UPDATE agent_orders SET status='failed', reason=? WHERE id=?", 'no signature', entry); throw fail(502, 'OutLayer did not return a signature.'); }
  if (entry) await store.run("UPDATE agent_orders SET status='signed' WHERE id=?", entry);
  else await log(store, userId, now, { kind: what.kind, status: 'signed' });
  return { signature: r.signature, kind: what.kind };
}
