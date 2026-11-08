# Security review, 7 Nov 2026

Scope: the Clue app in `clue-agent/` (server, browser code, Vercel config). Only Clue's own code and a local copy of it were attacked. No real money is involved anywhere in Clue today.

Method: read the request path, attacked a local server with two test accounts, and ran a red team: an uncensored model on NEAR AI Cloud (`Qwen/Qwen3.8-27B-abliterated`) wrote prompt-injection attacks, which were then sent through Clue's real research pipeline. Results were judged by what reached users' pages, not by what the model said.

## Findings, ranked by risk

| # | Risk | Finding | Proof | Status |
| - | - | - | - | - |
| 1 | High | AI research answers could carry attacker links. A hostile question or market text made Clue's research include a phishing link, which the page turned into a clickable link and the user could publish as a public Clue page. | 3 of 4 red-team attacks put `https://clue-payout.example/...` into the answer. One answer opened with "Official place to claim winnings: ...". | Fixed |
| 2 | High | Made-up "AI research" could be saved and published. The browser sent the research text, sources and model name, so anyone signed in could publish a fake "AI-generated" page with any links. | Saved and published a fake report with a payout link and a real model name. | Fixed |
| 3 | Medium | Clickjacking. The live site sent no anti-framing headers, so another site could load Clue invisibly and trick clicks. | Live response headers had no `X-Frame-Options` or `frame-ancestors`. | Fixed (live after deploy) |
| 4 | Medium | NEAR AI credits could be drained. The research limit was per account and in memory; accounts are free to create, so there was no overall cap. | Code reading. Not exploited, to avoid spending credit. | Fixed |
| 5 | Low | Deletes were not origin-checked on the server (only POST was). Browsers' cookie rules blocked the attack, but the server did not. | A DELETE with `Origin: https://evil.example` and a valid cookie returned 200. | Fixed |
| 6 | Low | Internal error text reached users (for example JSON parser messages). | A malformed request returned `Unexpected token ...`. | Fixed |

Held up under attack: reading, publishing, adding forecasts to, overwriting or deleting another user's research (all refused); forged Privy tokens; lookalike origins.

## What changed

1. **#2:** research is produced and stored by the server (`research_results`). Saving takes a `researchId` owned by the user and less than 24 hours old; the browser can no longer supply the text, sources or model. Without research, only a fixed placeholder can be saved, and placeholder threads cannot be published. Test: `tests/research-integrity.test.mjs`.
2. **#1:** the server replaces any URL in an answer that the web search did not return with "[link removed: not from a search result]" before the answer is returned or stored (`answer-links.mjs`). The page only makes a report's own sources clickable. The model is also told not to include other URLs, but nothing relies on that. Tests: `tests/answer-links.test.mjs` (including the exact forms the red team produced, and lookalike URLs) and `tests/redteam.live.test.mjs` (replays the saved attacks through the real pipeline; runs only when `NEARAI_API_KEY` is set; passed after the fix).
3. **#3:** `vercel.json` sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. Test: `tests/headers.test.mjs`.
4. **#4:** an overall hourly research budget for all accounts (default 60, `CLUE_RESEARCH_GLOBAL_PER_HOUR`) on top of 10 per account. Test: `tests/budget.test.mjs`.
5. **#5:** every request except GET and HEAD needs an approved Origin. Test: `tests/http-hardening.test.mjs`.
6. **#6:** only errors marked for users are shown; anything else becomes "Something went wrong" and is logged on the server. Bad JSON gets a plain 400. Test: `tests/http-hardening.test.mjs`.

All tests: 22 pass, 1 skipped without a key (the live red team, which passed with the key).

## Still open

- **Misleading text without links.** A prompt injection can still make the answer *say* misleading things (for example "official place to claim winnings") even though the link is removed. Answers are labelled AI-generated with a warning, but the words are not filtered.
- **Market text in shared pages.** The market question and rules attached to research come from the browser. A user could attach invented market text to their own research and publish it. Fix: look the market up on Polymarket by id on the server.
- **The hourly overall budget resets on restart** and is per server instance. The free allowance and the daily dollar cap are now stored in the database and do not reset (see below).
- **No per-IP limit.** Behind Vercel the client IP is hard to trust, so only per-account and overall limits exist.
- **The live site's other security headers.** Vercel serves the page without a full Content-Security-Policy (only `frame-ancestors`). A full policy needs testing with Privy and the NEAR wallet scripts.
- **NEAR wallet sign-in with a real wallet app.** The signature and key checks are tested, but a sign-in through a real wallet app on mainnet has not been recorded.
- **Trading and funding** are not built yet (preview only), so no money paths exist to attack. They will need their own review before real orders.
- **Keys in chat.** The Privy secret, the Polymarket builder key and two NEAR AI keys were shared in the build conversation. They are kept only in Railway variables, never in the repo, but they should be rotated.

