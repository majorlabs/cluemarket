// Research can take a minute, longer than a proxy will hold one request open. The server starts it, returns a ticket
// straight away, and the page checks on it. A deliberately slow stand-in for the AI shows this.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

let mode = 'slow', calls = 0, lastPrompt = '';
const ai = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    try { lastPrompt = JSON.parse(raw).messages[0].content; } catch { /* not a chat request */ }
    if (mode === 'down') { res.writeHead(500); return res.end('{}'); }
    calls++;
    if (mode === 'cut-once' && calls % 2 === 1 || mode === 'cut-always') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Evidence is th'); return res.end();            // the answer is cut off mid-line
    }
    if (mode === 'length-once' && calls % 2 === 1) {                                                  // the model ran out of room mid-answer
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'https://example.org/evidence' } } }] });
      chunk({ choices: [{ delta: { content: 'Answer: not yet clear, but the latest report from' }, finish_reason: 'length' }] });
      return res.end('data: [DONE]\n\n');
    }
    if (mode === 'stall') {                                                                           // the model searches, starts answering, then goes quiet
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'https://example.org/evidence' } } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The evidence so far' } }] })}\n\n`);
      setTimeout(() => res.end(), 8000);
      return;
    }
    if (mode === 'preamble') {                                                                        // the model says what it will do, searches, then answers
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ choices: [{ delta: { content: "I'll search for current context on this question." } }] });
      chunk({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'https://example.org/evidence' } } }] });
      chunk({ choices: [{ delta: { content: 'Evidence is mixed: https://example.org/evidence' }, finish_reason: 'stop' }] });
      return res.end('data: [DONE]\n\n');
    }
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'https://example.org/evidence' } } }] });
      chunk({ choices: [{ delta: { content: 'Evidence is thin: https://example.org/evidence' } }] });
      chunk({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
      res.end('data: [DONE]\n\n');
    }, 1500);
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-rj-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, NEAR_AI_API_KEY: 'k', NEAR_AI_BASE: `http://127.0.0.1:${ai.address().port}/v1`, CLUE_FREE_RESEARCH_PER_DAY: '10', CLUE_AI_DAILY_USD: '5', CLUE_RESEARCH_DEADLINE_MS: '4000' };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); ai.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};
const start = (cookie) => fetch(base + '/api/research', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ question: 'Will the thing happen by March?' }) });
const check = (cookie, id) => fetch(base + '/api/research/' + id, { headers: { Cookie: cookie } });
async function untilFinished(cookie, id) { for (let i = 0; i < 100; i++) { const j = await (await check(cookie, id)).json(); if (j.status !== 'running') return j; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never finished'); }

test('the answer to starting research is immediate, even when the AI takes a while', async () => {
  await ready();
  const cookie = signup('alice');
  const t0 = Date.now();
  const r = await start(cookie);
  assert.equal(r.status, 202);
  assert.ok(Date.now() - t0 < 1000, `start took ${Date.now() - t0}ms`);      // the AI needs 1.5s: the start does not wait for it
  const { researchId } = await r.json();
  assert.equal((await (await check(cookie, researchId)).json()).status, 'running');
  const done = await untilFinished(cookie, researchId);
  assert.equal(done.status, 'done');
  assert.match(done.content, /Evidence is thin/);
  assert.deepEqual(done.sources, ['https://example.org/evidence']);
  assert.equal(done.allowance.usedToday, 1);
  // once finished, asking again gives the same result (it is saved, not just remembered)
  assert.equal((await (await check(cookie, researchId)).json()).status, 'done');
});

test('only one research at a time per person; others are not affected', async () => {
  const cookie = signup('bob'), other = signup('erin');
  const first = await start(cookie); assert.equal(first.status, 202);
  const second = await start(cookie);
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /still running/);
  assert.equal((await start(other)).status, 202);                                // someone else can start
  await untilFinished(cookie, (await first.json()).researchId);
  assert.equal((await start(cookie)).status, 202);                               // and bob can again once the first is done
});

test("nobody can read someone else's research ticket", async () => {
  const cookie = signup('carol'), spy = signup('mallory');
  const { researchId } = await (await start(cookie)).json();
  await untilFinished(cookie, researchId);
  assert.equal((await check(spy, researchId)).status, 404);
  assert.equal((await fetch(base + '/api/research/' + researchId)).status, 401);
  assert.equal((await check(spy, '00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await check(spy, 'not-a-ticket')).status, 404);
});

test('a failed research says so plainly and does not use up the free run', async () => {
  const cookie = signup('dave');
  mode = 'down';
  const { researchId } = await (await start(cookie)).json();
  const j = await untilFinished(cookie, researchId);
  mode = 'slow';
  assert.equal(j.status, 'failed');
  assert.match(j.error, /isn.t available right now/);
  assert.ok(!/HTTP|server|NEAR AI|configur|API_KEY|provider/i.test(j.error), j.error);   // no developer wording reaches the user
  const a = await (await fetch(base + '/api/research/allowance', { headers: { Cookie: cookie } })).json();
  assert.equal(a.usedToday, 0);
});

test('an answer cut off once is recovered by a second try, and counts as one free research', async () => {
  const cookie = signup('frank');
  mode = 'cut-once'; calls = 1;                                                  // the next request is the first of a pair: it is cut off
  const { researchId } = await (await start(cookie)).json();
  const j = await untilFinished(cookie, researchId);
  mode = 'slow';
  assert.equal(j.status, 'done');
  assert.match(j.content, /Evidence is thin/);
  assert.equal(j.allowance.usedToday, 1);
});

test('an answer that is always cut off fails plainly and costs no free research', async () => {
  const cookie = signup('gina');
  mode = 'cut-always';
  const { researchId } = await (await start(cookie)).json();
  const j = await untilFinished(cookie, researchId);
  mode = 'slow';
  assert.equal(j.status, 'failed');
  assert.match(j.error, /didn.t come back complete/);
  const a = await (await fetch(base + '/api/research/allowance', { headers: { Cookie: cookie } })).json();
  assert.equal(a.usedToday, 0);
});

test('only what the model writes after it searches is kept as the answer', async () => {
  const cookie = signup('hana');
  mode = 'preamble';
  const { researchId } = await (await start(cookie)).json();
  const j = await untilFinished(cookie, researchId);
  mode = 'slow';
  assert.equal(j.status, 'done');
  assert.match(j.content, /^Evidence is mixed/);
  assert.doesNotMatch(j.content, /I'll search/);
});

test('an answer that ran out of room is tried again, not saved half-written', async () => {
  const cookie = signup('ivan');
  mode = 'length-once'; calls = 0;                                               // the next request is the first of a pair: it runs out of room
  const { researchId } = await (await start(cookie)).json();
  const j = await untilFinished(cookie, researchId);
  mode = 'slow';
  assert.equal(j.status, 'done');
  assert.match(j.content, /Evidence is thin/);
  assert.doesNotMatch(j.content, /latest report from/);
});

test('an answer that never finishes stops at the deadline, says so plainly and costs no free research', async () => {
  const cookie = signup('jade');
  mode = 'stall';
  const { researchId } = await (await start(cookie)).json();
  let j; for (let i = 0; i < 100; i++) { j = await (await check(cookie, researchId)).json(); if (j.status !== 'running') break; await new Promise((r) => setTimeout(r, 200)); }
  mode = 'slow';
  assert.equal(j.status, 'failed');
  assert.match(j.error, /taking longer than usual/);
  const a = await (await fetch(base + '/api/research/allowance', { headers: { Cookie: cookie } })).json();
  assert.equal(a.usedToday, 0);
});

test("the AI is told today's date, so a question without a year means this year", async () => {
  const cookie = signup('kofi');
  mode = 'slow';
  const { researchId } = await (await start(cookie)).json();
  await untilFinished(cookie, researchId);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(lastPrompt.includes(`Today is ${today}`), lastPrompt.slice(-400));
  assert.ok(lastPrompt.includes(String(new Date().getUTCFullYear())));
});

test('the AI is asked for a short answer in a fixed layout, not a long report', async () => {
  const cookie = signup('lena');
  mode = 'slow';
  const { researchId } = await (await start(cookie)).json();
  await untilFinished(cookie, researchId);
  assert.match(lastPrompt, /under 200 words/);
  assert.match(lastPrompt, /For means evidence that the answer to the question is Yes/);
  assert.match(lastPrompt, /latest information/);
  assert.match(lastPrompt, /last 48 hours/);
  for (const h of ['## The short answer', '## For', '## Against', '## What to watch', '## How sure']) assert.ok(lastPrompt.includes(h), h);
});
