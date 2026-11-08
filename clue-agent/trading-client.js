// Trading setup, run in the user's own browser with the user's own wallet. Built to public/trading.js with `npm run build:trading`
// and loaded only when someone chooses to set up trading.
//
// Orders and Polymarket requests go from this browser straight to Polymarket, so Polymarket sees the user's real location.
// The only thing our server does is sign the builder paperwork for the relayer (/api/pm/sign); the builder secret never reaches here.
import { createSecureClient, remoteBuilderSigning, OrderSide, OrderType } from '@polymarket/client';
import { fetchBalanceAllowance } from '@polymarket/client/actions';
import { signerFrom } from '@polymarket/client/viem';
import { createWalletClient, custom } from 'viem';
import { polygon } from 'viem/chains';

const builderSigning = remoteBuilderSigning({ url: '/api/pm/sign', credentials: 'include' });
const dollars = (units) => Number(BigInt(units || '0')) / 1e6;     // pUSD has 6 decimals

async function openClient() {
  const { provider, address } = await window.cluePrivy.provider();
  const walletClient = createWalletClient({ account: address, chain: polygon, transport: custom(provider) });
  // Creating the client signs in to Polymarket and, the first time, creates the user's trading wallet (gasless).
  return createSecureClient({ signer: signerFrom(walletClient), apiKey: builderSigning });
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
    try {
      report('wallet');
      const client = await openClient();
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
window.clueTrading.order = async function order({ assetId, spend, maxPrice, builderCode, send }) {
  try {
    const client = await openClient();
    const request = { assetId, side: OrderSide.BUY, amount: String(spend), maxPrice: String(maxPrice), orderType: OrderType.FOK, ...(builderCode ? { builderCode } : {}) };
    if (!send) {
      const signed = await client.createMarketOrder(request);
      return { ok: true, sent: false, summary: { spend: num(spend), maxPrice: num(maxPrice), builderCode: Boolean(builderCode), signed: Boolean(signed && signed.signature) } };
    }
    const res = await client.placeMarketOrder(request);
    if (!res.ok) return { ok: false, sent: true, error: REFUSALS[res.code] || 'Polymarket did not accept the order. No money was spent.' };
    const shares = num(res.takingAmount), paid = num(res.makingAmount);
    if (res.status === 'matched' && shares > 0) return { ok: true, sent: true, filled: true, shares, paid, avgPrice: paid / shares, orderId: res.orderId };
    return { ok: true, sent: true, filled: false, orderId: res.orderId, note: 'The order was accepted but has not filled yet. Check your positions before trying again.' };
  } catch (e) {
    console.error('order failed', e);
    const text = String((e && e.message) || e || '');
    if (/reject|denied|cancel/i.test(text)) return { ok: false, sent: false, error: 'You cancelled the request in your wallet. Nothing was sent.' };
    return { ok: false, sent: false, error: 'The order could not be placed. If you are not sure whether it went through, check your positions before trying again.' };
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
    return { ok: true, balance: dollars(b.balance) };
  } catch (e) {
    return { ok: false, error: 'Could not read your balance right now. Try again in a minute.' };
  }
};
