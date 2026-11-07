// Read-only rNEAR (Rhea Finance liquid staking) data. No transactions are built or sent here.
import { RNearClient } from '@rhea-finance/rnear-sdk';

const client = new RNearClient(); // mainnet
let cache = null;

const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; };

export async function rnearSummary() {
  if (cache && Date.now() - cache.at < 60000) return cache.data;
  const [summary, apy] = await Promise.all([client.getSummary(), client.getApy()]);
  const data = {
    apyPercent: num(apy),
    nearPerRNear: num(summary.ftPrice.amount),
    totalStakedNear: num(summary.totalStakedNear.amount),
    validators: summary.validatorCount,
    unstakeWaitHours: summary.unstakeWaitingHours,
    contract: 'lst.rhealab.near',
    source: 'Rhea Finance rNEAR contract on NEAR mainnet, via @rhea-finance/rnear-sdk',
    retrievedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}

// Position for a NEAR account. Only NEAR-wallet sign-ins have a NEAR account to look up.
export async function rnearPosition(accountId) {
  if (typeof accountId !== 'string' || !/^([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/.test(accountId) || accountId.length > 64) {
    throw Object.assign(new Error('Invalid NEAR account.'), { status: 400 });
  }
  const [details, balance] = await Promise.all([client.getAccountDetails(accountId), client.getRNearBalance(accountId)]);
  return {
    accountId,
    rNearBalance: num(balance.amount),
    stakedValueNear: num(details.stakedNear.amount),
    pendingUnstakeNear: num(details.pendingNear.amount),
    canWithdraw: Boolean(details.canWithdraw),
    estimatedUnlockAtMs: details.estimatedUnlockAtMs ?? null,
    retrievedAt: new Date().toISOString(),
  };
}
