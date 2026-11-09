// Funding from NEAR or any other chain, carried by NEAR Intents (the 1Click service).
//
// The person sends a coin they hold (NEAR, USDC, ETH, SOL ...) to a one-time deposit address. NEAR Intents swaps it and delivers USDC on
// Polygon to the person's own Polymarket deposit address, which Polymarket's own deposit service then turns into trading money.
// Clue never holds the money and never sees a key. This file only asks for prices, asks for the address, and reads the status.
//
// Safety rules kept here:
//  - the destination is never taken from the browser: it is the address Polymarket's deposit service returns for the person's trading account;
//  - a refund address is required, checked for its chain, and for NEAR it must be an account that exists (an unknown account makes the swap fail);
//  - amounts are plain decimals, between a floor and a ceiling in dollars;
//  - only a short list of well-known coins is offered.

const ONECLICK = () => process.env.ONECLICK_BASE || 'https://1click.chaindefuser.com/v0';
const BRIDGE = () => process.env.POLYMARKET_BRIDGE_BASE || 'https://bridge.polymarket.com';
const NEAR_RPC = () => process.env.NEAR_RPC_URL || 'https://rpc.mainnet.near.org';

// Limits follow Polymarket's own deposit service. It ignores deposits under its per-coin floor (read live below), and it sets no cap of its
// own: its guide only advises another bridge above $50,000 from a chain other than Polygon. Clue keeps a little above the floor so that the
// swap fee and price movement cannot push a deposit under it.
export const MIN_FLOOR_USD = 2.5;
export const MAX_USD = 50000;
export const maxUsd = () => Number(process.env.CLUE_FUND_MAX_USD) || MAX_USD;

let floorCache = { at: 0, usd: null };
async function polymarketFloor(fetchImpl) {
  if (floorCache.usd !== null && Date.now() - floorCache.at < 10 * 60_000) return floorCache.usd;
  let usd = 2;                                                                // what Polymarket lists today, if it cannot be read
  try {
    const r = await fetchImpl(`${BRIDGE()}/supported-assets`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    const d = await json(r);
    const mins = (d.supportedAssets || []).filter((a) => a.chainName === 'Polygon' && a.token && a.token.symbol === 'USDC').map((a) => Number(a.minCheckoutUsd)).filter((n) => n > 0);
    if (mins.length) usd = Math.max(...mins);
  } catch { /* keep the listed value */ }
  floorCache = { at: Date.now(), usd };
  return usd;
}
export const forgetFloor = () => { floorCache = { at: 0, usd: null }; };
/** The smallest and largest amount, in dollars. */
export async function limits({ fetchImpl = fetch } = {}) { return { minUsd: Math.max(MIN_FLOOR_USD, await polymarketFloor(fetchImpl)), maxUsd: maxUsd() }; }

// The coins offered, by chain and symbol. Each shows as "SYMBOL on Chain".
const CHAINS = { near: 'NEAR', base: 'Base', eth: 'Ethereum', arb: 'Arbitrum', sol: 'Solana', op: 'Optimism', bsc: 'BNB Chain' };
const OFFERED = {
  near: ['wNEAR', 'USDC', 'USDT'], base: ['USDC', 'ETH'], eth: ['USDC', 'USDT', 'ETH'], arb: ['USDC', 'ETH'], sol: ['USDC', 'SOL'], op: ['USDC'], bsc: ['USDT', 'BNB'],
};
const EVM = new Set(['base', 'eth', 'arb', 'op', 'bsc', 'pol']);
export const chainKind = (chain) => (chain === 'near' ? 'near' : chain === 'sol' ? 'sol' : EVM.has(chain) ? 'evm' : null);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

let cache = { at: 0, tokens: null };
async function tokens(fetchImpl) {
  if (cache.tokens && Date.now() - cache.at < 10 * 60_000) return cache.tokens;
  const r = await fetchImpl(`${ONECLICK()}/tokens`, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
  if (!r.ok) throw fail('Funding from other chains is unavailable right now. Try again in a minute.', 502);
  const all = await json(r);
  if (!Array.isArray(all)) throw fail('Funding from other chains is unavailable right now. Try again in a minute.', 502);
  cache = { at: Date.now(), tokens: all };
  return all;
}
export const forgetTokens = () => { cache = { at: 0, tokens: null }; };

/** The coins people can send, and the one they will receive (USDC on Polygon). */
export async function offered({ fetchImpl = fetch } = {}) {
  const all = await tokens(fetchImpl);
  const assets = [];
  for (const [chain, symbols] of Object.entries(OFFERED)) {
    for (const symbol of symbols) {
      const t = all.find((x) => x.blockchain === chain && x.symbol === symbol);
      if (t && Number(t.price) > 0) assets.push({ assetId: t.assetId, chain, chainName: CHAINS[chain], symbol: symbol === 'wNEAR' ? 'wNEAR' : symbol, decimals: t.decimals, price: Number(t.price), refundKind: chainKind(chain) });
    }
  }
  const dest = all.find((x) => x.blockchain === 'pol' && x.symbol === 'USDC');
  return { assets, dest: dest ? { assetId: dest.assetId, decimals: dest.decimals } : null };
}

/** Whole units from text such as "2" or "2.5". Plain decimals only. */
export function toUnits(text, decimals) {
  if (typeof text !== 'string' || !/^\d{1,12}(\.\d{1,18})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (frac.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Is this a usable refund address for this kind of chain? NEAR accounts must exist. */
export async function checkRefund(kind, value, { fetchImpl = fetch } = {}) {
  const v = String(value || '').trim();
  if (kind === 'evm') { if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw fail('Enter the address to return your money to: 0x followed by 40 letters or numbers.'); return v; }
  if (kind === 'sol') { if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) throw fail('Enter a Solana address to return your money to.'); return v; }
  if (kind === 'near') {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(v)) throw fail('Enter your NEAR account, like yourname.near.');
    let res;
    try {
      res = await fetchImpl(NEAR_RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ jsonrpc: '2.0', id: 'clue', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: v } }) });
    } catch { throw fail('Could not check that NEAR account right now. Try again in a minute.', 502); }
    const d = await json(res);
    if (d && d.result) return v;
    throw fail('That NEAR account was not found. Check the name, or use an account that already holds NEAR.');
  }
  throw fail('Choose one of the listed coins.');
}

