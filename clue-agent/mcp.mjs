// Clue over MCP: lets a person's AI assistant search markets, run research, keep the Journal and read the Portfolio for them.
// Speaks MCP's Streamable HTTP transport (JSON-RPC over POST, plain JSON replies). Each tool is passed to one of Clue's own
// routes, as the key's owner, so the same rules and limits apply as on the site. Nothing here can trade or move money.
import { Readable } from 'node:stream';
import { store } from './auth.mjs';
import { userForToken } from './agent-keys.mjs';
import { AGENT_USER } from './agent-user.mjs';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'clue', title: 'Clue', version: '1.0.0' };
const INSTRUCTIONS = 'Clue is a prediction market research desk. Search live markets, run sourced research on a question, save a forecast to the person\'s Journal, and read their Portfolio. Prices are shown as chances from 0 to 100. Research uses the person\'s free daily allowance and can take up to two minutes.';
const RESEARCH_WAIT_MS = Number(process.env.CLUE_MCP_RESEARCH_WAIT_MS || 170000);
const POLL_MS = Number(process.env.CLUE_MCP_POLL_MS || 2000);

const pct = (p) => (p === null || p === undefined || p === '' || !Number.isFinite(Number(p)) ? null : Math.round(Number(p) * 1000) / 10);
const market = (m) => ({ id: String(m.id), question: m.question, outcomes: (m.outcomes || []).map((o, i) => ({ outcome: o, chance: pct(m.outcomePrices?.[i]) })), endDate: m.endDate || null, volume: m.volume ?? null, slug: m.marketSlug || null });
const eventSummary = (e) => ({ slug: e.slug, title: e.title, url: `https://www.oncluemarket.xyz/#/event/${e.slug}`, markets: (e.markets || []).map(market) });

export const TOOLS = [
  { name: 'search_markets', title: 'Search markets', description: 'Find live prediction markets by topic. Leave the query empty for what is trending now. Returns events with their markets and the current chance of each outcome.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to search for, such as "Fed rate cut" or "Vikings".' }, sort: { type: 'string', enum: ['trending', 'volume', 'new', 'ending'] } } }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'get_market', title: 'Get a market', description: 'Full details of one event by its slug (from search_markets): every open market, the chance of each outcome, and the rules it resolves on.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'research', title: 'Research a question', description: 'Search the web for the latest evidence on a question and return a short answer with the evidence for and against, what to watch, how sure it is, and source links. Uses one of the person\'s free researches for today and can take up to two minutes. Pass market_id to research a specific market.',
    inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 5, maxLength: 2000 }, market_id: { type: 'string', description: 'Market id from search_markets or get_market.' } }, required: ['question'] }, annotations: { readOnlyHint: false, openWorldHint: true } },
  { name: 'research_allowance', title: 'Research left today', description: 'How many free researches the person has left today.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'save_forecast', title: 'Save a forecast', description: 'Save the person\'s own call to their Clue Journal: a chance from 0 to 100, why, and what would change it. Pass research_id from a research result to save that research with it, or question (and market_id) to start without research. Pass thread_id to add a new forecast to an entry already in the Journal.',
    inputSchema: { type: 'object', properties: { probability: { type: 'number', minimum: 0, maximum: 100 }, reasoning: { type: 'string', maxLength: 5000 }, change_condition: { type: 'string', maxLength: 5000, description: 'What would change this call.' }, research_id: { type: 'string' }, question: { type: 'string' }, market_id: { type: 'string' }, thread_id: { type: 'string' }, outcome_index: { type: 'integer', minimum: 0, description: 'Which outcome the chance is for. 0 is the first (usually Yes).' } }, required: ['probability', 'reasoning', 'change_condition'] }, annotations: { readOnlyHint: false } },
  { name: 'get_journal', title: 'Read the Journal', description: 'The person\'s forecasts, each next to the market price at the time and now, with how resolved calls scored.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'get_portfolio', title: 'Read the Portfolio', description: 'The person\'s trading account and open positions with their current value and profit or loss.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: true } },
];

