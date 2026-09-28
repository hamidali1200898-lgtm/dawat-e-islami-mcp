import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const BASE = "https://www.dawateislami.net";

const QURAN = {
  search: `${BASE}/quran/search/results`,
  intro: `${BASE}/quran/intro/sirat-ul-jinan/saal`,
  home: `${BASE}/quran`,
};

const SOURCES = {
  books: "Dawat-e-Islami Al Madina Books Library",
  quran: "Dawat-e-Islami Quran",
  portal: "Dawat-e-Islami Islamic Portal",
};

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}

function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLinks(html: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const regex = /href\s*=\s*["']([^"']+)["']/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();

    if (
      !raw ||
      raw.startsWith("#") ||
      raw.startsWith("javascript:") ||
      raw.startsWith("mailto:")
    ) {
      continue;
    }

    try {
      const url = new URL(raw, BASE).toString();

      if (
        url.includes("dawateislami.net") &&
        !seen.has(url)
      ) {
        seen.add(url);
        output.push(url);
      }
    } catch {
      // Ignore invalid links.
    }

    if (output.length >= 100) break;
  }

  return output;
}

async function fetchSource(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "Dawat-e-Islami-Research-MCP/2.0",
      },
    });

    const html = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      url,
      html,
      text: htmlToText(html),
      links: extractLinks(html),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      html: "",
      text: `SOURCE REQUEST ERROR: ${
        error instanceof Error ? error.message : String(error)
      }`,
      links: [],
    };
  }
}

/* ---------------------------------------------------------
   Quran extraction helpers
--------------------------------------------------------- */

function findContext(text: string, query: string): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const index = lowerText.indexOf(lowerQuery);

  if (index < 0) {
    return text.slice(0, 8000);
  }

  const start = Math.max(0, index - 3500);
  const end = Math.min(text.length, index + 7000);

  return text.slice(start, end);
}

function extractLabeledSection(
  text: string,
  labels: string[],
  max = 10000
): string | null {
  for (const label of labels) {
    const index = text.indexOf(label);

    if (index >= 0) {
      return text.slice(index, index + max).trim();
    }
  }

  return null;
}

function buildQuranResearchResult(
  query: string,
  result: Awaited<ReturnType<typeof fetchSource>>
) {
  const text = result.text;

  const kanzulIman = extractLabeledSection(
    text,
    [
      "ترجمہ کنزالایمان",
      "ترجمۂ کنزالایمان",
      "کنزالایمان",
      "کنز الایمان",
    ],
    6000
  );

  const kanzulIrfan = extractLabeledSection(
    text,
    [
      "ترجمہ کنز العرفان",
      "ترجمۂ کنز العرفان",
      "کنز العرفان",
      "کنزُالعرفان",
    ],
    6000
  );

  const siratUlJinan = extractLabeledSection(
    text,
    [
      "تفسیر صراط الجنان",
      "صراط الجنان",
      "صِراطُ الجِنان",
    ],
    10000
  );

  return {
    query,
    source: SOURCES.quran,
    source_url: result.url,
    http_status: result.status,

    /* Important:
       These are source-detection fields, not fabricated text.
    */
    detected: {
      kanzul_iman: Boolean(kanzulIman),
      kanzul_irfan: Boolean(kanzulIrfan),
      sirat_ul_jinan: Boolean(siratUlJinan),
    },

    source_text: findContext(text, query),

    detected_sections: {
      kanzul_iman: kanzulIman,
      kanzul_irfan: kanzulIrfan,
      sirat_ul_jinan: siratUlJinan,
    },

    source_links: result.links.slice(0, 50),

    research_rules: [
      "Do not invent Quran Arabic.",
      "Do not invent translation.",
      "Do not invent tafsir.",
      "Do not invent page numbers.",
      "Do not invent book references.",
      "Preserve official source URL.",
      "Separate source text from model-generated explanation.",
    ],
  };
}

/* ---------------------------------------------------------
   Server
--------------------------------------------------------- */

