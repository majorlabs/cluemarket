// Trading setup, run in the user's own browser with the user's own wallet. Built to public/trading.js with `npm run build:trading`
// and loaded only when someone chooses to set up trading.
//
// Orders and Polymarket requests go from this browser straight to Polymarket, so Polymarket sees the user's real location.
// The only thing our server does is sign the builder paperwork for the relayer (/api/pm/sign); the builder secret never reaches here.
import { createSecureClient, remoteBuilderSigning, forkEnvironmentConfig, production, OrderSide, OrderType } from '@polymarket/client';
import { fetchBalanceAllowance } from '@polymarket/client/actions';
import { signerFrom } from '@polymarket/client/viem';
import { createWalletClient, custom } from 'viem';
import { polygon } from 'viem/chains';

const builderSigning = remoteBuilderSigning({ url: '/api/pm/sign', credentials: 'include' });
const dollars = (units) => Number(BigInt(units || '0')) / 1e6;     // pUSD has 6 decimals

// Polymarket's software reads the chain through one free public server. Its built-in choice refused the permission check
// (status 400) on a real phone, so we name a server that accepts it, and keep the old one as a backup.
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'];
const chainServerFailed = (e) => /JSON-RPC|status (4|5)\d\d/i.test(String((e && e.message) || e || ''));

async function openClient(rpc = RPCS[0]) {
  const { provider, address } = await window.cluePrivy.provider();
  const walletClient = createWalletClient({ account: address, chain: polygon, transport: custom(provider) });
  const environment = forkEnvironmentConfig({ name: 'production', rpc }, production);
  // Creating the client signs in to Polymarket and, the first time, creates the user's trading wallet (gasless).
  return createSecureClient({ signer: signerFrom(walletClient), apiKey: builderSigning, environment });
}

const friendly = (e) => {
  const text = String((e && e.message) || e || '');
  if (/reject|denied|cancel/i.test(text)) return 'You cancelled the request in your wallet. Nothing was changed.';
  if (/Remote signer rejected/i.test(text)) return 'Clue could not set up trading for this account right now. Try again in a minute.';
  if (/builder|relayer/i.test(text)) return 'Trading could not be set up right now. Try again in a minute.';
  return 'Trading setup did not finish. Nothing was changed. Try again in a minute.';
};

// A short, safe description of what failed and at which step, shown under the plain message so a screenshot says what went wrong.
const describe = (step, e) => {
  const name = (e && e.name) || 'Error';
  const text = String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 180);
  return `${step}: ${name}${text ? ` - ${text}` : ''}`;
};

window.clueTrading = {
  // Steps reported to the page: 'wallet' (sign in and create the trading wallet), 'permissions', 'balance'.
  async setup(onStep = () => {}) {
    let step = 'start';
    const report = (s) => { step = s; onStep(s); };
    const run = async (rpc) => {
      report('wallet');
      const client = await openClient(rpc);
      const account = client.account;
      report('permissions');
      const state = await client.fetchTradingApprovalsState();
      if (!state.isFullyApproved) {
        const handle = await client.setupTradingApprovals();
        if (handle && typeof handle.wait === 'function') await handle.wait();
      }
      report('balance');
      const balance = await fetchBalanceAllowance(client, { assetType: 'COLLATERAL' });
      return { ok: true, signer: account.signer, wallet: account.wallet, approved: true, balance: dollars(balance.balance) };
    };
    try {
      try { return await run(RPCS[0]); }
      catch (e) { if (!chainServerFailed(e)) throw e; console.warn('chain server failed, trying the backup', e); return await run(RPCS[1]); }
    } catch (e) {
      console.error('trading setup failed at', step, e);
      return { ok: false, error: friendly(e), detail: describe(step, e) };
    }
  },
};

// What Polymarket's refusal codes mean, in plain words. Every refusal also says whether money moved.
const REFUSALS = {
  fok_not_filled: 'The price moved before the order could fill, so nothing was bought and no money was spent.',
  fak_not_filled: 'The price moved before the order could fill, so nothing was bought and no money was spent.',
  unmatched: 'Nobody was selling at your price, so nothing was bought and no money was spent.',
  insufficient_balance_or_allowance: 'Your account does not have enough money or permission for this order. No money was spent.',
  market_not_ready: 'This market is not ready for orders yet. No money was spent.',
};
const num = (v) => Number(v || 0);

// Buy with a dollar amount. All-or-nothing: the order fills completely at no worse than maxPrice, or it does not happen.
// With send:false (test mode) the order is built and signed by the user's wallet, then thrown away. Nothing is sent to anyone.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Some markets hold an order for a few seconds before matching it. Follow it for up to about 40 seconds so the person sees how it ends.
async function follow(client, orderId) {
  for (let i = 0; i < 14; i++) {
    await sleep(3000);
    let o; try { o = await client.fetchOrder({ orderId }); } catch { continue; }
    const matched = num(o.sizeMatched), size = num(o.originalSize), status = String(o.status || '').toLowerCase();
    if (matched > 0 && (matched >= size * 0.999 || status === 'matched')) return { ok: true, sent: true, filled: true, shares: matched, paid: matched * num(o.price), avgPrice: num(o.price), orderId };
    if (['canceled', 'cancelled', 'unmatched', 'expired', 'invalid'].includes(status)) return { ok: false, sent: true, error: 'The order was not filled, so nothing was bought and no money was spent.' };
  }
  return null;
}

