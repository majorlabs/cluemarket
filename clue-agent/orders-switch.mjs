// Real orders are off unless switched on. CLUE_ORDERS_LIVE=1 turns them on for everyone. CLUE_ORDERS_LIVE_ADDRESSES is a
// comma-separated list of wallet addresses that may place real orders while everyone else stays in test mode.
export function ordersLiveFor({ flag, addresses, wallet }) {
  if (String(flag || '') === '1') return true;
  const mine = String(wallet || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(mine)) return false;
  return String(addresses || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean).includes(mine);
}
