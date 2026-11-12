// Clue's order sender. It runs on the person's own computer, as a small MCP server for their AI agent, so every order
// goes to Polymarket from where the person really is. It holds no keys: each signature is asked of Clue, which checks the
// person's own limits and has their OutLayer agent wallet sign. Built into ../plugin/clue/trader/clue-trader.mjs with
// `npm run build:trader`.
//
// Needs CLUE_KEY (an agent key from Clue's Agents page). CLUE_URL defaults to https://www.oncluemarket.xyz.
import { createInterface } from 'node:readline';
import { createSecureClient, remoteBuilderSigning, OrderSide, OrderType } from '@polymarket/client';
import { fetchBalanceAllowance } from '@polymarket/client/actions';

const BASE = (process.env.CLUE_URL || 'https://www.oncluemarket.xyz').replace(/\/$/, '');
{ const u = new URL(BASE); if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) { process.stderr.write('CLUE_URL must be an https address.\n'); process.exit(1); } }
const KEY = process.env.CLUE_KEY || '';
const auth = () => ({ Authorization: 'Bearer ' + KEY });
const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);
const num = (v) => Number(v || 0);

async function clue(method, path, body) {
  if (!KEY) throw Object.assign(new Error('Set CLUE_KEY to your Clue agent key (Clue, Agents, Advanced: connect with a key).'), { clue: true });
  const r = await fetch(BASE + path, { method, headers: { ...auth(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body, big) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Clue returned ${r.status}.`), { clue: true });
  return j;
}

let cached = null;
async function walletInfo() { const w = await clue('GET', '/api/agent/wallet'); if (!w.wallet) throw Object.assign(new Error('No agent wallet is connected. In Clue, open Agents and connect your OutLayer wallet.'), { clue: true }); return w; }

// A signer that never holds a key: Clue checks each request and OutLayer signs it.
const signer = {
  async getAddress() { return (await walletInfo()).wallet.address; },
  async signTypedData(payload) { return (await clue('POST', '/api/agent/sign', { typedData: payload })).signature; },
  async signMessage() { throw new Error('Clue does not sign plain messages for agent wallets.'); },
  async sendTransaction() { throw new Error('Agent wallets only use gasless actions.'); },
};

async function client() {
  if (cached) return cached;
  const info = await walletInfo();
  if (!info.wallet.enabled) throw Object.assign(new Error('Agent wallet is switched off. Switch it on in Clue: Agents, Agent wallet.'), { clue: true });
  const c = await createSecureClient({ signer, apiKey: remoteBuilderSigning({ url: BASE + '/api/pm/sign', headers: auth }) });
  cached = { c, info };
  return cached;
}

const REFUSALS = {
  fok_not_filled: 'The price moved before the order could fill. Nothing was bought or sold.',
  fak_not_filled: 'The price moved before the order could fill. Nothing was bought or sold.',
  unmatched: 'Nobody would trade at that price. Nothing was bought or sold.',
  insufficient_balance_or_allowance: 'The trading account does not have enough pUSD or permission. Run setup_trading, or add money.',
  market_not_ready: 'This market is not taking orders yet.',
};
const result = (res) => {
  if (!res.ok) return { ok: false, error: REFUSALS[res.code] || 'Polymarket did not accept the order. Nothing was traded.' };
  return { ok: true, status: res.status, orderId: res.orderId, paid: num(res.makingAmount), received: num(res.takingAmount) };
};

const TOOLS = [
  { name: 'trading_status', description: 'The connected agent wallet, the trading account that holds its pUSD, its cash, whether it is set up, and the person\'s limits per order and per day.', inputSchema: { type: 'object', properties: {} } },
  { name: 'setup_trading', description: 'One-time set-up of the trading account: creates it and gives Polymarket\'s exchanges permission to use its pUSD and shares. Gasless.', inputSchema: { type: 'object', properties: {} } },
  { name: 'buy', description: 'Buy an outcome with a dollar amount. All-or-nothing at no worse than max_price (0 to 1). Get token_id from Clue\'s search_markets or get_market. Clue refuses anything over the person\'s limits.', inputSchema: { type: 'object', properties: { token_id: { type: 'string' }, amount_usd: { type: 'number', exclusiveMinimum: 0 }, max_price: { type: 'number', exclusiveMinimum: 0, maximum: 1 } }, required: ['token_id', 'amount_usd', 'max_price'] } },
  { name: 'sell', description: 'Sell shares of an outcome the account holds. All-or-nothing at no less than min_price (0 to 1).', inputSchema: { type: 'object', properties: { token_id: { type: 'string' }, shares: { type: 'number', exclusiveMinimum: 0 }, min_price: { type: 'number', minimum: 0, maximum: 1 } }, required: ['token_id', 'shares', 'min_price'] } },
  { name: 'open_orders', description: 'Orders still waiting on the market.', inputSchema: { type: 'object', properties: {} } },
  { name: 'cancel_orders', description: 'Cancel orders by id, or all of them.', inputSchema: { type: 'object', properties: { order_ids: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } } } },
];

const run = {
  async trading_status() {
    const info = await walletInfo();
    const out = { signer: info.wallet.address, enabled: info.wallet.enabled, maxOrder: info.wallet.maxOrder, maxDay: info.wallet.maxDay, spentToday: info.wallet.spentToday };
    if (!info.wallet.enabled) return { ...out, note: 'Agent wallet is switched off. Switch it on in Clue: Agents, Agent wallet.' };
    const { c } = await client();
    const state = await c.fetchTradingApprovalsState();
    const bal = await fetchBalanceAllowance(c, { assetType: 'COLLATERAL' });
    return { ...out, tradingAccount: c.account.wallet, cash: Number(BigInt(bal.balance || '0')) / 1e6, setUp: Boolean(state.isFullyApproved), fund: 'Send pUSD to tradingAccount, or use Add money in Clue with this address.' };
  },
  async setup_trading() {
    const { c } = await client();
    const state = await c.fetchTradingApprovalsState();
    if (!state.isFullyApproved) { const h = await c.setupTradingApprovals(); if (h && typeof h.wait === 'function') await h.wait(); }
    return { ok: true, tradingAccount: c.account.wallet };
  },
  async buy(a) {
    const { c, info } = await client();
    const signed = await c.createMarketOrder({ assetId: String(a.token_id), side: OrderSide.BUY, amount: String(a.amount_usd), maxPrice: String(a.max_price), orderType: OrderType.FOK, ...(info.builderCode ? { builderCode: info.builderCode } : {}) });
    return result(await c.postOrder(signed));
  },
  async sell(a) {
    const { c, info } = await client();
    const signed = await c.createMarketOrder({ assetId: String(a.token_id), side: OrderSide.SELL, shares: String(a.shares), minPrice: String(a.min_price), orderType: OrderType.FOK, ...(info.builderCode ? { builderCode: info.builderCode } : {}) });
    return result(await c.postOrder(signed));
  },
  async open_orders() {
    const { c } = await client();
    const page = await c.listOpenOrders().firstPage();
    return { orders: (page.items || []).map((o) => ({ id: String(o.id), tokenId: o.assetId, side: String(o.side || ''), price: num(o.price), size: num(o.originalSize), matched: num(o.sizeMatched), outcome: o.outcome || '' })) };
  },
  async cancel_orders(a) {
    const { c } = await client();
    const res = a.all ? await c.cancelAll() : await c.cancelOrders({ orderIds: (a.order_ids || []).map(String) });
    return { canceled: (res && res.canceled) || [], notCanceled: (res && res.notCanceled) || {} };
  },
};

const reply = (msg) => process.stdout.write(JSON.stringify(msg, big) + '\n');
async function handle(m) {
  if (m.id === undefined || m.id === null) return;
  const { id, method, params = {} } = m;
  if (method === 'initialize') return reply({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'clue-trader', version: '1.0.0' }, instructions: 'Places Polymarket orders for the person from their own computer, signed by their OutLayer agent wallet through Clue, within the limits they set in Clue. Confirm each trade with the person before calling buy or sell.' } });
  if (method === 'ping') return reply({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return reply({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const fn = Object.hasOwn(run, params.name) ? run[params.name] : null;
    if (!fn) return reply({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
    try { const out = await fn(params.arguments || {}); return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, big, 1) }], isError: out && out.ok === false } }); }
    catch (e) { cached = e.clue ? cached : null; return reply({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.clue ? e.message : `Could not finish: ${String(e.message || e).slice(0, 300)}. If an order may have gone through, check open_orders and your Portfolio before trying again.` }], isError: true } }); }
  }
  return reply({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}
createInterface({ input: process.stdin }).on('line', (line) => { if (!line.trim()) return; let m; try { m = JSON.parse(line); } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); } handle(m); });