function createServer() {
  const server = new McpServer({
    name: "Dawat-e-Islami Research MCP",
    version: "3.0.0",
  });

  /* =======================================================
     1. COMPLETE QURAN RESEARCH
     ======================================================= */

  server.registerTool(
    "quran_research",
    {
      description:
        "Primary Quran research tool for the official Dawat-e-Islami Quran source. " +
        "Searches official Quran content and attempts to identify the complete " +
        "Arabic Quran verse/context, Kanz-ul-Iman, Kanz-ul-Irfan and Sirat-ul-Jinan " +
        "sections when returned by the official source. Also preserves source URLs " +
        "and detected reference material. Never fabricate missing text.",

      inputSchema: {
        query: z.string().min(1).max(300),

        mode: z
          .enum([
            "all",
            "quran_only",
            "kanzul_iman",
            "kanzul_irfan",
            "tafsir",
            "summary",
            "references",
          ])
          .default("all"),
      },
    },

    async ({ query, mode }) => {
      const url =
        `${QURAN.search}?q=${encodeURIComponent(query)}`;

      const result = await fetchSource(url);

      const research = buildQuranResearchResult(
        query,
        result
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...research,
                requested_mode: mode,

                output_policy: {
                  quran_arabic:
                    "Return official source text when available.",
                  kanzul_iman:
                    "Use official source; do not fabricate or reconstruct.",
                  kanzul_irfan:
                    "Use official source; do not fabricate or reconstruct.",
                  sirat_ul_jinan:
                    "Use official source; distinguish source text from summary.",
                  references:
                    "Preserve references exactly when available.",
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* =======================================================
     2. QURAN AYAH LOOKUP
     ======================================================= */

  server.registerTool(
    "quran_ayah",
    {
      description:
        "Look up a specific Quran surah and ayah through the official " +
        "Dawat-e-Islami Quran source. Use this when the user gives a surah " +
        "and ayah number. Preserve the official Arabic, translations, tafsir " +
        "and citations when returned.",

      inputSchema: {
        surah: z.number().int().min(1).max(114),
        ayah: z.number().int().min(1).max(286),

        mode: z
          .enum([
            "all",
            "arabic",
            "kanzul_iman",
            "kanzul_irfan",
            "tafsir",
            "references",
          ])
          .default("all"),
      },
    },

    async ({ surah, ayah, mode }) => {
      /*
       * Search by canonical Quran reference.
       * This avoids assuming an undocumented internal API endpoint.
       */
      const query = `${surah}:${ayah}`;

      const url =
        `${QURAN.search}?q=${encodeURIComponent(query)}`;

      const result = await fetchSource(url);

      const research = buildQuranResearchResult(
        query,
        result
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                surah,
                ayah,
                reference: `${surah}:${ayah}`,
                requested_mode: mode,
                ...research,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* =======================================================
     3. QURAN SEARCH
     ======================================================= */

  server.registerTool(
    "search_quran",
    {
      description:
        "Search the official Dawat-e-Islami Quran portal for a Quranic " +
        "word, phrase, topic, surah or ayah. Returns official source text " +
        "and source links. Use quran_research when translations/tafsir " +
        "and citation-aware research is required.",

      inputSchema: {
        query: z.string().min(1).max(300),
      },
    },

    async ({ query }) => {
      const url =
        `${QURAN.search}?q=${encodeURIComponent(query)}`;

      const result = await fetchSource(url);

      return {
        content: [
          {
            type: "text",
            text: [
              `SOURCE: ${SOURCES.quran}`,
              `QUERY: ${query}`,
              `URL: ${url}`,
              `HTTP STATUS: ${result.status}`,
              "",
              "OFFICIAL SOURCE TEXT:",
              result.text || "(No text returned.)",
              "",
              "OFFICIAL DAWAT LINKS:",
              result.links.length
                ? result.links
                    .slice(0, 50)
                    .map((x) => `- ${x}`)
                    .join("\n")
                : "(No links returned.)",
            ].join("\n"),
          },
        ],
      };
    }
  );

  /* =======================================================
     4. QURAN SOURCE / INTRO / METHODOLOGY
     ======================================================= */

  server.registerTool(
    "quran_source_info",
    {
      description:
        "Return official Dawat-e-Islami information about the Quran/Tafsir " +
        "system, including Kanz-ul-Iman, Kanz-ul-Irfan and Sirat-ul-Jinan.",
      inputSchema: {},
    },

    async () => {
      const result = await fetchSource(QURAN.intro);

      return {
        content: [
          {
            type: "text",
            text: [
              `SOURCE: ${SOURCES.quran}`,
              `URL: ${QURAN.intro}`,
              "",
              result.text,
              "",
              "OFFICIAL LINKS:",
              result.links.slice(0, 50).join("\n"),
            ].join("\n"),
          },
        ],
      };
    }
  );

  /* =======================================================
     5. DAWAT BOOK LIBRARY
     ======================================================= */

  server.registerTool(
    "search_dawat_books",
    {
      description:
        "Search the official Dawat-e-Islami Al Madina Books Library.",
      inputSchema: {
        query: z.string().min(1).max(300),
        page: z.number().int().min(1).max(50).default(1),
      },
    },

    async ({ query, page }) => {
      const url =
        `${BASE}/bookslibrary/ur/search` +
        `?stext=${encodeURIComponent(query)}` +
        `&pn=${page}` +
        `&filterLang=ur`;

      const result = await fetchSource(url);

      return {
        content: [
          {
            type: "text",
            text: [
              `SOURCE: ${SOURCES.books}`,
              `QUERY: ${query}`,
              `PAGE: ${page}`,
              `URL: ${url}`,
              "",
              result.text,
              "",
              "OFFICIAL LINKS:",
              result.links.slice(0, 50).join("\n"),
            ].join("\n"),
          },
        ],
      };
    }
  );

  /* =======================================================
     6. ISLAMIC PORTAL
     ======================================================= */

  server.registerTool(
    "search_islamic_portal",
    {
      description:
        "Search the official Dawat-e-Islami Islamic Portal. " +
        "Use this only for Islamic Portal research, not news/Faizan-e-Madina.",
      inputSchema: {
        query: z.string().min(1).max(300),
      },
    },

    async ({ query }) => {
      const url =
        `${BASE}/islamicportal?search=${encodeURIComponent(query)}`;

      const result = await fetchSource(url);

      const portalLinks = result.links.filter(
        (x) =>
          x.includes("/islamicportal") ||
          x.includes("/bookslibrary")
      );

      return {
        content: [
          {
            type: "text",
            text: [
              `SOURCE: ${SOURCES.portal}`,
              `QUERY: ${query}`,
              `URL: ${url}`,
              "",
              result.text,
              "",
              "RELEVANT OFFICIAL LINKS:",
              portalLinks.slice(0, 50).join("\n"),
            ].join("\n"),
          },
        ],
      };
    }
  );

  /* =======================================================
     7. ALL DAWAT SOURCES
     ======================================================= */

  server.registerTool(
    "research_dawat_sources",
    {
      description:
        "Run a single research question across Dawat-e-Islami Books, " +
        "Quran and Islamic Portal. Use this for broad Dawat research.",
      inputSchema: {
        query: z.string().min(1).max(300),
      },
    },

    async ({ query }) => {
      const booksUrl =
        `${BASE}/bookslibrary/ur/search` +
        `?stext=${encodeURIComponent(query)}` +
        `&pn=1&filterLang=ur`;

      const quranUrl =
        `${QURAN.search}?q=${encodeURIComponent(query)}`;

      const portalUrl =
        `${BASE}/islamicportal?search=${encodeURIComponent(query)}`;

      const [books, quran, portal] =
        await Promise.all([
          fetchSource(booksUrl),
          fetchSource(quranUrl),
          fetchSource(portalUrl),
        ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,

                sources: {
                  books: {
                    name: SOURCES.books,
                    url: booksUrl,
                    status: books.status,
                    text: books.text,
                    links: books.links.slice(0, 30),
                  },

                  quran: buildQuranResearchResult(
                    query,
                    quran
                  ),

                  islamic_portal: {
                    name: SOURCES.portal,
                    url: portalUrl,
                    status: portal.status,
                    text: portal.text,
                    links: portal.links.slice(0, 30),
                  },
                },

                rules: [
                  "Official sources only.",
                  "Never fabricate source text.",
                  "Preserve source URLs.",
                  "Separate Quran Arabic from translations.",
                  "Separate source quotation from generated explanation.",
                  "Preserve available bibliographic references.",
                  "Do not silently substitute News/Faizan-e-Madina for Islamic Portal.",
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

  /* =======================================================
     8. RESEARCH POLICY
     ======================================================= */

  server.registerTool(
    "get_research_source_policy",
    {
      description:
        "Return the complete configured source and citation policy.",
      inputSchema: {},
    },

    async () => {
      return {
        content: [
          {
            type: "text",
            text: `
DAWAT-E-ISLAMI RESEARCH POLICY

QURAN SOURCES
1. Official Quran Arabic
2. Kanz-ul-Iman
3. Kanz-ul-Irfan
4. Sirat-ul-Jinan
5. Official Quran source references

QURAN OUTPUT
- Surah name
- Surah number
- Ayah number
- Full official Arabic when available
- Kanz-ul-Iman when available
- Kanz-ul-Irfan when available
- Sirat-ul-Jinan when available
- Short generated summary when requested
- Source references
- Official URL

CITATION RULES
- Quran: (سورۃ، سورۃ نمبر:آیت نمبر)
- Preserve book volume/page when the official source provides it.
- Never invent page numbers.
- Never invent hadith numbers.
- Never invent authors or publishers.
- Keep source quotation separate from model explanation.

RESEARCH RULES
- Search official Dawat-e-Islami sources first.
- No Faizan-e-Madina/news substitution for Islamic Portal.
- Do not fabricate unavailable text.
- If a requested source is unavailable, explicitly mark it unavailable.
- For copyrighted translations/tafsir, use permitted short quotations,
  source locations and summaries rather than reproducing entire works.

EXTERNAL MCP ARCHITECTURE
- Shamela remains its own MCP connection.
- Turath remains its own MCP connection.
- This Worker does not proxy their OAuth/session.
`,
          },
        ],
      };
    }
  );

  return server;
}

export default {
  fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext
  ) {
    return createMcpHandler(createServer)(
      request,
      env,
      ctx
    );
  },
};
