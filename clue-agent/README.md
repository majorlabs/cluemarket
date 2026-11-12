# Clue app

The Clue Markets app: a plain-JavaScript front end (`public/`) served by one Node server (`server.mjs`). The product overview, status and screenshots are in the [root README](../README.md).

## Run

```sh
npm install
npm run preview        # http://127.0.0.1:3000 (loopback only)
npm test
npm run lint           # ESLint with the security rules
npm run audit:prod     # known problems in the packages the server runs on
```

Run the tests from this folder: one of them starts `server.mjs` by relative path. The live red-team test (`tests/redteam.live.test.mjs`) runs only when `NEARAI_API_KEY` is set and spends a little NEAR AI credit.

## Layout

| Path | What it is |
| --- | --- |
| `server.mjs` | HTTP server: market and order proxy, research, saved threads, Journal, sharing, sign-in routes |
| `auth.mjs`, `wallet-auth.mjs`, `privy-auth.mjs` | Accounts, NEAR wallet sign-in (signed message), email and wallet sign-in (token check), the wallet made for email users |
| `journal.mjs`, `memory.mjs` | The Journal: reading the market a forecast is about, comparing, and scoring when it resolves |
| `aispend.mjs`, `budget.mjs` | Free research limits and the daily spending cap; overall hourly budgets |
| `fund.mjs` | Prices for adding money from another chain (Rhea), prices only |
| `pm-sign.mjs` | Signs trading setup paperwork on the server, for the user's own wallet and a short fixed list of requests |
| `answer-links.mjs`, `origins.mjs` | Removing links the web search did not return; the approved-origin check |
| `public/` | The site: `app.js`, `ticket.js` (trade and portfolio maths), `style.css`, assets, fonts |
| `mcp.mjs` | The MCP server at `/api/mcp`: each tool calls Clue's own routes as the signed-in person |
| `oauth.mjs`, `agent-keys.mjs`, `agent-user.mjs` | Connecting an AI agent by signing in (OAuth 2.1, PKCE, dynamic client registration), the keys it ends up holding, and the in-process marker for agent calls |
| `agent-trades.mjs`, `agent-budget.mjs` | Trades an agent prepares and the person approves on their own device; the budget the person confirms |
| `agent-wallet.mjs` | OutLayer agent wallets: the sealed key, limits, price checks and the exact shapes Clue will sign |
| `trading-wallet.mjs` | Finds a person's Polymarket trading account from the wallet that owns it |
| `card-client.js`, `card-server.mjs` | The share card, drawn in the browser and, for agents, on the server |
| `trader-src.mjs` | Source of the Clue plugin's local order sender (`../plugin/clue/trader/clue-trader.mjs`) |
| `privy-client.jsx`, `trading-client.js`, `trading-extra-client.js` | Sources of `public/privy.js`, `public/trading.js` and `public/trading-extra.js`. Rebuild with `npm run build:privy`, `build:trading`, `build:trading-extra`, `build:card` and `build:trader` |
| `tests/` | Node tests (`node:test`) |

## Deploy

The static site (`public/`) is served from Vercel with `/api` rewritten to the Railway service; `vercel.json` holds the rewrite and security headers. The Railway service runs `node server.mjs` with the settings listed in the root README. Secrets go in the host's variables, never in the repository.
