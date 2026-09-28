import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";

const server = new McpServer({
  name: "Dawat-e-Islami Research MCP",
  version: "1.0.0",
});

const SOURCES = {
  books: "https://www.dawateislami.net/bookslibrary",
  islamicPortal: "https://www.dawateislami.net/islamicportal",
  quran: "https://www.dawateislami.net/quran",
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 Dawat-e-Islami-Research-MCP",
    },
  });

  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}: ${url}`);
  }

  return await response.text();
}

server.registerTool(
  "search_dawat_books",
  {
    description:
      "Search Dawat-e-Islami Al Madina Library / Books Library.",
    inputSchema: {
      query: z.string().min(1),
      page: z.number().int().min(1).default(1),
    },
  },
  async ({ query, page }) => {
    const url =
      `${SOURCES.books}/ur/search` +
      `?stext=${encodeURIComponent(query)}` +
      `&pn=${page}` +
      `&filterLang=ur`;

    const html = await fetchText(url);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: "Dawat-e-Islami Al Madina Library",
              query,
              page,
              url,
              html,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "search_quran",
  {
    description:
      "Search the official Dawat-e-Islami Quran portal for Quran verses and related Quran content.",
    inputSchema: {
      query: z.string().min(1),
    },
  },
  async ({ query }) => {
    const url =
      `${SOURCES.quran}/search/results?q=${encodeURIComponent(query)}`;

    const html = await fetchText(url);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: "Dawat-e-Islami Quran",
              query,
              url,
              html,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "search_islamic_portal",
  {
    description:
      "Search the official Dawat-e-Islami Islamic Portal.",
    inputSchema: {
      query: z.string().min(1),
    },
  },
  async ({ query }) => {
    const url =
      `${SOURCES.islamicPortal}?q=${encodeURIComponent(query)}`;

    const html = await fetchText(url);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: "Dawat-e-Islami Islamic Portal",
              query,
              url,
              html,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "search_all_dawat_sources",
  {
    description:
      "Search the three selected Dawat-e-Islami research sources: Al Madina Library, Islamic Portal, and Quran.",
    inputSchema: {
      query: z.string().min(1),
    },
  },
  async ({ query }) => {
    const results = await Promise.allSettled([
      fetchText(
        `${SOURCES.books}/ur/search?stext=${encodeURIComponent(
          query
        )}&pn=1&filterLang=ur`
      ),
      fetchText(
        `${SOURCES.islamicPortal}?q=${encodeURIComponent(query)}`
      ),
      fetchText(
        `${SOURCES.quran}/search/results?q=${encodeURIComponent(query)}`
      ),
    ]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              sources: [
                {
                  name: "Al Madina Library",
                  url: SOURCES.books,
                  result:
                    results[0].status === "fulfilled"
                      ? results[0].value
                      : String(results[0].reason),
                },
                {
                  name: "Islamic Portal",
                  url: SOURCES.islamicPortal,
                  result:
                    results[1].status === "fulfilled"
                      ? results[1].value
                      : String(results[1].reason),
                },
                {
                  name: "Quran",
                  url: SOURCES.quran,
                  result:
                    results[2].status === "fulfilled"
                      ? results[2].value
                      : String(results[2].reason),
                },
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

export default createMcpHandler(server);
