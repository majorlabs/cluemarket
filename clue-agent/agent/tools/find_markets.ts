import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Search public Polymarket markets by question or topic. Returns source data and retrieval time, not executable prices.",
  inputSchema: z.object({ query: z.string().min(2).max(200) }),
  async execute({ query }, ctx) {
    const url = new URL("https://gamma-api.polymarket.com/public-search");
    url.searchParams.set("q", query);
    const response = await fetch(url, { signal: ctx.abortSignal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Polymarket search unavailable (HTTP ${response.status})`);
    const body = await response.json() as { events?: Array<Record<string, unknown>> };
    return { source: url.toString(), retrievedAt: new Date().toISOString(), events: (body.events ?? []).slice(0, 5).map(event => ({ title: event.title, slug: event.slug, markets: Array.isArray(event.markets) ? event.markets.slice(0, 5).map((market: Record<string, unknown>) => ({ id: market.id, question: market.question, description: market.description, outcomes: market.outcomes, closed: market.closed, endDate: market.endDate, slug: market.slug, conditionId: market.conditionId })) : [] })) };
  },
});
