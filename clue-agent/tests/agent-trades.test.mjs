// Approve on your phone: an AI prepares a trade, the person approves or declines it in Clue on their own device, and the
// order goes from there. The AI can never approve, send, or see more than the status.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const TOKEN = '1234567890', CLOSED = '999';
const gamma = http.createServer((req, res) => {
  const id = new URL(req.url, 'http://x').searchParams.get('clob_token_ids');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (id === TOKEN) return res.end(JSON.stringify([{ question: 'Will it rain?', clobTokenIds: JSON.stringify([TOKEN, '55']), outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', closed: false, acceptingOrders: true, events: [{ slug: 'rain' }] }]));
  if (id === CLOSED) return res.end(JSON.stringify([{ question: 'Old', clobTokenIds: JSON.stringify([CLOSED]), outcomes: '["Yes"]', closed: true }]));
  res.end('[]');
});
await new Promise((r) => gamma.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-at-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, GAMMA_BASE: `http://127.0.0.1:${gamma.address().port}` };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); gamma.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 400; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const site = (method, path, cookie, body) => fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const tool = (key, name, args) => fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json()).then((j) => j.result);

test('an AI with trading allowed prepares a trade, and nothing happens until the person approves', async () => {
  await ready();
  const ann = signup('ann'); const key = (await site('POST', '/api/agent-keys', ann, { canTrade: true })).body.token;
  const r = await tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: 5, max_price: 0.45 });
  assert.equal(r.isError, false, JSON.stringify(r));
  const t = r.structuredContent;
  assert.match(t.approve, /\/#\/approve\/[a-f0-9-]{36}$/); assert.equal(t.buy, 'Yes on "Will it rain?"'); assert.equal(t.status, 'waiting for approval');
  assert.equal((await tool(key, 'trade_status', { trade_id: t.trade_id })).structuredContent.status, 'pending');
  const list = (await site('GET', '/api/agent-trades', ann)).body.trades;
  assert.equal(list.length, 1); assert.equal(list[0].amount, 5); assert.equal(list[0].maxPrice, 0.45); assert.equal(list[0].eventSlug, 'rain');
  // the phone takes it once; a second tap cannot send it again
  assert.equal((await site('POST', `/api/agent-trades/${t.trade_id}/start`, ann)).body.status, 'sending');
  assert.equal((await site('POST', `/api/agent-trades/${t.trade_id}/start`, ann)).status, 409);
  const done = await site('POST', `/api/agent-trades/${t.trade_id}/result`, ann, { status: 'filled', shares: 11.2, paid: 5, avgPrice: 0.446, orderId: '0xabc' });
  assert.equal(done.body.status, 'filled'); assert.equal(done.body.result.shares, 11.2);
  const s = (await tool(key, 'trade_status', { trade_id: t.trade_id })).structuredContent;
  assert.equal(s.status, 'filled'); assert.equal(s.meaning, 'Filled.');
  assert.equal((await site('POST', `/api/agent-trades/${t.trade_id}/result`, ann, { status: 'failed' })).status, 409);   // finished once
});

test('read-only connections, bad trades, closed markets and too many waiting are refused', async () => {
  const bob = signup('bob');
  const ro = (await site('POST', '/api/agent-keys', bob, {})).body.token;
  assert.match((await tool(ro, 'propose_trade', { token_id: TOKEN, amount_usd: 5, max_price: 0.45 })).content[0].text, /can only read/);
  const key = (await site('POST', '/api/agent-keys', bob, { canTrade: true })).body.token;
  for (const bad of [{ token_id: 'abc', amount_usd: 5, max_price: 0.4 }, { token_id: TOKEN, amount_usd: 0.5, max_price: 0.4 }, { token_id: TOKEN, amount_usd: 5, max_price: 1.2 }, { token_id: CLOSED, amount_usd: 5, max_price: 0.4 }, { token_id: '42', amount_usd: 5, max_price: 0.4 }])
    assert.equal((await tool(key, 'propose_trade', bad)).isError, true, JSON.stringify(bad));
  for (let i = 0; i < 5; i++) assert.equal((await tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: 2, max_price: 0.45 })).isError, false);
  assert.match((await tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: 2, max_price: 0.45 })).content[0].text, /Five trades are already waiting/);
});

test('declining, other people, and expiry', async () => {
  const cat = signup('cat'), dan = signup('dan');
  const key = (await site('POST', '/api/agent-keys', cat, { canTrade: true })).body.token;
  const a = (await tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: 3, max_price: 0.45 })).structuredContent.trade_id;
  assert.equal((await site('GET', `/api/agent-trades/${a}`, dan)).status, 404);                       // someone else's trade
  assert.equal((await site('POST', `/api/agent-trades/${a}/start`, dan)).status, 409);
  assert.equal((await site('POST', `/api/agent-trades/${a}/decline`, cat)).body.declined, true);
  assert.equal((await tool(key, 'trade_status', { trade_id: a })).structuredContent.status, 'declined');
  assert.equal((await site('POST', `/api/agent-trades/${a}/start`, cat)).status, 409);
  const b = (await tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: 3, max_price: 0.45 })).structuredContent.trade_id;
  const db = new Database(join(dir, 'clue.sqlite')); db.prepare('UPDATE agent_trades SET expires=? WHERE id=?').run(Date.now() - 1000, b); db.close();
  assert.equal((await tool(key, 'trade_status', { trade_id: b })).structuredContent.status, 'expired');
  assert.equal((await site('POST', `/api/agent-trades/${b}/start`, cat)).status, 409);
});

test('an AI cannot approve: the approval routes need the person signed in on their own device', async () => {
  const eve = signup('eve'); const key = (await site('POST', '/api/agent-keys', eve, { canTrade: true })).body.token;
  const id = (await tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: 3, max_price: 0.45 })).structuredContent.trade_id;
  for (const p of [`/api/agent-trades/${id}/start`, `/api/agent-trades/${id}/result`, `/api/agent-trades/${id}/decline`])
    assert.equal((await fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Origin: base }, body: '{}' })).status, 401);
  assert.equal((await site('GET', `/api/agent-trades/${id}`, eve)).body.status, 'pending');
});
