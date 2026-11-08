import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// A stand-in for NEAR AI Cloud: streams one search result and an answer, and reports token usage. No real credit is spent.
let mode = 'ok', calls = 0;
const fake = http.createServer((req, res) => {
  calls++;
  if (mode === 'down') { res.writeHead(500); return res.end('{}'); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'Result: https://example.org/evidence' } } }] });
  chunk({ choices: [{ delta: { content: 'Reported facts are in https://example.org/evidence. Evidence is thin.' } }] });
  if (mode === 'ok') chunk({ choices: [], usage: { prompt_tokens: 20000, completion_tokens: 1000 } });   // 20000*0.08/1e6 + 1000*0.5/1e6 = $0.0021
  res.end('data: [DONE]\n\n');
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));

const dir = await mkdtemp(join(tmpdir(), 'clue-free-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, NEAR_AI_API_KEY: 'test-key', NEAR_AI_BASE: `http://127.0.0.1:${fake.address().port}/v1`, CLUE_FREE_RESEARCH_PER_DAY: '2', CLUE_AI_DAILY_USD: '0.05', CLUE_AI_RUN_ESTIMATE_USD: '0.02' };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise(r => server.once('exit', r)); fake.close(); await rm(dir, { recursive: true, force: true }); });

async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('server failed to start'); }
async function request(path, { cookie, body } = {}) {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signup = name => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return { cookie: 'clue_wallet=' + token };
};
const ask = u => request('/api/research', { cookie: u.cookie, body: { question: 'Will the thing happen by March?' } });
const spent = () => { const db = new Database(join(dir, 'clue.sqlite')); const r = db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s, COUNT(*) AS n FROM ai_usage WHERE status<>'failed'").get(); db.close(); return r; };

test('two free researches a day per account, then a clear stop', async () => {
  await ready();
  const a = signup('alice');
  assert.equal((await request('/api/research/allowance')).status, 401);
  assert.equal((await request('/api/research/allowance', { cookie: a.cookie })).body.remaining, 2);
  const first = await ask(a); assert.equal(first.status, 200); assert.equal(first.body.allowance.remaining, 1);
  assert.equal((await ask(a)).status, 200);
  const third = await ask(a);
  assert.equal(third.status, 429);
  assert.match(third.body.error, /2 free researches/);
  assert.equal(third.body.allowance.remaining, 0);
  assert.equal(calls, 2);                                   // the provider was never called for the third request
});

test('the cost recorded is what the provider reported, not a guess', () => {
  const s = spent();
  assert.equal(s.n, 2);
  assert.ok(Math.abs(s.s - 2 * 0.0021) < 1e-6, `spent ${s.s}`);
});

test('a provider failure does not use up the free run or the cap', async () => {
  const b = signup('bob');
  mode = 'down';
  const before = calls;
  assert.equal((await ask(b)).status, 502);
  assert.equal(calls, before + 1);
  mode = 'ok';
  assert.equal((await request('/api/research/allowance', { cookie: b.cookie })).body.remaining, 2);
  assert.equal((await ask(b)).status, 200);
});

test('the shared dollar cap pauses research for everyone, even accounts with free runs left', async () => {
  // Cap is $0.05 and a run with no usage report is charged the $0.02 estimate: after real spend of ~$0.0063,
  // runs with no usage report fill the rest, and the next one is refused before any provider call.
  mode = 'silent';
  let refused = null;
  for (const name of ['c1', 'c2', 'c3', 'c4']) { const u = signup(name); const r = await ask(u); if (r.status === 429) { refused = r; break; } assert.equal(r.status, 200); }
  assert.ok(refused, 'the cap should have stopped a run');
  assert.match(refused.body.error, /paused for today/);
  assert.ok(spent().s <= 0.05 + 1e-9, `spent ${spent().s}`);
  const before = calls;
  const late = signup('late');
  assert.equal((await ask(late)).status, 429);
  assert.equal(calls, before);                              // no provider call once paused
  assert.equal((await request('/api/research/allowance', { cookie: late.cookie })).body.paused, true);
});
