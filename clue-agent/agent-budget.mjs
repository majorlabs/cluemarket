// The person's budget for trades their AI makes. They set it in their own words in the chat; the AI turns it into numbers,
// and the person confirms it once in Clue. Only they can set or raise it. Lowering it or pausing works straight from the
// chat, since that only ever makes the AI do less. Trades inside the budget go from the person's own device while Clue is
// open, with no tap; anything outside it waits for an Approve as before.
import { randomUUID } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status, toolError: true });
const money = (n) => Math.round(Number(n) * 100) / 100;
const today = (now) => now.toISOString().slice(0, 10);

function check(a) {
  const perTrade = money(a.per_trade), perDay = money(a.per_day);
  if (!(perTrade >= 1 && perTrade <= 100000) || !(perDay >= 1 && perDay <= 1000000)) throw fail(400, 'Give a budget per trade and per day in dollars, each at least $1.');
  if (perTrade > perDay) throw fail(400, 'The most per trade cannot be more than the most per day.');
  const note = typeof a.note === 'string' ? a.note.replace(/\p{Cc}/gu, ' ').trim().slice(0, 200) : '';
  return { perTrade, perDay, note };
}
const shape = (r) => r ? { active: r.status === 'active', paused: r.status === 'off', perTrade: r.per_trade, perDay: r.per_day, note: r.note || '', confirmedAt: r.confirmed_at,
  pending: r.pending_id ? { id: r.pending_id, perTrade: r.pending_per_trade, perDay: r.pending_per_day, note: r.pending_note || '' } : null } : null;

export async function usedToday(store, userId, now = new Date()) {
  const r = await store.get("SELECT COALESCE(SUM(amount),0) AS t FROM agent_trades WHERE user_id=? AND auto=1 AND substr(created_at,1,10)=? AND status IN ('auto','sending','filled')", userId, today(now));
  return money(r?.t || 0);
}

export async function getBudget(store, userId, { now = new Date() } = {}) {
  const r = await store.get('SELECT * FROM agent_budgets WHERE user_id=?', userId);
  return { budget: shape(r), usedToday: await usedToday(store, userId, now) };
}

// From the chat. Lower or equal to a confirmed budget applies at once; anything else waits for the person to confirm in Clue.
export async function setBudget(store, userId, a, { now = new Date() } = {}) {
  const b = check(a), iso = now.toISOString();
  const r = await store.get('SELECT * FROM agent_budgets WHERE user_id=?', userId);
  if (r && r.status === 'active' && b.perTrade <= r.per_trade && b.perDay <= r.per_day) {
    await store.run('UPDATE agent_budgets SET per_trade=?, per_day=?, note=?, updated_at=? WHERE user_id=?', b.perTrade, b.perDay, b.note, iso, userId);
    return { applied: true };
  }
  const id = randomUUID();
  if (r) await store.run('UPDATE agent_budgets SET pending_id=?, pending_per_trade=?, pending_per_day=?, pending_note=?, updated_at=? WHERE user_id=?', id, b.perTrade, b.perDay, b.note, iso, userId);
  else await store.run("INSERT INTO agent_budgets (user_id,status,per_trade,per_day,note,pending_id,pending_per_trade,pending_per_day,pending_note,updated_at) VALUES (?,'none',0,0,'',?,?,?,?,?)", userId, id, b.perTrade, b.perDay, b.note, iso);
  return { applied: false, confirmId: id };
}

// In Clue, by the signed-in person: the only way a budget is created or raised.
export async function confirmBudget(store, userId, id, { now = new Date() } = {}) {
  const r = await store.get('SELECT * FROM agent_budgets WHERE user_id=? AND pending_id=?', userId, String(id || ''));
  if (!r) throw fail(404, 'This budget request has already been used or replaced. Ask your AI again.');
  const iso = now.toISOString();
  await store.run("UPDATE agent_budgets SET status='active', per_trade=pending_per_trade, per_day=pending_per_day, note=pending_note, confirmed_at=?, pending_id=NULL, pending_per_trade=NULL, pending_per_day=NULL, pending_note=NULL, updated_at=? WHERE user_id=?", iso, iso, userId);
  return getBudget(store, userId, { now });
}
export async function dropPending(store, userId) { await store.run('UPDATE agent_budgets SET pending_id=NULL, pending_per_trade=NULL, pending_per_day=NULL, pending_note=NULL WHERE user_id=?', userId); return { dropped: true }; }

// Pausing is allowed from the chat or Clue; resuming a paused budget only from Clue.
export async function pause(store, userId, { now = new Date() } = {}) {
  await store.run("UPDATE agent_budgets SET status='off', updated_at=? WHERE user_id=? AND status='active'", now.toISOString(), userId);
  await store.run("UPDATE agent_trades SET status='pending', auto=0, updated_at=? WHERE user_id=? AND status='auto'", now.toISOString(), userId);   // queued trades fall back to Approve
  return { paused: true };
}
export async function resume(store, userId, { now = new Date() } = {}) {
  const r = await store.run("UPDATE agent_budgets SET status='active', updated_at=? WHERE user_id=? AND status='off' AND per_trade>0", now.toISOString(), userId);
  if (!r.changes) throw fail(409, 'There is no paused budget to resume.');
  return { resumed: true };
}

/** Whether a trade of this size fits the person's confirmed budget right now. */
export async function fits(store, userId, amount, now = new Date()) {
  const r = await store.get("SELECT per_trade, per_day FROM agent_budgets WHERE user_id=? AND status='active'", userId);
  if (!r) return { fits: false, reason: 'no-budget' };
  if (amount > r.per_trade + 1e-9) return { fits: false, reason: `over your $${r.per_trade} per trade` };
  const used = await usedToday(store, userId, now);
  if (used + amount > r.per_day + 1e-9) return { fits: false, reason: `would take today to $${money(used + amount)}, over your $${r.per_day} a day` };
  return { fits: true };
}
