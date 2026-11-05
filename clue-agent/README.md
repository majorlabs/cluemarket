# Clue — local research preview

A local early prototype for exploring a broad question or connecting it to a real Polymarket question. The repository-wide product documents are in the parent directory. This preview is not a deployed or authenticated product.

## Run

Requires Node.js 24. In this directory run `npm install`, then `npm run preview` and open http://127.0.0.1:3000. The server binds to loopback only. The preview command enables Node's environment proxy support where configured.

Market discovery uses Polymarket's public Gamma API. Search results display retrieval time and venue rules where provided. Search results are not necessarily active or resolved, and price fields are not executable order quotes.

For AI research, obtain an API key from [NEAR AI Cloud](https://cloud.near.ai/). Set `NEAR_AI_API_KEY` in your shell or secret manager before starting the server; do not put it in source control or the browser. `NEAR_AI_MODEL` can optionally override the default `z-ai/glm-5.3-flash`. A research request sends the question and, if selected, the market question and rules to NEAR AI. Its documented server-side web search may incur provider charges. Do not enter private notes without understanding that transmission. Provider capabilities, citations and output must be checked; an AI response is not settlement authority.

Without a key, research reports that it is unavailable while market search continues to work. The local preview supports email/password accounts, private per-user threads, research revisions and forecast revisions stored in a SQLite database under `.clue-data/` (or `CLUE_DATA_DIR`). Users can export or delete a thread, save forecasts with supporting and opposing evidence, and explicitly share an individual research snapshot. Shared snapshots exclude private forecast fields. This local storage is not encrypted and exists only on the machine running the preview; use only data suitable for local development. The server is loopback-only and is not suitable for public hosting or production data. Public profiles, discussion, trading, automatic monitoring and NEAR Intents funding are not implemented. Local sharing links only work on the same machine. NEAR AI authenticated inference and web search have returned a sourced answer for a broad question. Both broad and market-connected research have returned source URLs in API tests; provider calls can still fail or return no sources, and errors are shown. Browser-level testing, secure hosted persistence, and the full production journey remain unverified.

`agent/` contains an early separate eve agent scaffold and Polymarket tool; the preview server does not yet use it. Do not deploy the scaffold without implementing authentication and reviewing the available tools and data boundaries.

## Database development

The local preview uses SQLite by default. When `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are supplied, it uses Postgres; the current HTTP server remains restricted to loopback and is not yet configured for hosting. Run `node --test tests/private-workspace.test.mjs` to verify user isolation, revisions, forecasts and explicit sharing with a temporary local SQLite database.
