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
- **Budgets reset on restart** and are per server instance. Fine for one Railway instance; move to the database if the service scales out.
- **No per-IP limit.** Behind Vercel the client IP is hard to trust, so only per-account and overall limits exist.
- **The live site's other security headers.** Vercel serves the page without a full Content-Security-Policy (only `frame-ancestors`). A full policy needs testing with Privy and the NEAR wallet scripts.
- **NEAR wallet sign-in end to end.** The local NEAR sandbox needs 65,535 open files and this machine allows 20,000, so the wallet login was not run against a real chain. Its signature checks are covered by the existing unit test; the account-key check calls mainnet RPC and is mocked in tests.
- **Trading and funding** are not built yet (preview only), so no money paths exist to attack. They will need their own review before real orders.
- **Keys in chat.** The Privy secret, the Polymarket builder key and two NEAR AI keys were shared in the build conversation. They are kept only in Railway variables, never in the repo, but they should be rotated.