// Calls one of Clue's own routes in-process, as the key's owner.
async function call(dispatch, userId, method, path, body) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [Buffer.from(raw)] : []);
  Object.assign(req, { method, url: path, headers: { host: 'internal', 'content-type': 'application/json' } });
  req[AGENT_USER] = userId;
  return new Promise((resolve, reject) => {
    let code = 200; const chunks = [];
    const res = { headersSent: false, statusCode: 200, setHeader() {}, writeHead(c) { code = c; this.statusCode = c; this.headersSent = true; return this; },
      end(data) { if (data) chunks.push(Buffer.from(data)); let parsed = null; try { parsed = JSON.parse(Buffer.concat(chunks).toString() || 'null'); } catch { parsed = null; } resolve({ status: code, body: parsed }); } };
    Promise.resolve(dispatch(req, res)).catch(reject);
  });
}
const fail = (r) => { throw Object.assign(new Error(r.body?.error || `Clue returned ${r.status}.`), { toolError: true }); };
const ok = async (p) => { const r = await p; if (r.status >= 400) fail(r); return r.body; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function positions(wallet) {
  const u = new URL('https://data-api.polymarket.com/positions'); u.searchParams.set('user', wallet); u.searchParams.set('sizeThreshold', '0.01'); u.searchParams.set('limit', '100');
  const r = await fetch(u, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  return (await r.json()).map((p) => ({ market: p.title, outcome: p.outcome, shares: p.size, avgPrice: p.avgPrice, currentPrice: p.curPrice, value: p.currentValue, pnl: p.cashPnl, redeemable: Boolean(p.redeemable), slug: p.eventSlug || null }));
}
const run = {
  async search_markets(a, d, u) { const q = new URLSearchParams(); if (a.query) q.set('q', String(a.query)); if (a.sort) q.set('sort', String(a.sort)); const b = await ok(call(d, u, 'GET', '/api/events?' + q)); return { events: b.events.slice(0, 12).map(eventSummary), retrievedAt: b.retrievedAt }; },
  async get_market(a, d, u) { const b = await ok(call(d, u, 'GET', '/api/events/' + encodeURIComponent(String(a.slug || '')))); const e = b.event || b; return { ...eventSummary(e), description: e.description || null, markets: (e.markets || []).map((m) => ({ ...market(m), rules: m.rules || null })) }; },
  async research_allowance(a, d, u) { return ok(call(d, u, 'GET', '/api/research/allowance')); },
  async research(a, d, u) {
    const body = { question: String(a.question || '') }; if (a.market_id) body.market = { id: String(a.market_id) };
    const { researchId } = await ok(call(d, u, 'POST', '/api/research', body));
    const until = Date.now() + RESEARCH_WAIT_MS;
    while (Date.now() < until) {
      await sleep(POLL_MS);
      const r = await ok(call(d, u, 'GET', '/api/research/' + researchId));
      if (r.status === 'failed') throw Object.assign(new Error(r.error || 'Research failed. Please try again.'), { toolError: true });
      if (r.status === 'done') return { research_id: researchId, answer: r.content, sources: r.sources, retrievedAt: r.retrievedAt, allowance: r.allowance };
    }
    return { research_id: researchId, status: 'running', note: 'Still working. Call research_status with this research_id in a minute.' };
  },
  async research_status(a, d, u) { const r = await ok(call(d, u, 'GET', '/api/research/' + encodeURIComponent(String(a.research_id || '')))); return r.status === 'done' ? { research_id: a.research_id, answer: r.content, sources: r.sources, retrievedAt: r.retrievedAt } : r; },
  async save_forecast(a, d, u) {
    let threadId = a.thread_id ? String(a.thread_id) : null;
    if (!threadId) {
      const body = a.research_id ? { researchId: String(a.research_id) } : { question: String(a.question || ''), content: 'Started from a forecast. No research has been run yet.', sources: [], model: 'none', ...(a.market_id ? { market: { id: String(a.market_id) } } : {}) };
      threadId = (await ok(call(d, u, 'POST', '/api/threads', body))).id;
    }
    const f = { probability: Number(a.probability), reasoning: String(a.reasoning || ''), changeCondition: String(a.change_condition || ''), ...(Number.isInteger(a.outcome_index) ? { outcomeIndex: a.outcome_index } : {}) };
    const r = await ok(call(d, u, 'POST', `/api/threads/${encodeURIComponent(threadId)}/forecasts`, f));
    return { saved: true, thread_id: threadId, createdAt: r.createdAt, journal: 'https://www.oncluemarket.xyz/#/saved' };
  },
  async get_journal(a, d, u) { return ok(call(d, u, 'GET', '/api/journal')); },
  async get_portfolio(a, d, u) {
    const { account } = await ok(call(d, u, 'GET', '/api/trading/account'));
    if (!account?.wallet) return { account: null, note: 'No trading account yet. Open Clue, sign in and set up trading from the Portfolio.' };
    const p = await positions(account.wallet);
    return { wallet: account.wallet, positions: p, portfolio: 'https://www.oncluemarket.xyz/#/portfolio', positionsValue: p ? Math.round(p.reduce((n, x) => n + (Number(x.value) || 0), 0) * 100) / 100 : null };
  },
};
TOOLS.splice(4, 0, { name: 'research_status', title: 'Check on research', description: 'The result of a research that was still running when research returned.', inputSchema: { type: 'object', properties: { research_id: { type: 'string' } }, required: ['research_id'] }, annotations: { readOnlyHint: true } });

const send = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(body === null ? '' : JSON.stringify(body)); };
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function readBody(req) { let v = ''; for await (const c of req) { v += c; if (v.length > 262144) throw Object.assign(new Error('Request too large.'), { status: 413 }); } return v; }

async function handle(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request.');
  const isNote = msg.id === undefined || msg.id === null;
  if (isNote) return null;
  const { id, method, params = {} } = msg;
  if (method === 'initialize') {
    const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
    return { jsonrpc: '2.0', id, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    const name = params.name; const fn = Object.hasOwn(run, name) ? run[name] : null;
    if (!fn) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      const out = await fn(params.arguments || {}, ctx.dispatch, ctx.userId);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false } };
    } catch (e) {
      if (!e.toolError) console.error('mcp tool failed', name, e);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.toolError ? e.message : 'Something went wrong. Please try again.' }], isError: true } };
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function mcpRoute(req, res, { dispatch }) {
  if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });
  const auth = String(req.headers.authorization || '');
  const who = auth.startsWith('Bearer ') ? await userForToken(store, auth.slice(7).trim()) : null;
  if (!who) return send(res, 401, rpcError(null, -32001, 'Add your Clue assistant key: open Clue, then your account menu, then Connect an assistant.'), { 'WWW-Authenticate': 'Bearer realm="clue"' });
  let parsed;
  try { parsed = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, rpcError(null, -32700, e.status ? e.message : 'Parse error.')); }
  const ctx = { dispatch, userId: who.userId };
  if (Array.isArray(parsed)) {
    const out = (await Promise.all(parsed.map((m) => handle(m, ctx)))).filter(Boolean);
    return out.length ? send(res, 200, out) : send(res, 202, null);
  }
  const out = await handle(parsed, ctx);
  return out ? send(res, 200, out) : send(res, 202, null);
}
