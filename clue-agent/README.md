# Clue — local research preview

A local early prototype for exploring a broad question or connecting it to a real Polymarket question. The repository-wide product documents are in the parent directory. This preview is not a deployed or authenticated product.

## Run

Requires Node.js 24. In this directory run `npm install`, then `npm run preview` and open http://127.0.0.1:3000. The server binds to loopback only. The preview command enables Node's environment proxy support where configured.

Market discovery uses Polymarket's public Gamma API. Search results display retrieval time and venue rules where provided. Search results are not necessarily active or resolved, and price fields are not executable order quotes.

For AI research, obtain an API key from [NEAR AI Cloud](https://cloud.near.ai/). Set `NEAR_AI_API_KEY` in your shell or secret manager before starting the server; do not put it in source control or the browser. `NEAR_AI_MODEL` can optionally override the default `z-ai/glm-5.3-flash`. A research request sends the question and, if selected, the market question and rules to NEAR AI. Its documented server-side web search may incur provider charges. Do not enter private notes without understanding that transmission. Provider capabilities, citations and output must be checked; an AI response is not settlement authority.

Without a key, research reports that it is unavailable while market search continues to work. This workspace does not implement user accounts, secure private persistence, saved threads, forecasts, publication, trading, automatic monitoring or NEAR Intents funding. It is not suitable for hosting or private production data. NEAR AI authenticated inference and web search have returned a sourced answer for a broad question. Market-connected research remains unreliable: one test returned no search activity or links and is treated as unavailable. The complete research journey is not yet verified.

`agent/` contains an early separate eve agent scaffold and Polymarket tool; the preview server does not yet use it. Do not deploy the scaffold without implementing authentication and reviewing the available tools and data boundaries.
