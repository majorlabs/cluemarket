// One missing trading permission. Polymarket's set-up (fetchTradingApprovalsState / setupTradingApprovals) does not include
// the neg-risk adapter, but Polymarket's order server needs it for multi-outcome markets (like "Fed decision: 25 bps, 50 bps,
// no change ..."). Without it an order fails with "allowance: 0, spender 0xd91E...". This checks the two permissions for that
// adapter on Polygon and, only if one is missing, asks the person's wallet to grant it (gasless, same as the original set-up).
// Built to public/trading-extra.js with `npm run build:trading-extra`, loaded next to trading.js.
import { createSecureClient, remoteBuilderSigning, forkEnvironmentConfig, production } from '@polymarket/client';
import { signerFrom } from '@polymarket/client/viem';
import { createWalletClient, custom } from 'viem';
import { polygon } from 'viem/chains';

const C = production.contracts;
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'];
const word = (a) => a.slice(2).toLowerCase().padStart(64, '0');
async function call(to, data) {
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      const j = await r.json(); if (typeof j.result === 'string') return j.result;
    } catch { /* next server */ }
  }
  throw new Error('Could not read your trading permissions right now. Try again in a minute.');
}
// What is missing for the neg-risk adapter: pUSD allowance (approve) and outcome-share approval (setApprovalForAll).
async function missing(wallet) {
  const allowance = BigInt(await call(C.collateralToken, '0xdd62ed3e' + word(wallet) + word(C.negRiskAdapter)));
  const forAll = BigInt(await call(C.conditionalTokens, '0xe985e9c5' + word(wallet) + word(C.negRiskAdapter)));
  return { erc20: allowance < 10n ** 30n, erc1155: forAll === 0n };
}

window.clueTradingExtra = {
  // wallet: the person's trading account address. Returns { ok, granted } or { ok: false, error }.
  async ensureNegRisk(wallet, onStep = () => {}) {
    try {
      const need = await missing(wallet);
      if (!need.erc20 && !need.erc1155) return { ok: true, granted: false };
      onStep('permission');
      const { provider, address } = await window.cluePrivy.provider();
      const walletClient = createWalletClient({ account: address, chain: polygon, transport: custom(provider) });
      const client = await createSecureClient({ signer: signerFrom(walletClient), apiKey: remoteBuilderSigning({ url: '/api/pm/sign', credentials: 'include' }), environment: forkEnvironmentConfig({ name: 'production', rpc: RPCS[0] }, production) });
      if (need.erc20) { const h = await client.approveErc20({ amount: 'max', spenderAddress: C.negRiskAdapter, tokenAddress: C.collateralToken }); if (h && typeof h.wait === 'function') await h.wait(); }
      if (need.erc1155) { const h = await client.approveErc1155ForAll({ operatorAddress: C.negRiskAdapter, tokenAddress: C.conditionalTokens, approved: true }); if (h && typeof h.wait === 'function') await h.wait(); }
      return { ok: true, granted: true };
    } catch (e) {
      const text = String((e && e.message) || e || '');
      if (/reject|denied|cancel/i.test(text)) return { ok: false, error: 'You cancelled the permission in your wallet. Nothing was bought.' };
      console.error('neg-risk permission failed', e);
      return { ok: false, error: 'Clue could not add the trading permission this market needs. Nothing was bought. Try again in a minute.', detail: `permission: ${(e && e.name) || 'Error'} - ${text.replace(/\s+/g, ' ').slice(0, 180)}` };
    }
  },
};
