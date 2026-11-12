// Remembers every real deposit address a person asked for, so the page can show where each deposit is, even after a refresh.
// The money itself is never here: this is only a note of what was asked and the last status NEAR Intents gave.
import { randomUUID } from 'node:crypto';

const FINAL = new Set(['done', 'refunded', 'failed']);
export const isFinal = (state) => FINAL.has(state);

export async function saveDeposit(store, userId, q, { now = new Date(), id = randomUUID(), state = 'waiting' } = {}) {
  if (!userId || !q || !q.depositAddress || !q.send) return false;
  const t = now.toISOString();
  await store.run(
    'INSERT INTO fund_deposits (id,user_id,deposit_address,deposit_memo,send_symbol,send_chain,send_amount,send_usd,receive_amount,refund_to,deadline,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,deposit_address) DO NOTHING',
    id, userId, String(q.depositAddress), q.depositMemo || null, String(q.send.symbol), String(q.send.chain), String(q.send.amount), q.send.usd ?? null,
    q.receive && q.receive.amount ? String(q.receive.amount) : null, q.refundTo || null, q.swapDeadline || q.deadline || null, state, t, t);
  return true;
}

const shape = (r, now) => ({
  id: r.id, depositAddress: r.deposit_address,
  send: { symbol: r.send_symbol, chain: r.send_chain, amount: r.send_amount, usd: r.send_usd },
  receive: { amount: r.receive_amount }, refundTo: r.refund_to || null, deadline: r.deadline || null,
  state: r.state, delivered: r.delivered_amount || null, createdAt: r.created_at,
  final: isFinal(r.state),
  expired: r.state === 'waiting' && Boolean(r.deadline) && Number.isFinite(Date.parse(r.deadline)) && now > Date.parse(r.deadline),
});

/** A person's latest deposits. Any that are still on their way are asked about now, a few at a time, and the answer is kept. */
export async function listDeposits(store, userId, readStatus, { now = Date.now(), limit = 20, maxAgeDays = 7 } = {}) {
  const rows = await store.all(
    'SELECT id, deposit_address, send_symbol, send_chain, send_amount, send_usd, receive_amount, refund_to, deadline, state, delivered_amount, created_at FROM fund_deposits WHERE user_id=? ORDER BY created_at DESC LIMIT ?',
    userId, limit);
  const open = rows.filter((r) => !isFinal(r.state) && now - Date.parse(r.created_at) < maxAgeDays * 86400000).slice(0, 5);
  await Promise.all(open.map(async (r) => {
    try {
      const s = await readStatus(r.deposit_address);
      const amount = s && s.delivered && s.delivered.amount ? String(s.delivered.amount) : null;
      if (s && s.state && (s.state !== r.state || (amount && amount !== r.delivered_amount))) {
        await store.run('UPDATE fund_deposits SET state=?, delivered_amount=?, updated_at=? WHERE id=? AND user_id=?', s.state, amount ?? r.delivered_amount ?? null, new Date(now).toISOString(), r.id, userId);
        r.state = s.state; r.delivered_amount = amount ?? r.delivered_amount;
      }
    } catch { /* the saved state is shown, and the next look asks again */ }
  }));
  return rows.map((r) => shape(r, now));
}

/** Adds a deposit that was sent before the list existed, or from elsewhere, found by its address. Only what NEAR Intents itself reports is saved. */
export async function trackDeposit(store, userId, address, readStatus, describeAsset, { now = new Date() } = {}) {
  const s = await readStatus(address);
  if (!s || !s.quote) return { tracked: false, state: s ? s.state : null };
  const a = await Promise.resolve(describeAsset(s.quote.originAssetId)).catch(() => ({ symbol: 'coin', chain: '' }));
  const created = s.quote.createdAt && Number.isFinite(Date.parse(s.quote.createdAt)) ? new Date(s.quote.createdAt) : now;
  await saveDeposit(store, userId, {
    depositAddress: address, send: { symbol: a.symbol, chain: a.chain, amount: s.quote.sendAmount, usd: s.quote.sendUsd },
    receive: { amount: s.quote.receiveAmount }, refundTo: s.quote.refundTo, deadline: s.quote.deadline,
  }, { now: created, state: s.state });
  return { tracked: true, state: s.state };
}
