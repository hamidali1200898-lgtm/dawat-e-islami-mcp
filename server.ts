import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({
    name: "Dawat-e-Islami Research MCP",
    version: "1.0.0",
  });

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
        `https://www.dawateislami.net/bookslibrary/ur/search` +
        `?stext=${encodeURIComponent(query)}` +
        `&pn=${page}` +
        `&filterLang=ur`;

      const response = await fetch(url);
      const html = await response.text();

      return {
        content: [
          {
            type: "text",
            text: `Source: Dawat-e-Islami Al Madina Library\nURL: ${url}\n\n${html}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "search_quran",
    {
      description:
        "Search the official Dawat-e-Islami Quran portal.",
      inputSchema: {
        query: z.string().min(1),
      },
    },
    async ({ query }) => {
      const url =
        `https://www.dawateislami.net/quran/search/results?q=${encodeURIComponent(query)}`;

      const response = await fetch(url);
      const html = await response.text();

      return {
        content: [
          {
            type: "text",
            text: `Source: Dawat-e-Islami Quran\nURL: ${url}\n\n${html}`,
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
        `https://www.dawateislami.net/islamicportal?search=${encodeURIComponent(query)}`;

      const response = await fetch(url);
      const html = await response.text();

      return {
        content: [
          {
            type: "text",
            text: `Source: Dawat-e-Islami Islamic Portal\nURL: ${url}\n\n${html}`,
          },
        ],
      };
    }
  );

  return server;
}

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return createMcpHandler(createServer)(request, env, ctx);
  },
};
