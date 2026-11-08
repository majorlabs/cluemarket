# clue-agent

The Clue Markets app: a plain-JavaScript front end (`public/`) served by one Node server (`server.mjs`). The product overview, status and screenshots are in the [root README](../README.md).

## Run

```sh
npm install
npm run preview        # http://127.0.0.1:3000 (loopback only)
node --test tests/*.mjs
```

Run the tests from this folder: one of them starts `server.mjs` by relative path. The live red-team test (`tests/redteam.live.test.mjs`) runs only when `NEARAI_API_KEY` is set and spends a little NEAR AI credit.

## Layout

| Path | What it is |
| --- | --- |
| `server.mjs` | HTTP server: market and order-book proxy, research, saved threads, sharing, sign-in routes |
| `auth.mjs`, `wallet-auth.mjs`, `privy-auth.mjs` | Accounts, NEAR wallet sign-in (signed message), Privy sign-in (token check) |
| `rhea.mjs` | Read-only rNEAR data through `@rhea-finance/rnear-sdk` |
| `answer-links.mjs`, `origins.mjs`, `budget.mjs` | Removing links that did not come from the web search, the approved-origin check, the research budgets |
| `public/` | The site: `app.js`, `ticket.js` (trade preview maths), `style.css`, assets, fonts |
| `privy-client.jsx` | Source of `public/privy.js`. Rebuild with `npm run build:privy` |
| `tests/` | Node tests (`node:test`) |
| `agent/` | An early, unused eve agent scaffold. Do not deploy it without adding authentication and reviewing its tools |

## Deploy

The static site (`public/`) is served from Vercel with `/api` rewritten to the Railway service; `vercel.json` holds the rewrite and security headers. The Railway service runs `node server.mjs` with the settings listed in the root README. Secrets go in the host's variables, never in the repository.
