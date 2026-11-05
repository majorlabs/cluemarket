# Prediction product: product and build brief

**Product name:** Clue.  
**Status:** Strategy and engineering research; no application or trading integration has been built or verified.  
**Scope:** General prediction, knowledge and decisions across many subjects. Memecoins are optional topics, not the product focus.

## 1. Vision

Help people understand questions, record their own beliefs, follow evidence that could change their minds, and learn from real outcomes. Where available and lawful, let users trade existing prediction markets through a connected venue. A private decision workspace connects to an optional public forecasting profile and social feed.

Core story: find a question → read evidence and market rules → record a forecast and a condition that would change your mind → follow relevant updates → optionally trade → see the outcome and replay your reasoning → share only what you choose.

## 2. Product principles

- An existing market price is not objective truth; distinguish best bid, best ask, midpoint, last traded price and an interpreted probability. Display the source, time, spread and liquidity context.
- An AI summary is an interpretation, not a source or settlement authority. Link to original material and say when information is stale, missing, disputed or unverified. Never assert an inferred event caused a price move as a fact.
- The external venue's wording, outcome and resolution rules are authoritative for its positions. Our forecasts do not create new markets or change their settlement.
- A practice forecast is not a real financial position. Clearly label simulated, live, verified and unavailable data.
- No forced trade, auto-copy, autonomous trading or transaction signing. The user approves each actual transaction. No return or investment promises.
- Private notes, positions and user-selected watch conditions stay private by default. Publish only with explicit user action; do not put private content onto a public chain.
- Avoid artificial urgency and manipulative retention; users control alerts and can mute, export and delete their records subject to legal/technical constraints.

## 3. Primary users and needs

Curious readers need plain explanations and sources; forecasters want timestamped beliefs and learning; eligible traders need venue positions and execution transparency; creators want to publish reasoning and build a credible track record. Demand and willingness to pay are hypotheses, not verified.

## 4. Product journey

### A. Explore

Search and browse multiple categories; show externally sourced markets and updates. Show exact market text, outcome labels, market identifier, venue, current status, resolution rules, closing/resolution information and current order-book context. Ensure source attribution and stale/error state. Differentiate order-book depth from historic trading volume.

### B. Understand

Source-linked page summarizes exact resolution rule, strongest supporting/opposing evidence, times and known uncertainty. Allow source inspection. A linked report can never override the venue's official terms. Label generated output and keep observed facts separate from model interpretation.

### C. Forecast privately

User records 0–100% probability, free-text reasoning, supporting and opposing evidence, and a concrete condition that could change their mind. Preserve timestamped revisions; record price snapshot and its provenance without representing mid as an executable order. Forecasting does not require a trade.

### D. Follow

User opts in to monitoring. Fetch approved available sources; deduplicate; retain source, timestamp, content metadata and baseline; AI proposes relevance to the user's stated condition. Present an evidence-linked alert with 'may be relevant' and user controls to confirm, dismiss, mute or revise. No unsupported causal claims. Without an active scheduler or reliable source API, label the flow manual and do not promise automatic monitoring.

### E. Trade with existing venue liquidity

Polymarket is the primary proposed integration. Discover external markets and order books, then for eligible users connect a compatible user-controlled wallet/account, verify venue eligibility, ensure correct collateral and approvals, show estimated execution, depth, fees and limits, obtain an explicit signed order and submit to Polymarket CLOB. Track pending, open, partial, filled, canceled, rejected and failed. Do not collect or store private keys. Users can cancel/manage orders under venue rules.

An accepted order is not necessarily matched. Orders can partially fill, remain open, cancel or fail; a sale before resolution requires an available buyer. Holding through final resolution is different: redeem winning positions through the venue/contract under that market's payout rules, including split/invalid outcomes where applicable. Payout collateral is not money provided by our team. This integration has not been executed or tested.

### F. Replay and learn

Upon final venue resolution, show market result/source and the user's timestamped forecast revisions and evidence; if user traded, display connected position, realized versus unrealized PnL and transaction provenance, including fees when known. Mark unsupported/missing calculations as unavailable. Assess probability calibration only across sufficiently many resolved comparable predictions using a documented proper score such as Brier score. Never claim that an AI or trader consistently beats the market without reproducible out-of-sample evidence.

### G. Share and social

Private by default; optional public profile, follow, feed and discussion. Choose which forecast, reasoning, revision and/or PnL card to publish. Public and private data are separate. A timestamped share card can show market, forecast, observed quote at time, later result and citations, while identifying simulated versus verified activity. Show fees and calculation basis on PnL cards; redact account IDs and size if requested and supported. Public track records must retain version history; prevent selective deletion from being misrepresented as complete performance. Abuse, moderation, consent, age/jurisdiction and reporting need product design.

## 5. What the product is not