// Buy with a dollar amount. All-or-nothing: the order fills completely at no worse than maxPrice, or it does not happen.
// With send:false (test mode) the order is built and signed by the user's wallet, then thrown away. Nothing is sent to anyone.
// onStep is told each step as it starts: 'account', 'sign', 'send', 'match'.
window.clueTrading.order = async function order({ assetId, spend, maxPrice, builderCode, send, onStep = () => {} }) {
  try {
    onStep('account');
    const client = await openClient();
    const request = { assetId, side: OrderSide.BUY, amount: String(spend), maxPrice: String(maxPrice), orderType: OrderType.FOK, ...(builderCode ? { builderCode } : {}) };
    onStep('sign');
    const signed = await client.createMarketOrder(request);
    if (!send) return { ok: true, sent: false, summary: { spend: num(spend), maxPrice: num(maxPrice), builderCode: Boolean(builderCode), signed: Boolean(signed && signed.signature) } };
    onStep('send');
    const res = await client.postOrder(signed);
    if (!res.ok) return { ok: false, sent: true, error: REFUSALS[res.code] || 'Polymarket did not accept the order. No money was spent.' };
    const shares = num(res.takingAmount), paid = num(res.makingAmount);
    if (res.status === 'matched' && shares > 0) return { ok: true, sent: true, filled: true, shares, paid, avgPrice: paid / shares, orderId: res.orderId };
    onStep('match');
    const followed = await follow(client, res.orderId);
    return followed || { ok: true, sent: true, filled: false, orderId: res.orderId, note: 'The order was accepted and is still being matched. Your balance will update when it is done.' };
  } catch (e) {
    console.error('order failed', e);
    const text = String((e && e.message) || e || '');
    if (/reject|denied|cancel/i.test(text) && !(e && e.name === 'UserInputError')) return { ok: false, sent: false, error: 'You cancelled the request in your wallet. Nothing was sent.' };
    if (e && e.name === 'UserInputError') return { ok: false, sent: false, error: 'This market would not take that size or price. Nothing was sent. Try a slightly different amount.' };
    return { ok: false, sent: false, error: 'The order could not be placed. If you are not sure whether it went through, check your positions before trying again.', detail: describe(send ? 'order' : 'check', e) };
  }
};

// Collect the winnings of one ended market into the trading account's cash. Gasless: Polymarket's relayer pays the network fee.
// onStep: 'account', 'sign' (the wallet signs and the request is sent), 'confirm' (waiting for the network to settle it).
window.clueTrading.claim = async function claim({ conditionId, onStep = () => {} }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(conditionId || ''))) return { ok: false, error: 'That call cannot be claimed.' };
  try {
    onStep('account');
    const client = await openClient();
    onStep('sign');
    const handle = await client.redeemPositions({ conditionId });
    onStep('confirm');
    const outcome = await handle.wait();
    return { ok: true, hash: (outcome && outcome.transactionHash) || handle.transactionHash || null };
  } catch (e) {
    console.error('claim failed', e);
    const text = String((e && e.message) || e || '');
    if (/reject|denied|cancel/i.test(text) && !(e && e.name === 'UserInputError')) return { ok: false, error: 'You cancelled the request in your wallet. Nothing was claimed.' };
    return { ok: false, error: 'The claim did not finish. Nothing was taken from you. Try again in a minute, and check your cash before trying twice.', detail: describe('claim', e) };
  }
};

// Polymarket's own deposit service gives each trading account its own address per chain. Anything sent there in a supported token
// is turned into trading money automatically. Called straight from the browser; nothing about the user passes through Clue's server.
window.clueTrading.depositAddresses = async function depositAddresses(wallet, builderCode) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(wallet || ''))) return { ok: false, error: 'Set up trading first, so there is an account to send money to.' };
  try {
    const r = await fetch('https://bridge.polymarket.com/deposit', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(builderCode ? { 'X-Builder-Code': builderCode } : {}) }, body: JSON.stringify({ address: wallet }),
    });
    if (!r.ok) return { ok: false, error: 'Polymarket could not give a deposit address right now. Try again in a minute.' };
    const d = await r.json();
    return { ok: true, evm: d && d.address && d.address.evm, svm: d && d.address && d.address.svm };
  } catch (e) {
    return { ok: false, error: 'Could not reach the deposit service. Try again in a minute.' };
  }
};

// The deposit rules change over time, so the minimums shown to people are read live.
window.clueTrading.depositMinimums = async function depositMinimums() {
  try {
    const d = await (await fetch('https://bridge.polymarket.com/supported-assets')).json();
    const pick = (chain) => (d.supportedAssets || []).find((a) => a.chainName === chain && a.token && a.token.symbol === 'USDC');
    return { solana: pick('Solana') && pick('Solana').minCheckoutUsd, polygon: pick('Polygon') && pick('Polygon').minCheckoutUsd };
  } catch { return {}; }
};

window.clueTrading.balance = async function balance() {
  try {
    const client = await openClient();
    const b = await fetchBalanceAllowance(client, { assetType: 'COLLATERAL' });
    return { ok: true, balance: dollars(b.balance), signer: client.account && client.account.signer, wallet: client.account && client.account.wallet };
  } catch (e) {
    return { ok: false, error: 'Could not read your balance right now. Try again in a minute.' };
  }
};
