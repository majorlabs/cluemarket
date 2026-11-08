# Trading on Clue using Polymarket liquidity

Status: plan, with phase 0 built. Checked against Polymarket's docs on 2026-11-07. Nothing below Phase 0 is built or verified.

## How it works (from Polymarket's docs)

- **Liquidity is Polymarket's.** Clue has no pool. Orders are signed by the user and matched on Polymarket's order book (CLOB). Clue never holds funds or keys.
- **Account:** each user trades from their own **Deposit Wallet**, controlled by their own signer. Clue's server holds only **builder** credentials, used to deploy wallets and to attach Clue's builder code.
- **Collateral:** pUSD (Polygon), backed by USDC.
- **Order flow:** connect signer, fund the wallet, grant approvals, sign an order, submit to the CLOB, track fills, settle on Polygon.
- **Fees:** each market publishes its platform fee (for example 4% politics, 5% sports, taker-only): `fee = shares x rate x p x (1 - p)`. A builder fee is additive: at most 1% on taker and 0.5% on maker orders. Polymarket can revoke builder fees.
- **Location:** Polymarket blocks or limits orders from many jurisdictions (including the US, UK, Germany, France and Singapore). `GET https://polymarket.com/api/geoblock` works from a visitor's browser.
- **Session keys** (beta) allow scoped, time-limited trading without the owner key. Clue will not use them at first: each order needs the user's own approval.

## Phases and gates

| Phase | What | Status |
| - | - | - |
| 0 | Location check, trade ticket that previews an order against the live book (fills, average price, fee estimate, win/lose amounts, warnings). Submit is disabled. | Built, tested against the raw book |
| 1 | Connect an Ethereum wallet (Privy external wallet), derive or deploy the user's Deposit Wallet, show pUSD balance. | Not started |
| 2 | Place and cancel a real order, signed by the user's wallet, with the builder code. Show open, partial, filled, canceled, rejected and failed states honestly. | Not started. Needs a funded test wallet. |
| 3 | Positions, sell, redeem after resolution, realised and unrealised P&L from real fills. | Not started |
| 4 | Funding from other chains (NEAR Intents). Quote, deposit, status and refund tested on their own first. | Not started |

A phase is not called working until it has run end to end with real data. Phase 2 can only be proven with a small amount of real money, tested by the owner.

## Needed from the owner

1. **Builder account:** on polymarket.com, Settings, Builders. The builder code and the Builder API key, secret and passphrase. These go into Railway variables, never into the repo or the browser.
2. **Fee decision:** the builder fee rate (default 0%).
3. **A small funded test wallet** and permission to test with it.
4. **Legal advice** on offering trading from the countries where Clue will be used.

## Rules that stay in force (see AGENTS.md)

Never store private keys. Require explicit approval for every order. Never bypass location or account limits. Report partial fills and errors accurately. Do not claim a feature works until it has been run.
