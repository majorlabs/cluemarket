// Trading setup, run in the user's own browser with the user's own wallet. Built to public/trading.js with `npm run build:trading`
// and loaded only when someone chooses to set up trading.
//
// Orders and Polymarket requests go from this browser straight to Polymarket, so Polymarket sees the user's real location.
// The only thing our server does is sign the builder paperwork for the relayer (/api/pm/sign); the builder secret never reaches here.
import { createSecureClient, remoteBuilderSigning } from '@polymarket/client';
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
  if (/builder|relayer/i.test(text)) return 'Polymarket could not set up your trading wallet right now. Try again in a minute.';
  return 'Trading setup did not finish. Nothing was changed. Try again in a minute.';
};

window.clueTrading = {
  // Steps reported to the page: 'wallet' (sign in and create the trading wallet), 'permissions', 'balance'.
  async setup(onStep = () => {}) {
    try {
      onStep('wallet');
      const client = await openClient();
      const account = client.account;
      onStep('permissions');
      const state = await client.fetchTradingApprovalsState();
      if (!state.isFullyApproved) {
        const handle = await client.setupTradingApprovals();
        if (handle && typeof handle.wait === 'function') await handle.wait();
      }
      onStep('balance');
      const balance = await fetchBalanceAllowance(client, { assetType: 'COLLATERAL' });
      return { ok: true, signer: account.signer, wallet: account.wallet, approved: true, balance: dollars(balance.balance) };
    } catch (e) {
      console.error('trading setup failed', e);
      return { ok: false, error: friendly(e) };
    }
  },
};
