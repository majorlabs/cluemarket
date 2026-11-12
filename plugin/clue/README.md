# Clue for Claude Code

Research prediction markets, keep a forecast journal and trade on Polymarket from Claude Code.

## Install

1. In Clue (https://www.oncluemarket.xyz), sign in, open the account menu, choose **Connect an AI assistant** and make a key. Tick **Can trade** if you want your assistant to trade.
2. Put the key in your shell: `export CLUE_KEY=clue_ak_...`
3. In Claude Code:

```
/plugin marketplace add majorlabs/cluemarket
/plugin install clue@clue
```

## What you get

- `clue` tools: search markets, get a market, research with sources, save forecasts, read your Journal and Portfolio.
- `clue-trader` tools: buy, sell, open orders and cancel, from your own computer.
- Commands: `/clue:research`, `/clue:portfolio`, `/clue:trade`, `/clue:card`, `/clue:record`, `/clue:brief`.
- Share cards for your positions, your forecast record, and what changed since your calls.

## Trading

Trading uses your own OutLayer agent wallet (https://app.outlayer.ai). Create a wallet there with `evm_sign` allowed, then in Clue open the account menu, choose **Assistant trading**, paste the wallet key and set your own limits per order and per day. Clue keeps the key sealed on its server, checks every order against your limits, and has OutLayer sign it. The order is sent to Polymarket from your computer. Switch it off or freeze the wallet at any time.

Requires Node.js 20 or later.
