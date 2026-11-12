// Personal keys that let a person's AI assistant (Claude, Codex, Cursor and others) use Clue for them through MCP.
// A key can read markets, run research within the person's free allowance, and keep their Journal. It cannot trade,
// move money or make more keys. Only a hash of each key is stored; the key itself is shown once, when it is made.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const KEY_PREFIX = 'clue_ak_';
export const MAX_KEYS = 5;
const hash = (token) => createHash('sha256').update(String(token)).digest('hex');
const looksLikeKey = (t) => typeof t === 'string' && t.startsWith(KEY_PREFIX) && /^[a-z0-9_]{40,80}$/.test(t);

export async function createKey(store, userId, label, { now = new Date() } = {}) {
  const name = String(label || 'My assistant').trim().slice(0, 60) || 'My assistant';
  const live = await store.all('SELECT id FROM agent_keys WHERE user_id=? AND revoked_at IS NULL', userId);
  if (live.length >= MAX_KEYS) throw Object.assign(new Error(`You can have up to ${MAX_KEYS} assistant keys. Remove one first.`), { status: 400 });
  const token = KEY_PREFIX + randomBytes(24).toString('hex');
  const id = randomUUID();
  await store.run('INSERT INTO agent_keys (id,user_id,token_hash,label,created_at) VALUES (?,?,?,?,?)', id, userId, hash(token), name, now.toISOString());
  return { id, label: name, token, createdAt: now.toISOString() };
}

export async function listKeys(store, userId) {
  return (await store.all('SELECT id, label, created_at, last_used_at FROM agent_keys WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC', userId))
    .map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at || null }));
}

export async function revokeKey(store, userId, id, { now = new Date() } = {}) {
  const r = await store.run('UPDATE agent_keys SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL', now.toISOString(), String(id), userId);
  return Boolean(r.changes);
}

/** The person a key belongs to, or null. Marks the key as used, at most once a minute. */
export async function userForToken(store, token, { now = new Date() } = {}) {
  if (!looksLikeKey(token)) return null;
  const row = await store.get('SELECT id, user_id, last_used_at FROM agent_keys WHERE token_hash=? AND revoked_at IS NULL', hash(token));
  if (!row) return null;
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > 60000) await store.run('UPDATE agent_keys SET last_used_at=? WHERE id=?', now.toISOString(), row.id);
  return { userId: row.user_id, keyId: row.id };
}
