// Funding quotes: what it would cost to move money from another chain into pUSD on Polygon, the money Polymarket trades with.
// Quotes only. Nothing here builds, signs or sends a transaction, and the Rhea key never leaves the server.

export const DEST = { chain: '137', token: '0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb', symbol: 'pUSD', decimals: 6 };
// Routes checked against Rhea's live quote API. NEAR is not listed: Rhea's NEAR Intents route does not accept pUSD as a destination.
export const SOURCES = [
  { id: 'ethereum-usdc', label: 'USDC on Ethereum', chain: '1', token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6, gas: 'ETH' },
  { id: 'base-usdc', label: 'USDC on Base', chain: '8453', token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, gas: 'ETH' },
  { id: 'optimism-usdc', label: 'USDC on Optimism', chain: '10', token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', decimals: 6, gas: 'ETH' },
];
export const MIN_USD = 1, MAX_USD = 10000;

// Whole-number amount in the token's smallest unit, from text like "25" or "25.5". Rejects anything else.
export function toUnits(text, decimals) {
  if (typeof text !== 'string' || !/^\d{1,9}(\.\d{1,6})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0').slice(0, decimals) || '0');
  return units;
}
export const fromUnits = (units, decimals) => Number(units) / 10 ** decimals;

export function checkRequest({ source, amount, address }) {
  const src = SOURCES.find(s => s.id === source);
  if (!src) return { error: 'Choose one of the listed sources.' };
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return { error: 'Enter your Polygon address: 0x followed by 40 letters or numbers.' };
  const units = toUnits(amount, src.decimals);
  if (units === null) return { error: 'Enter an amount like 25 or 25.5.' };
  if (units < BigInt(MIN_USD) * 10n ** BigInt(src.decimals)) return { error: `The smallest amount is $${MIN_USD}.` };
  if (units > BigInt(MAX_USD) * 10n ** BigInt(src.decimals)) return { error: `Quotes are limited to $${MAX_USD}.` };
  return { src, units, address };
}

export async function fundingQuote(input, { fetchImpl = fetch, key = process.env.RHEA_API_KEY, base = process.env.RHEA_API_BASE || 'https://api.rhea.finance' } = {}) {
  const checked = checkRequest(input);
  if (checked.error) throw Object.assign(new Error(checked.error), { status: 400 });
  if (!key) throw Object.assign(new Error('Funding quotes are not set up on this server.'), { status: 503 });
  const { src, units, address } = checked;
  let body;
  try {
    const response = await fetchImpl(`${base}/api/v2/swap/quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ fromChain: src.chain, toChain: DEST.chain, tokenIn: src.token, tokenOut: DEST.token, amountIn: units.toString(), slippage: 50, sender: address, recipient: address }),
    });
    body = await response.json();
  } catch { throw Object.assign(new Error('Could not reach the routing service. Try again in a moment.'), { status: 502 }); }
  const best = body?.code === 0 ? body.data?.bestQuote : null;
  if (!best?.router || !/^\d+$/.test(String(best.amountOut)) || !/^\d+$/.test(String(best.minAmountOut))) {
    // The provider's own error text is long and technical; users get one plain sentence.
    throw Object.assign(new Error('No route is available for that amount right now. Try a different amount or source.'), { status: 502 });
  }
  const pay = Number(amountText(input.amount));
  const receive = fromUnits(best.amountOut, DEST.decimals), min = fromUnits(best.minAmountOut, DEST.decimals);
  const gas = (Array.isArray(best.fee) ? best.fee : []).find(f => f?.expenseType === 'FROM_SOURCE_WALLET' && f.token);
  const gasUsd = gas && Number.isFinite(Number(gas.token.usdPrice)) && /^\d+$/.test(String(gas.amount)) ? Number(gas.amount) / 10 ** (gas.token.decimals || 18) * Number(gas.token.usdPrice) : null;
  return {
    source: { id: src.id, label: src.label }, destination: DEST.symbol + ' on Polygon', address,
    pay, receive, minimumReceive: min,
    costUsd: Math.round((pay - receive) * 1e4) / 1e4,      // what the route takes, before gas; both sides are dollar-priced
    networkFeeUsd: gasUsd === null ? null : Math.round(gasUsd * 1e4) / 1e4,
    networkFeeToken: gas?.token?.symbol || src.gas,
    seconds: Number.isFinite(Number(best.timeEstimate)) ? Number(best.timeEstimate) : null,
    route: String(best.routerName || best.router).slice(0, 40),
    retrievedAt: new Date().toISOString(),
    note: 'A price only. Nothing has been sent. The final amount can differ by up to the minimum shown.',
  };
}
const amountText = a => (typeof a === 'string' ? a : '0');