Not a generic AI chat, an unverified price-prediction bot, a new liquidity pool, an oracle that lets an LLM decide outside markets, a meme-only app, a finished product or an assertion of profitability. Existing tools such as Forecast Alpha, PolySays, Justify and agent-research offerings have meaningful overlap; no global novelty claim is verified.

## 6. Proposed architecture and trust boundaries

1. Web UI: markets, research page, private workspace, alerts, social profile, trade/position and replay. No chosen framework is final.
2. External market adapters: Polymarket discovery and CLOB/order-book and position adapters. Handle both Polymarket CTF and newer protocol-version identifiers using official SDK/schema. Preserve source IDs, timestamps and conditions.
3. Evidence ingestion: licensed/authorized public source adapters, archival metadata and snippets permitted by rights, timestamps, deduplication, quality/freshness tracking; links to originals. Prevent prompt injection from retrieved content affecting orders or policies.
4. AI analysis: NEAR AI Cloud is a candidate provider; cite retrieved sources, label inference, resist unsupported conclusions, and return 'unknown' when evidence is absent. Verify model access, pricing, limits and privacy terms. Do not claim enclave attestation without real verified proof.
5. User records: authenticated private database for forecasts/revisions/watch rules. Append immutable application-level event history; define export, deletion, encryption and access rules. Source-availability and privacy tradeoffs remain open.
6. Notifications: user-approved monitoring worker, deduplicated alerts and delivery controls; no unsolicited outbound messages. Respect source rate limits.
7. Wallet and venue execution: user signer and venue-supported account on Polygon; distinguish user authorization, order status and settlement. User manages wallet keys. Apply venue geoblocking and terms; no circumvention.
8. Cross-chain funding: optional NEAR Intents 1Click quote/deposit/status into a supported destination asset/address, followed separately by correct Polymarket collateral/account/wallet setup and a signed CLOB order. Check supported assets, real quotes, minimum amounts, slippage, fees, timing, refunds and destination. NEAR Intents swap liquidity and Polymarket YES/NO liquidity are different things. Never claim one signature or seamless funding before an end-to-end test.
9. Social layer: explicit opt-in visibility and moderation; forecast and verified trade are different entities; public data should not reveal private wallet or note contents without consent.

## 7. Revenue and operating costs

- Possible Polymarket builder fees on matched routed orders, subject to actual program eligibility, terms and caps. They add to venue fees and must be disclosed. Documentation contains an apparent inconsistency: the tier comparison says unverified builders have builder fees while the verified tier lists monetization as an unlock. Confirm before assuming access or earnings.
- Optional research subscription is an untested hypothesis. Do not assume demand or income.
- Estimate and monitor AI inference, data/API, storage, alerts, relayer/gas, payment and support costs. No simulated volume should be described as revenue.
- Example only: $100,000 matched notional × 0.25% = $250 gross builder fee before costs and assuming permission and collection. Not a forecast.

## 8. Build and verification gates

1. Read-only integration: discover real Polymarket market; fetch exact question, rules, outcomes, order book and source time; handle missing data and network errors.
2. Journal: save and retrieve a user's forecast, evidence and revision timestamps with authentication and privacy boundaries.
3. Watch condition: use a real, appropriately licensed source update; if manually triggered, label it manual. Show the evidence and no unsupported claim of causation.
4. Replay: reconstruct a point-in-time sequence without hindsight leakage and use an actual resolution source when available.
5. Social: explicit publication, accurate representation of a forecast versus a verified trade, and tested visibility controls.
6. Trading: prove region-eligible user account setup → funded supported wallet → explicit signed buy → actual fill status → position → sell or redeem. No assertion of live integration until tested. Never bypass venue restrictions.
7. NEAR Intents: separately prove a supported quote → deposit → terminal success/refund → destination accounting; then verify if it actually connects with the venue's account/collateral process. Failure must not silently place a trade.
8. PnL: calculate from filled orders and venue data, with timestamp, units, realized/unrealized definitions and fee treatment; test against known records. Unsupported/missing data means unavailable.

## 9. Design and user-facing quality

Clean, readable mobile and desktop; approachable to non-experts. Show exact question and resolution rules before the trade. Focus on evidence, clear data provenance, personal memory and trustworthy feedback. Accessibility: keyboard access, labels, contrast and readable text. PnL and social cards are secondary to accurate source data and user control. No fictitious live prices, positions, claims, partnerships or integration badges.

## 10. Competitors and inspiration