## Memory loop (added 8 Nov)

The Journal adds one new outbound call (Polymarket's public market endpoint, by numeric id only), a note field, and four new fields on a forecast. What was checked: the market id must be digits before it goes into a URL; the market price and outcome are read by the server, never accepted from the browser; notes are text up to 2,000 characters, saved only to the owner's thread; one user cannot read another's journal or write their notes (tested in `tests/journal.test.mjs`); live prices are cached for a minute and the journal looks up at most 100 forecasts, five at a time. Not covered: a background watcher. The Journal compares with the market when you open it, it does not message you.

## Free research and spending cap (8 Nov)

Free research is limited two ways, both stored in the database (`ai_usage`) so a restart cannot reset them: each account gets 2 free researches per UTC day (`CLUE_FREE_RESEARCH_PER_DAY`), and all free research together may not cost more than a daily dollar cap (`CLUE_AI_DAILY_USD`, default $0.25). A run reserves a worst-case cost (`CLUE_AI_RUN_ESTIMATE_USD`, default $0.01) before it starts, so parallel requests cannot overshoot; the real cost is then taken from the token usage NEAR AI reports (prices in `NEAR_AI_PRICE_IN` / `NEAR_AI_PRICE_OUT`, USD per 1M tokens). If NEAR AI reports no usage, the run is charged the estimate. A failed provider call releases its reservation and does not use up the free run. Past the cap, research says it is paused and no provider call is made. Tests: `tests/free-tier.test.mjs`.

Not covered: the web search tool may have a cost beyond tokens; check the first real runs in the NEAR AI dashboard and raise `CLUE_AI_RUN_ESTIMATE_USD` if needed. As a second wall independent of Clue's code, give the key Clue uses its own spend cap in NEAR AI Cloud.

## Funding quotes (8 Nov)

`/api/fund/quote` asks Rhea's cross-chain API for a price to move USDC from Ethereum, Base or Optimism into pUSD on Polygon. It builds, signs and sends nothing. Checks: sign-in required; the source must be on a fixed list; the address must be 0x plus 40 hex characters; the amount a plain decimal between $1 and $10,000; bad requests are refused before Rhea is called. 30 quotes per user per hour and 300 overall protect the Rhea quota. The Rhea key (`RHEA_API_KEY`) stays on the server and is never returned; Rhea's own error text is replaced by one plain sentence. Tests: `tests/fund.test.mjs`. Not covered: building or sending the transfer, which will need its own review. NEAR as a source is not offered: Rhea's NEAR Intents route did not accept pUSD as a destination and timed out when tested.

## Privy sign-in was rejecting every real login (8 Nov)

Found by signing in on the live site with a real email code. Privy returns its public key as one line with no line breaks; Node cannot read that form, so every Privy token failed with "Sign-in could not be verified". The earlier test used a locally generated key that had line breaks, which is why it passed. Fixed by rebuilding the standard layout before use (`normalizePem` in `privy-auth.mjs`), with a test using the key in Privy's one-line form. Verified against a real token from a real sign-in and Privy's real key. Text that is not a key is still refused.

## Wallets for email sign-ins (8 Nov)

Privy is now asked to create an Ethereum wallet for people who sign in without one (`createOnLogin: 'users-without-wallets'`); anyone who already has a wallet is left alone. The "Add money" panel shows the address from `GET /api/privy/wallet`, which asks Privy's API (with the app secret, on the server) which wallet belongs to the signed-in account. The browser never supplies the address, NEAR-wallet accounts are never looked up, and only a plain 0x Ethereum address is returned. The wallet belongs to the user (Privy's non-custodial user wallets); Clue holds no keys. Tests: `tests/privy-wallet.test.mjs`. Not verified until live: whether the Privy dashboard's own embedded-wallet setting (currently reported as off, mode `user-controlled-server-wallets-only`) allows creation; this needs a real sign-in on the live site.
