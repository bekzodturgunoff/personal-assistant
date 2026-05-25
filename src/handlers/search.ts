import {config} from "../config.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function needsSearch(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(weather|news|price|latest|current|today|who is|what is|where is|how much|stock|rate|exchange|ob-havo|yangiliklar|narx|kurs)\b/i.test(lower) ||
    /what('s| is) the|who('s| is) the|how (much|many)|when (is|was|will)/i.test(lower)
  );
}

export async function webSearch(query: string): Promise<SearchResult[] | null> {
  const key = config.searchApiKey;
  if (!key) return null;

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({q: query, num: 3}),
    });

    if (!res.ok) {
      console.error(`Search API error: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { organic?: {title: string; link: string; snippet: string}[] };
    if (!data.organic || data.organic.length === 0) return null;

    return data.organic.slice(0, 3).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));
  } catch (e) {
    console.error("Search failed:", e);
    return null;
  }
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "";
  return (
    "Web search results:\n" +
    results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
      .join("\n")
  );
}

export async function enhanceWithSearch(text: string): Promise<string> {
  if (!needsSearch(text)) return text;
  const results = await webSearch(text);
  if (!results || results.length === 0) return text;
  return `${formatSearchResults(results)}\n\nUser question: ${text}`;
}
