// A person's AI assistant can use Clue through MCP with a key they make on the site. The key reaches research, the
// Journal and the Portfolio as that person, and nothing else: no trading, no money, no keys.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const ai = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    chunk({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'https://example.org/evidence' } } }] });
    chunk({ choices: [{ delta: { content: '## The short answer\nLikely yes. [example.org](https://example.org/evidence)\n## How sure\nFairly sure.' }, finish_reason: 'stop' }] });
    chunk({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-mcp-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, NEAR_AI_API_KEY: 'k', NEAR_AI_BASE: `http://127.0.0.1:${ai.address().port}/v1`, CLUE_FREE_RESEARCH_PER_DAY: '3', CLUE_AI_DAILY_USD: '5', CLUE_MCP_POLL_MS: '200' };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); ai.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 400; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const site = async (method, path, cookie, body) => {
  const r = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let n = 0;
const rpc = async (key, method, params, extra = {}) => {
  const r = await fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tool = async (key, name, args = {}) => (await rpc(key, 'tools/call', { name, arguments: args })).body.result;

test('a key is made on the site, shown once, and listed without the secret', async () => {
  await ready();
  const ann = signup('ann');
  assert.equal((await site('POST', '/api/agent-keys', 'clue_wallet=nope', {})).status, 401);
  const made = await site('POST', '/api/agent-keys', ann, { label: 'Claude' });
  assert.equal(made.status, 201); assert.match(made.body.token, /^clue_ak_[0-9a-f]{48}$/);
  const list = (await site('GET', '/api/agent-keys', ann)).body.keys;
  assert.equal(list.length, 1); assert.equal(list[0].label, 'Claude'); assert.equal(JSON.stringify(list).includes(made.body.token), false);
});

test('no key or a wrong key is turned away', async () => {
  assert.equal((await rpc(null, 'initialize', {})).status, 401);
  assert.equal((await rpc('clue_ak_' + '0'.repeat(48), 'initialize', {})).status, 401);
  assert.equal((await rpc('Bearer junk', 'initialize', {})).status, 401);
});

test('an assistant can connect, list tools, and keep the Journal for its person only', async () => {
  const bob = signup('bob'), cat = signup('cat');
  const key = (await site('POST', '/api/agent-keys', bob, {})).body.token;
  const init = await rpc(key, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200); assert.equal(init.body.result.serverInfo.name, 'clue'); assert.equal(init.body.result.protocolVersion, '2025-06-18');
  const note = await fetch(base + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  const names = (await rpc(key, 'tools/list', {})).body.result.tools.map((t) => t.name);
  for (const t of ['search_markets', 'get_market', 'research', 'research_status', 'research_allowance', 'save_forecast', 'get_journal', 'get_portfolio']) assert.ok(names.includes(t), t);
  assert.equal(names.some((t) => /trade|order|withdraw|deposit|send/.test(t)), false);

  const saved = await tool(key, 'save_forecast', { question: 'Will it rain in Lagos tomorrow?', probability: 62, reasoning: 'Wet season.', change_condition: 'A dry forecast.' });
  assert.equal(saved.isError, false, JSON.stringify(saved)); assert.equal(saved.structuredContent.saved, true);
  const journal = (await site('GET', '/api/journal', bob)).body;
  assert.ok(JSON.stringify(journal).includes('Will it rain in Lagos tomorrow?'));
  assert.equal(JSON.stringify((await site('GET', '/api/journal', cat)).body).includes('Lagos'), false);
  assert.ok(JSON.stringify((await tool(key, 'get_journal')).structuredContent).includes('Lagos'));
  const bad = await tool(key, 'save_forecast', { question: 'Will it rain?', probability: 140, reasoning: 'x', change_condition: 'y' });
  assert.equal(bad.isError, true);
  assert.equal((await rpc(key, 'tools/call', { name: 'place_order', arguments: {} })).body.error.code, -32602);
});

test('research runs within the person\'s allowance and can be saved with a forecast', async () => {
  const dee = signup('dee');
  const key = (await site('POST', '/api/agent-keys', dee, {})).body.token;
  assert.equal((await tool(key, 'research_allowance')).structuredContent.remaining, 3);
  const r = await tool(key, 'research', { question: 'Will the bill pass this month?' });
  assert.equal(r.isError, false, JSON.stringify(r)); assert.match(r.structuredContent.answer, /Likely yes/); assert.equal(r.structuredContent.sources.length, 1);
  assert.equal((await tool(key, 'research_allowance')).structuredContent.remaining, 2);
  const s = await tool(key, 'save_forecast', { research_id: r.structuredContent.research_id, probability: 70, reasoning: 'Votes are there.', change_condition: 'A delay.' });
  assert.equal(s.isError, false, JSON.stringify(s));
  assert.ok(JSON.stringify((await site('GET', '/api/journal', dee)).body).includes('Will the bill pass this month?'));
});

test('a key cannot manage keys, trade or move money, and stops working once removed', async () => {
  const eve = signup('eve');
  const made = (await site('POST', '/api/agent-keys', eve, {})).body;
  const asKey = (path, method = 'GET') => fetch(base + path, { method, headers: { Authorization: 'Bearer ' + made.token, 'Content-Type': 'application/json', Origin: base }, body: method === 'GET' ? undefined : '{}' }).then((r) => r.status);
  for (const [p, m] of [['/api/agent-keys', 'GET'], ['/api/agent-keys', 'POST'], ['/api/fund/deposits', 'GET'], ['/api/trading/account', 'GET'], ['/api/journal', 'GET']]) assert.equal(await asKey(p, m), 401, p);
  assert.equal(await asKey('/api/pm/sign', 'POST'), 403);                                      // assistant trading is off for this account
  assert.deepEqual((await tool(made.token, 'get_portfolio')).structuredContent.account, null);
  assert.equal((await site('DELETE', '/api/agent-keys/' + made.id, eve)).status, 200);
  assert.equal((await rpc(made.token, 'tools/list', {})).status, 401);
  assert.equal((await site('GET', '/api/agent-keys', eve)).body.keys.length, 0);
});

test('one person cannot remove another person\'s key, and keys are capped', async () => {
  const fay = signup('fay'), gus = signup('gus');
  const k = (await site('POST', '/api/agent-keys', fay, {})).body;
  assert.equal((await site('DELETE', '/api/agent-keys/' + k.id, gus)).status, 404);
  assert.equal((await rpc(k.token, 'ping', {})).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await site('POST', '/api/agent-keys', fay, {})).status, 201);
  assert.equal((await site('POST', '/api/agent-keys', fay, {})).status, 400);
});
