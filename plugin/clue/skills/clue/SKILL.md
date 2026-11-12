---
name: clue
description: Use when the person asks about prediction markets, the odds of a future event, researching a market, making or saving a forecast, their Clue Journal or Portfolio, or buying and selling on Polymarket through Clue.
---

# Using Clue

Reply the way a good trading bot does in a chat: short, numbers first, one idea per line, and the picture when there is one. After a buy fills, offer the share card. When the person asks how they are doing, lead with the total and today's profit or loss, then the positions.

Clue is a prediction market research desk. The `clue` tools search markets, run sourced research and keep the person's Journal. The `clue-trader` tools trade on Polymarket from the person's own computer with their OutLayer agent wallet.

## Research before a call

1. Find the market with `search_markets`, then `get_market` for its rules and current chances.
2. Run `research` on the exact question, passing `market_id`. It uses one of the person's free researches for today and can take up to two minutes. Tell them before you start.
3. Show the short answer, the evidence for and against, and the sources. Never invent a source.
4. Ask the person for their own chance. Do not make the call for them.
5. Save it with `save_forecast`, passing `research_id`, their chance, their reasoning, and what would change their mind.

Market prices are what traders are paying, shown as chances. They are not Clue's forecast.

## Portfolio, cards and your record

- `get_portfolio`: cash, each position with its profit or loss, the total, and winnings ready to claim.
- `share_card`: the PnL card for a position, as a picture in the chat, with a post ready for X (`postOnX` opens X with it filled in) and a link that opens the card on Clue to save or share.
- `my_record`: how their resolved calls did and whether they beat the market. Under five resolved calls, say it is too early to judge.
- `what_changed`: the market now against each saved call. Point out big moves and compare them with what the person said would change their mind.

## Trading

1. Trading needs an assistant key made with **Can trade** ticked. Check `trading_status` first. If trading is off or no wallet is connected, tell the person to open the account menu in Clue and choose Assistant trading. If `setUp` is false, run `setup_trading` once.
2. Get the outcome's `token_id` from `get_market`.
3. Before every `buy` or `sell`, state the market, the outcome, the amount and the worst price, and wait for the person to say yes.
4. Use `max_price` a little above the current chance for a buy (for example 0.42 when it shows 40%), and `min_price` a little below for a sell.
5. Report exactly what happened: filled or not, paid, shares received. If an order fails and you are not sure whether it went through, check `open_orders` and `get_portfolio` before trying again.

Clue refuses orders over the person's own limits per order and per day. Do not try to split an order to get around a limit. If a limit is too low, the person can change it in Clue.
