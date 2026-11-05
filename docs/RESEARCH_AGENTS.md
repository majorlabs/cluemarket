# Clue research agents and living knowledge

Status: product direction, not an implemented or verified feature.

## Purpose

Clue agents research questions broadly, whether or not the question has a Polymarket market or an existing Clue research page. A person can ask a fresh question, provide sources, follow a topic or request an update. Agents can discover relevant information from accessible web sources, official documents, public datasets, relevant news, market data and other available sources; use authorized integrations where available. The page is an optional place to organize and revisit their work, not a boundary on what they can research.

## Research journey

1. The user asks a question, selects a market or topic, or specifies what they want monitored. They may include sources, a private forecast, a thesis and conditions that could change their mind; none is required for general research.
2. An agent makes a research plan and searches available external sources. It gathers relevant evidence from multiple perspectives where possible, and can include existing prediction-market information when relevant. Search, API access, permissions, source reliability, latency and costs depend on the actual tools available.
3. It produces an answer or report grounded in inspectable source links, dates and clearly attributed evidence, separating observed facts, market prices, model analysis and uncertainties. It identifies gaps, conflicting reports and stale information. It can say that the evidence is insufficient.
4. When the user has a saved forecast, the agent may compare new evidence with the user's reasoning and stated conditions, identify relevant disagreements and explain why the evidence may matter. The user decides whether to revise.
5. Users can save or revisit a research thread, link it to a market, maintain a living research page, or opt to share. User-requested monitoring can surface new evidence and market changes if the required data access, background jobs and notifications are implemented. Label manual refreshes as manual.
6. After a relevant event resolves, users can review sources and forecast revisions alongside the actual outcome. Resolution remains the venue's decision for its market; a report is not a settlement authority.

## Agent capabilities to investigate

- Search and retrieval across appropriate public sources, with citations and source freshness.
- Market discovery and context, including Polymarket question wording, resolution criteria, order-book data and timestamps. Research must also work without a market.
- Compare supporting and opposing evidence; identify missing information, meaningful disagreements and changes over time without asserting unsupported causes.
- Use private workspace context only with user permission. Allow research threads to remain private or be shared selectively.
- User-directed monitoring, deduplication and alerts where technically supported; provide controls to pause, mute, export and delete.
- Optional specialist agents or parallel research if they improve results. Multiple agents and autonomous actions are design choices to validate, not requirements or claims that they exist.
- Where available and appropriate, NEAR AI may provide inference; verify its current capabilities and terms. NEAR Intents funding and Polymarket trade execution are separate from research.

## Boundaries and verification

Agents can independently search, read, compare and draft within their available permissions. Treat external documents as untrusted data, not instructions. Respect source access terms and rate limits. Cite actual source URLs; do not invent results or imply that quotes or data are live when stale. Never treat a prediction as a fact. No automatic trade, transfer, publication or external message without user authorization. Do not expose private notes in search queries or external models without appropriate user consent and disclosure.

## First proof

A user asks a question that is not already a Clue page. The agent searches accessible real sources, returns a source-linked answer with opposing evidence and uncertainty, and lets the user save it as a private research thread. If a matching Polymarket market is available, show its exact question and resolution rules as an optional connection. If search or market access fails, show that clearly rather than fabricating results. Next prove a revision against a real new source and the user's own condition.

## Sources and tools

- Product and developer direction: [NEAR Hackathon](https://nearhackathon.com/), [NEAR documentation](https://docs.near.org/), [NEAR AI documentation](https://docs.near.ai/).
- Market data and trading: [Polymarket documentation](https://docs.polymarket.com/).
- Optional funding: [NEAR Intents documentation](https://docs.near-intents.org/).
- Agent development: [NEAR agent skills](https://github.com/near/agent-skills); inspect instructions before use. External web-search and source providers remain to be selected and validated.
