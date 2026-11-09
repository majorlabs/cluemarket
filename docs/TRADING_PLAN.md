# Trading on Clue using Polymarket liquidity

Checked against Polymarket's docs on 2026-11-07, and built end to end since.

## How it works

- **Liquidity is Polymarket's.** Clue has no pool. Orders are signed by the user and matched on Polymarket's order book. Clue never holds funds or keys.
- **Account:** each user trades from their own **deposit wallet**, controlled by their own signer. Clue's server holds only the **builder** credentials, which it uses to sign setup paperwork and attach Clue's builder code. The browser never sees them.
- **Collateral:** pUSD on Polygon, backed by USDC. The balance is read straight from the chain.
- **Order flow:** connect the signer, set up the trading account (deployed with one signature), sign an order, send it, follow it until it fills. Orders are all-or-nothing market buys with a worst price worked out from the live book, so an order either fills completely or does not fill at all.
- **Fees:** each market publishes its platform fee (for example 4% politics, 5% sports, taker only): `fee = shares x rate x p x (1 - p)`. Clue adds no fee of its own. The builder fee rate is 0%.
- **Location:** Polymarket blocks or limits orders from many jurisdictions. Clue checks the visitor's own location from their browser and never helps get around it.

## What is built

| Part | What it does |
| - | - |
| Trade card | Previews an order against the live book (fills, average price, fee, win and lose amounts) and shows a review box before anything is sent |
| Trading account | Created from the user's own browser. The account and its balance are remembered, so it does not ask again |
| Orders | Signed by the user's wallet, sent with the builder code, followed through to filled, partly filled or failed, with live steps |
| Add money | From NEAR or another chain through NEAR Intents, or USDC straight from Polygon or Solana through Polymarket's deposit addresses |
| Portfolio | Positions with shares, entry and current price, value and profit or loss, plus history |
| Claim | Redeems winnings on an ended market the user called, one at a time or all at once |
| Open orders | Lists orders waiting on a market, with Cancel and Cancel all |
| Withdraw | Sends cash out as USDC to an address the user enters, on Base, Ethereum, Arbitrum, Optimism or Polygon, through Polymarket's bridge |
| Share card | A picture of a call (live, won or lost) with a code that opens the market, and a post to go with it |

## Switching real orders on

Real orders are controlled by two settings on the server. `CLUE_ORDERS_LIVE=1` turns them on for everyone. `CLUE_ORDERS_LIVE_ADDRESSES` is a comma-separated list of wallet addresses that can place real orders while everyone else sees the review step only.

## Rules that stay in force

Never store private keys. Require explicit approval for every order. Never bypass location or account limits. Report partial fills and errors accurately.