/** The deposit address Polymarket's own service gives this trading account on Polygon. Never from the browser. */
export async function polymarketDeposit(wallet, { fetchImpl = fetch, builderCode = process.env.POLYMARKET_BUILDER_CODE } = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(wallet || ''))) throw fail('Set up trading first, so there is an account to send money to.');
  let r;
  try {
    r = await fetchImpl(`${BRIDGE()}/deposit`, { method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'content-type': 'application/json', ...(builderCode ? { 'X-Builder-Code': builderCode } : {}) }, body: JSON.stringify({ address: wallet }) });
  } catch { throw fail('Polymarket could not give a deposit address right now. Try again in a minute.', 502); }
  const d = await json(r);
  const evm = d && d.address && d.address.evm;
  if (!r.ok || !/^0x[0-9a-fA-F]{40}$/.test(String(evm || ''))) throw fail('Polymarket could not give a deposit address right now. Try again in a minute.', 502);
  return evm;
}

/**
 * Ask NEAR Intents for a price (dry: true) or for the real deposit address (dry: false).
 * Returns only what the page needs.
 */
export async function quote({ assetId, amount, refundTo, wallet, dry = true }, deps = {}) {
  const { fetchImpl = fetch, jwt = process.env.ONECLICK_JWT } = deps;
  const { assets, dest } = await offered({ fetchImpl });
  const asset = assets.find((a) => a.assetId === assetId);
  if (!asset || !dest) throw fail('Choose one of the listed coins.');
  const units = toUnits(String(amount), asset.decimals);
  if (units === null || units === 0n) throw fail('Enter an amount like 2 or 2.5.');
  const usd = (Number(units) / 10 ** asset.decimals) * asset.price;
  const lim = await limits({ fetchImpl });
  if (usd < lim.minUsd) throw fail(`The smallest amount is about $${lim.minUsd.toFixed(2)}. Smaller deposits are not processed.`);
  if (usd > lim.maxUsd) throw fail(`The most you can add at once is about $${lim.maxUsd.toLocaleString('en-US')}. For more, split it into smaller amounts.`);
  const refund = await checkRefund(asset.refundKind, refundTo, { fetchImpl });
  const recipient = await polymarketDeposit(wallet, { fetchImpl });
  const body = {
    dry: Boolean(dry), swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: asset.assetId, depositType: 'ORIGIN_CHAIN',
    destinationAsset: dest.assetId, amount: units.toString(), refundTo: refund, refundType: 'ORIGIN_CHAIN', recipient, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(), quoteWaitingTimeMs: 3000, referral: 'clue',
  };
  let r;
  try {
    r = await fetchImpl(`${ONECLICK()}/quote`, { method: 'POST', signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) });
  } catch { throw fail('Could not get a price right now. Try again in a minute.', 502); }
  const d = await json(r);
  const q = d && d.quote;
  if (!r.ok || !q) throw fail('This route is not available right now. Try another coin or a different amount.', 502);
  const out = {
    dry: Boolean(dry),
    send: { symbol: asset.symbol, chain: asset.chainName, amount: String(amount), usd: Math.round(usd * 100) / 100 },
    receive: { symbol: 'USDC', chain: 'Polygon', amount: q.amountOutFormatted, usd: Number(q.amountOutUsd) || null, minimum: q.minAmountOutFormatted || null },
    seconds: Number.isFinite(Number(q.timeEstimate)) ? Number(q.timeEstimate) : null,
    refundTo: refund,
  };
  if (!dry) {
    if (!q.depositAddress) throw fail('NEAR Intents did not give a deposit address. Nothing was changed. Try again.', 502);
    out.depositAddress = q.depositAddress;
    out.depositMemo = q.depositMemo || null;
    out.deadline = q.deadline || body.deadline;
  }
  return out;
}

const STATUS = {
  PENDING_DEPOSIT: 'waiting', KNOWN_DEPOSIT_TX: 'seen', PROCESSING: 'swapping', SUCCESS: 'done', REFUNDED: 'refunded', FAILED: 'failed', INCOMPLETE_DEPOSIT: 'short',
};
/** Where a deposit is, in one plain word, with the amount delivered once it is done. */
export async function status(depositAddress, { fetchImpl = fetch, jwt = process.env.ONECLICK_JWT } = {}) {
  if (!/^[A-Za-z0-9_.:-]{10,120}$/.test(String(depositAddress || ''))) throw fail('That deposit address does not look right.');
  let r;
  try {
    r = await fetchImpl(`${ONECLICK()}/status?depositAddress=${encodeURIComponent(depositAddress)}`, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) } });
  } catch { throw fail('Could not check the status right now.', 502); }
  if (r.status === 404) return { state: 'waiting', delivered: null };
  const d = await json(r);
  if (!r.ok) throw fail('Could not check the status right now.', 502);
  const state = STATUS[d.status] || 'swapping';
  const sd = d.swapDetails || {};
  return { state, delivered: state === 'done' ? { amount: sd.amountOutFormatted || null, usd: Number(sd.amountOutUsd) || null } : null };
}
