// Finds a person's Polymarket trading account from the wallet that owns it, the way Polymarket's own software does, so
// the server knows it even if it was set up on another device. The address is fixed by the owner's address (CREATE2), and
// it counts only once it actually exists on Polygon. Only public addresses are involved.
import * as AbiParameters from 'ox/AbiParameters';
import * as Hash from 'ox/Hash';
import * as Hex from 'ox/Hex';
import * as Bytes from 'ox/Bytes';
import * as ContractAddress from 'ox/ContractAddress';
import { production } from '@polymarket/client';

const W = production.walletDerivation;
// The constants Polymarket's client uses for the deposit wallet's creation code (@polymarket/client, wallet derivation).
const CM = '0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3', DM = '0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076', UM = 0x61003d3d8160233d3973n;
const MM = '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3', LM = '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c', FM = '0x60195155f3363d3d373d3d363d602036600436635c60da', YM = 0x6100523d8160233d3973n;

const args = (owner) => AbiParameters.encode([{ type: 'address' }, { type: 'bytes32' }], [W.depositWalletFactory, `0x${owner.slice(2).toLowerCase().padStart(64, '0')}`]);
const len = (h) => BigInt((h.length - 2) / 2);
const viaImplementation = (s) => Hash.keccak256(Bytes.concat(Bytes.fromNumber(UM + (len(s) << 56n), { size: 10 }), Bytes.fromHex(W.depositWalletImplementation), Bytes.fromHex('0x6009'), Bytes.fromHex(DM), Bytes.fromHex(CM), Bytes.fromHex(s)), { as: 'Hex' });
const viaBeacon = (s) => Hash.keccak256(Bytes.concat(Bytes.fromNumber(YM + (len(s) << 56n), { size: 10 }), Bytes.fromHex(W.depositWalletBeacon), Bytes.fromHex(FM), Bytes.fromHex(LM), Bytes.fromHex(MM), Bytes.fromHex(s)), { as: 'Hex' });

/** Both addresses the trading account can have for this owner. */
export function candidates(owner) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(owner || ''))) return [];
  const s = args(owner), salt = Hash.keccak256(s);
  return [viaBeacon(s), viaImplementation(s)].map((bytecodeHash) => ContractAddress.fromCreate2({ bytecodeHash, from: W.depositWalletFactory, salt }));
}

const RPCS = () => (process.env.POLYGON_RPCS || 'https://polygon-bor-rpc.publicnode.com,https://polygon.drpc.org').split(',');
async function hasCode(address) {
  for (const rpc of RPCS()) {
    try {
      const r = await fetch(rpc, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }) });
      const j = await r.json();
      if (typeof j.result === 'string') return j.result.length > 2;
    } catch { /* try the next server */ }
  }
  return null;
}

/** The owner's trading account if it exists on Polygon, or null. */
export async function findTradingWallet(owner) {
  for (const a of candidates(owner)) if (await hasCode(a)) return a;
  return null;
}
export { Hex };
