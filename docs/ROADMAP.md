# Implementation roadmap

Status: partly built. The README's "What works today" table says what has been verified. Anything below that the table does not list as verified is still proposed.

## First complete journey

1. Discover a real Polymarket question with source, timestamp, outcomes and official resolution rules.
2. Show source-linked evidence and a labeled AI summary, including uncertainty and opposing evidence.
3. Save a user's private probability, reasoning and what would change their mind. Preserve revisions.
4. Let the user revisit a real source update and revise their thinking. Add automated monitoring only after source access and a worker are proven.
5. Show a resolved outcome and dated forecast history when available.

Acceptance: a new user can complete this journey against real available data without a trade; missing data and failures are visible.

## Next

- Opt-in public profiles, shared forecasts and discussion with private-by-default access.
- Watch conditions, evidence-linked notifications and mute controls.
- Calibration and replay for resolved forecasts; verified PnL only with reliable fills and fee data.
- Eligible-user Polymarket trading: account, collateral, signed orders, fill and cancellation states, positions, sale or redemption.
- Optional NEAR Intents funding: test quote, deposit, swap status and refund separately from venue compatibility.
- Consider NEAR AI private inference and attestation only after access, pricing and actual verification are established.

Open decisions: authentication, database, source licensing, model provider, alert delivery, venue eligibility, social moderation, wallets, infrastructure cost and privacy model. ANS was mentioned but its intended meaning is unconfirmed.

[Market data](https://docs.polymarket.com/) · [Order book](https://docs.polymarket.com/api-reference/market-data/get-order-book) · [Trading](https://docs.polymarket.com/trading/overview) · [Geoblock](https://docs.polymarket.com/api-reference/geoblock) · [Resolution](https://docs.polymarket.com/concepts/resolution) · [NEAR AI](https://docs.near.ai/) · [NEAR Intents](https://docs.near-intents.org/) · [NEAR CLI](https://docs.near.org/tools/near-cli) · [Agent skills](https://github.com/near/agent-skills) · [Hackathon prompts](https://github.com/nearai/near-hackathon-prompt-examples)

## Broad research proof

Support a new user question without requiring an existing market or page: research accessible sources, cite them, explain uncertainty, and save a private thread. If a matching market exists, connect it optionally. See [research agents](RESEARCH_AGENTS.md). Search-provider selection and actual access remain open.
