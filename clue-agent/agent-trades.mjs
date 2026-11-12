// You approve every trade. An AI app (Claude, ChatGPT, ...) prepares a trade; the person sees it in Clue on their own phone or computer and
// taps Approve, and the order goes from that device with their own trading account, exactly like a trade they place by hand.
// The AI never places the order and never touches money. A proposal expires after 15 minutes if nobody acts on it.
import { randomUUID } from 'node:crypto';
import { fits } from './agent-budget.mjs';

const TTL_MS = 15 * 60000;
const fail = (status, message) => Object.assign(new Error(message), { status, toolError: true });
const GAMMA = () => process.env.GAMMA_BASE || 'https://gamma-api.polymarket.com';
const parse = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

async function marketForToken(tokenId) {
  const u = new URL(GAMMA() + '/markets'); u.searchParams.set('clob_token_ids', tokenId);
  const r = await fetch(u, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } }).catch(() => null);
  const list = r && r.ok ? await r.json().catch(() => []) : [];
  const m = Array.isArray(list) ? list[0] : null;
  if (!m) return null;
  const ids = parse(m.clobTokenIds), i = ids.indexOf(tokenId);
  if (i < 0 || m.closed || m.acceptingOrders === false) return null;
  return { question: m.question, outcome: parse(m.outcomes)[i] || (i === 0 ? 'Yes' : 'No'), price: Number(parse(m.outcomePrices)[i]) || null, eventSlug: m.events?.[0]?.slug || m.slug || null };
}

const shape = (r) => ({ id: r.id, status: r.status, side: r.side, amount: r.amount, maxPrice: r.max_price, tokenId: r.token_id, question: r.market_question, outcome: r.outcome,
  eventSlug: r.event_slug, auto: Boolean(r.auto), createdAt: r.created_at, expiresAt: new Date(r.expires).toISOString(), result: r.result ? JSON.parse(r.result) : null });

async function expireOld(store, now) { await store.run("UPDATE agent_trades SET status='expired', updated_at=? WHERE status IN ('pending','auto') AND expires<?", now.toISOString(), now.getTime()); }

// One proposal at a time per person, so two sent together cannot both slip inside the day's budget.
const queues = new Map();
function serial(userId, fn) { const prev = queues.get(userId) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); queues.set(userId, next.catch(() => {})); return next; }
export function propose(store, userId, keyId, a, opts = {}) { return serial(userId, () => proposeNow(store, userId, keyId, a, opts)); }

async function proposeNow(store, userId, keyId, a, { now = new Date() } = {}) {
  const tokenId = String(a.token_id || '');
  if (!/^\d{1,100}$/.test(tokenId)) throw fail(400, 'Give the token_id of the outcome to buy, from get_market.');
  const amount = Math.round(Number(a.amount_usd) * 100) / 100, maxPrice = Number(a.max_price);
  if (!(amount >= 1 && amount <= 10000)) throw fail(400, 'The amount must be between $1 and $10,000.');
  if (!(maxPrice > 0 && maxPrice < 1)) throw fail(400, 'max_price is the most to pay per share, between 0 and 1 (for example 0.42).');
  const m = await marketForToken(tokenId);
  if (!m) throw fail(400, 'That outcome is not open for trading. Check the token_id with get_market.');
  await expireOld(store, now);
  const waiting = await store.all("SELECT id FROM agent_trades WHERE user_id=? AND status IN ('pending','auto')", userId);
  if (waiting.length >= 5) throw fail(429, 'Five trades are already waiting. Ask the person to approve or decline those first, or open Clue so queued ones can go.');
  // Inside the person's confirmed budget, the trade is queued to go from their own device with no tap. Otherwise it waits for Approve.
  const budget = await fits(store, userId, amount, now);
  const auto = budget.fits ? 1 : 0;
  const id = randomUUID(), iso = now.toISOString();
  await store.run('INSERT INTO agent_trades (id,user_id,key_id,created_at,updated_at,expires,token_id,side,amount,max_price,market_question,outcome,event_slug,status,auto) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, userId, keyId || null, iso, iso, now.getTime() + TTL_MS, tokenId, 'BUY', amount, maxPrice, m.question, m.outcome, m.eventSlug, auto ? 'auto' : 'pending', auto);
  return { id, market: m, auto: Boolean(auto), budgetReason: budget.reason };
}

export async function getTrade(store, userId, id, { now = new Date() } = {}) {
  await expireOld(store, now);
  const r = await store.get('SELECT * FROM agent_trades WHERE id=? AND user_id=?', String(id || ''), userId);
  if (!r) throw fail(404, 'No such trade.');
  return shape(r);
}

export async function listWaiting(store, userId, { now = new Date() } = {}) {
  await expireOld(store, now);
  return (await store.all("SELECT * FROM agent_trades WHERE user_id=? AND status IN ('pending','auto','sending') ORDER BY created_at DESC LIMIT 10", userId)).map(shape);
}

// The person's device takes the trade to send it. Only a pending trade can be taken, and only once, so it can never be sent twice.
export async function start(store, userId, id, { now = new Date() } = {}) {
  await expireOld(store, now);
  const r = await store.run("UPDATE agent_trades SET status='sending', updated_at=? WHERE id=? AND user_id=? AND status IN ('pending','auto')", now.toISOString(), String(id || ''), userId);
  if (!r.changes) throw fail(409, 'This trade is no longer waiting. It may have expired, or been approved or declined already.');
  return getTrade(store, userId, id, { now });
}

export async function decline(store, userId, id, { now = new Date() } = {}) {
  const r = await store.run("UPDATE agent_trades SET status='declined', updated_at=? WHERE id=? AND user_id=? AND status IN ('pending','auto')", now.toISOString(), String(id || ''), userId);
  if (!r.changes) throw fail(409, 'This trade is no longer waiting.');
  return { declined: true };
}

// What happened when the device sent it. Only a trade being sent can be finished.
export async function finish(store, userId, id, b, { now = new Date() } = {}) {
  const status = ['filled', 'unfilled', 'failed', 'checked'].includes(b.status) ? b.status : 'failed';
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const result = { shares: num(b.shares), paid: num(b.paid), avgPrice: num(b.avgPrice), orderId: typeof b.orderId === 'string' ? b.orderId.slice(0, 120) : null, message: typeof b.message === 'string' ? b.message.slice(0, 300) : null };
  const r = await store.run("UPDATE agent_trades SET status=?, result=?, updated_at=? WHERE id=? AND user_id=? AND status='sending'", status, JSON.stringify(result), now.toISOString(), String(id || ''), userId);
  if (!r.changes) throw fail(409, 'This trade is not being sent.');
  return getTrade(store, userId, id, { now });
}