- Forecast Alpha private research workspace: https://www.forecast-alpha.com/research — forecast/conditions/history; it identifies simulated engine output in parts of its interface.
- PolySays: https://polysays.com/ — price movement and sourced context, including unexplained moves.
- Justify hackathon project: https://ethglobal.com/showcase/justify-odzs7 — social markets, profiles and PnL; agent network described as next layer.
- Honeybee prize project: https://ethglobal.com/showcase/honeybee-eaicc — paid multi-agent market research and sourced recommendations.
- Pythia prize project: https://ethglobal.com/showcase/pythia-gj44b — independent inference and receipts; receipts alone do not establish forecast correctness.
- Capitola and Fora official winner announcement: https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/ — aggregation and social interaction; announcement does not verify full workflows.
- Metaculus: https://www.metaculus.com/faq/ — forecasts and resolution; it describes itself as a prediction aggregator, not a prediction market.

The above are inspiration, not proof of user demand, safety, current operating status, unique novelty or competition results beyond cited announcements.

## 11. Official development resources

### Hackathon and coding-agent materials
- Main page, tracks and submission: https://nearhackathon.com/
- Organizer's agent instructions: https://nearhackathon.com/HACKATHON.md — linked by the event, but browser retrieval previously failed due to unsupported Markdown content type. Read its actual latest content before relying on it. Do not invent missing rules or a separate 'harness'.
- Official prompt examples and setup: https://github.com/nearai/near-hackathon-prompt-examples and https://github.com/nearai/near-hackathon-prompt-examples/blob/main/00-setup.md
- Official NEAR agent skills: https://github.com/near/agent-skills — inspect current contents and permissions before installing. These are developer-assistance instructions, not evidence that integrations are built. Do not execute downloaded code blindly.
- NEAR CLI: https://github.com/near/near-cli-rs and https://docs.near.org/tools/near-cli — review current install and account management docs; never commit credentials.
- NEAR development docs: https://docs.near.org/
- User mentioned 'ANS': exact intended resource is unconfirmed. Could mean AGENTS.md, agent skills, or Agent Name Service; do not assert which one. Include project-specific AGENTS.md only after project target and requirements are established; verify any distinct named protocol before integration.

### Polymarket
- Trading and wallets: https://docs.polymarket.com/trading/overview and https://docs.polymarket.com/trading/quickstart
- Official SDKs and API index: https://docs.polymarket.com/
- Order book: https://docs.polymarket.com/api-reference/market-data/get-order-book
- Market and price examples: https://institute.polymarket.com/data
- Builder program: https://docs.polymarket.com/programs/builders/overview
- Builder fees and tiers: https://docs.polymarket.com/programs/builders/fees and https://docs.polymarket.com/programs/builders/tiers
- Venue fees: https://docs.polymarket.com/trading/fees
- Geography: https://docs.polymarket.com/api-reference/geoblock
- Resolution: https://docs.polymarket.com/concepts/resolution

### NEAR ecosystem
- Intents: https://docs.near-intents.org/ and https://github.com/near/agent-skills/tree/main/skills/near-intents
- Reference quote lifecycle: https://github.com/near/agent-skills/blob/main/skills/near-intents/references/concepts.md
- Example integrations: https://github.com/near-examples/near-intents-examples
- NEAR AI: https://docs.near.ai/ ; model access and pricing to be checked.
- Rhea: https://rhea.finance/ and https://guide.rhea.finance/ ; optional, requires technical fit.
- OutLayer: https://app.outlayer.ai/docs/getting-started and https://app.outlayer.ai/docs/trust-verification ; optional, no verified need yet. A TEE quote does not itself prove source compiled to a binary or that retrieved facts are true.

## 12. Hackathon considerations

The event requests a working prototype with a public repository and a public demo post, and human judges decide after an automated run/README check. The public page allows selecting multiple fitting tracks. Do not invent a track or scoring weights: check https://nearhackathon.com/ for the current criteria. A clear README should include prerequisites, setup, real-data provenance, exact 'do X, see Y' steps, test results and limitations. The user explicitly does not want repeated deadline discussions.

## 13. Immediate decisions and blockers

- Clue is the working product name; trademark and domain clearance are unverified.
- Project repository: https://github.com/majorlabs/cluemarket.
- Clarify what the user means by ANS if the intended resource cannot be identified from actual project links.
- Preserve the founder's broad knowledge/market idea; do not constrain it to memecoins. Clearly distinguish a first implementation using existing Polymarket markets from the founder's proposed perpetual truth-seeking markets.
- Prioritize independent validation of differentiation, actual source availability, cross-chain execution, order signing, payout/redeem and venue policies. No project claim is established as unshipped or commercially validated.

## 14. Broad research agents and living knowledge

The research agent is not confined to existing Clue pages or prediction markets. Users can ask new questions and direct research across available external sources, then save findings and optionally connect them to markets, forecasts and living research pages. User-directed monitoring, when implemented, can revisit sources and relate new evidence to a user's thesis and conditions. The page organizes the research; it does not restrict the agent. See [RESEARCH_AGENTS.md](RESEARCH_AGENTS.md) for the full journey, proof and boundaries.
