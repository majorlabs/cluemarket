// The person's budget for their AI's trades: they say it in the chat, confirm it once in Clue, and trades inside it go from
// their own device without a tap. The AI can lower or pause it, never create or raise it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const TOKEN = '1234567890';
const gamma = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ question: 'Will it rain?', clobTokenIds: JSON.stringify([TOKEN]), outcomes: '["Yes"]', outcomePrices: '["0.4"]', closed: false, events: [{ slug: 'rain' }] }])); });
await new Promise((r) => gamma.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-bud-'));
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
const tool = (key, name, args = {}) => fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json()).then((j) => j.result);
const buy = (key, amount) => tool(key, 'propose_trade', { token_id: TOKEN, amount_usd: amount, max_price: 0.45 }).then((r) => r.structuredContent);

test('the AI asks for a budget, and nothing changes until the person confirms it in Clue', async () => {
  await ready();
  const ann = signup('ann'); const key = (await site('POST', '/api/agent-keys', ann, { canTrade: true })).body.token;
  assert.equal((await tool(key, 'get_budget')).structuredContent.budget, null);
  const ask = (await tool(key, 'set_budget', { per_trade: 5, per_day: 20, note: 'sports only' })).structuredContent;
  assert.equal(ask.status, 'waiting for the person to confirm'); assert.match(ask.confirm, /\/#\/budget\/[a-f0-9-]{36}$/);
  assert.equal((await buy(key, 3)).status, 'waiting for approval');                                    // not confirmed yet
  const id = ask.confirm.split('/').pop();
  const ok = await site('POST', '/api/agent-budget/confirm', ann, { id });
  assert.equal(ok.body.budget.active, true); assert.equal(ok.body.budget.perTrade, 5); assert.equal(ok.body.budget.note, 'sports only');
  assert.equal((await site('POST', '/api/agent-budget/confirm', ann, { id })).status, 404);           // used once
  // inside the budget: queued to go from the person's device, no Approve
  const t = await buy(key, 5);
  assert.equal(t.status, 'queued within your budget');
  assert.equal((await site('GET', '/api/agent-trades', ann)).body.trades.find((x) => x.id === t.trade_id).status, 'auto');
  assert.equal((await tool(key, 'trade_status', { trade_id: t.trade_id })).structuredContent.status, 'auto');
  // over the per-trade limit: back to Approve, with the reason
  const big = await buy(key, 6);
  assert.equal(big.status, 'waiting for approval'); assert.match(big.budget, /over your \$5 per trade/);
  // the device sends the queued one
  assert.equal((await site('POST', `/api/agent-trades/${t.trade_id}/start`, ann)).body.status, 'sending');
  await site('POST', `/api/agent-trades/${t.trade_id}/result`, ann, { status: 'filled', shares: 11, paid: 5 });
  for (const w of (await site('GET', '/api/agent-trades', ann)).body.trades.filter((x) => x.status === 'pending')) await site('POST', `/api/agent-trades/${w.id}/decline`, ann);
  for (let i = 0; i < 3; i++) assert.equal((await buy(key, 5)).status, 'queued within your budget');   // 5 + 15 = 20
  const over = await buy(key, 1);
  assert.equal(over.status, 'waiting for approval'); assert.match(over.budget, /over your \$20 a day/);
  assert.equal((await tool(key, 'get_budget')).structuredContent.usedToday, 20);
});

test('the AI can lower or pause the budget at once, but raising it needs the person again', async () => {
  const bob = signup('bob'); const key = (await site('POST', '/api/agent-keys', bob, { canTrade: true })).body.token;
  const id = (await tool(key, 'set_budget', { per_trade: 10, per_day: 50 })).structuredContent.confirm.split('/').pop();
  await site('POST', '/api/agent-budget/confirm', bob, { id });
  assert.equal((await tool(key, 'set_budget', { per_trade: 4, per_day: 30 })).structuredContent.status, 'lowered');
  assert.equal((await tool(key, 'get_budget')).structuredContent.perTrade, 4);
  const raise = (await tool(key, 'set_budget', { per_trade: 100, per_day: 500 })).structuredContent;
  assert.equal(raise.status, 'waiting for the person to confirm');
  assert.equal((await tool(key, 'get_budget')).structuredContent.perTrade, 4);                      // unchanged until confirmed
  assert.equal((await buy(key, 3)).status, 'queued within your budget');
  assert.equal((await tool(key, 'pause_trading')).structuredContent.paused, true);
  assert.equal((await site('GET', '/api/agent-trades', bob)).body.trades.every((x) => x.status === 'pending'), true);   // queued trades fall back to Approve
  assert.equal((await buy(key, 3)).status, 'waiting for approval');
  assert.equal((await site('POST', '/api/agent-budget/resume', bob)).body.resumed, true);
  assert.equal((await buy(key, 3)).status, 'queued within your budget');
});

test('only the person can confirm, resume or drop; bad budgets and read-only connections are refused', async () => {
  const cat = signup('cat'), dan = signup('dan');
  const key = (await site('POST', '/api/agent-keys', cat, { canTrade: true })).body.token;
  const ro = (await site('POST', '/api/agent-keys', cat, {})).body.token;
  assert.match((await tool(ro, 'set_budget', { per_trade: 5, per_day: 20 })).content[0].text, /can only read/);
  for (const bad of [{ per_trade: 0, per_day: 20 }, { per_trade: 50, per_day: 20 }, { per_trade: 'lots', per_day: 20 }]) assert.equal((await tool(key, 'set_budget', bad)).isError, true);
  const id = (await tool(key, 'set_budget', { per_trade: 5, per_day: 20 })).structuredContent.confirm.split('/').pop();
  assert.equal((await site('POST', '/api/agent-budget/confirm', dan, { id })).status, 404);           // someone else
  for (const p of ['confirm', 'resume', 'drop', 'pause'])
    assert.equal((await fetch(`${base}/api/agent-budget/${p}`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ id }) })).status, 401);
  assert.equal((await site('POST', '/api/agent-budget/drop', cat)).body.dropped, true);
  assert.equal((await site('POST', '/api/agent-budget/confirm', cat, { id })).status, 404);
});
