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
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
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
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUrdu(text: string): string {
  return text
    .replace(/[ًٌٍَُِّْـٰٓ]/g, "")
    .replace(/ي/g, "ی")
    .replace(/ى/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "ہ")
    .replace(/ة/g, "ہ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function absoluteUrl(raw: string): string | null {
  try {
    const url = new URL(raw, BASE);

    if (url.hostname !== "www.dawateislami.net") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
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

    const url = absoluteUrl(raw);

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    output.push(url);

    if (output.length >= 300) {
      break;
    }
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
        "User-Agent": "Dawat-e-Islami-Research-MCP/4.0",
      },
    });

    const html = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
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

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function findContext(
  text: string,
  query: string,
  before = 2500,
  after = 6000
): string {
  const normalizedText = normalizeUrdu(text);
  const normalizedQuery = normalizeUrdu(query);

  const index = normalizedText.indexOf(normalizedQuery);

  if (index < 0) {
    return text.slice(0, before + after);
  }

  const start = Math.max(0, index - before);
  const end = Math.min(text.length, index + after);

  return text.slice(start, end);
}

function extractBetweenLabels(
  text: string,
  startLabels: string[],
  endLabels: string[],
  max = 10000
): string | null {
  const startPositions: number[] = [];

  for (const label of startLabels) {
    const index = text.indexOf(label);

    if (index >= 0) {
      startPositions.push(index);
    }
  }

  if (!startPositions.length) {
    return null;
  }

  const start = Math.min(...startPositions);

  let end = Math.min(text.length, start + max);

  for (const label of endLabels) {
    const index = text.indexOf(label, start + 1);

    if (index >= 0 && index < end) {
      end = index;
    }
  }

  return text.slice(start, end).trim();
}

/* =========================================================
   QURAN
========================================================= */

function isAyahLink(url: string, surah: number, ayah: number): boolean {
  return new RegExp(`/quran/.+/ayat-${ayah}(?:/|$)`, "i").test(
    url
  );
}

async function findExactAyahPage(
  surah: number,
  ayah: number
): Promise<string | null> {
  const queries = [
    `${surah}:${ayah}`,
    `${surah} ${ayah}`,
    `ayat-${ayah}`,
  ];

  for (const query of queries) {
    const url =
      `${QURAN.search}?q=${encodeURIComponent(query)}`;

    const result = await fetchSource(url);

    const candidate = result.links.find((link) =>
      isAyahLink(link, surah, ayah)
    );

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function extractArabicAyah(text: string): string | null {
  const reference = text.match(
    /(?:\d+)\.(\d+)\s+([\u0600-\u06FF][\s\S]{10,1800}?)(?:\(\d+\)|Kanz ul Iman|Kanz ul Irfan|تفسیر)/i
  );

  if (reference?.[2]) {
    return reference[2]
      .replace(/\s+/g, " ")
      .trim();
  }

  return null;
}

function extractTranslation(text: string): string | null {
  const labels = [
    "کنزالایمان",
    "کنزالعرفان",
    "ترجمۂ کنزالایمان",
    "ترجمۂ کنزالعرفان",
    "ترجمہ کنزالایمان",
    "ترجمہ کنزالعرفان",
  ];

  for (const label of labels) {
    const index = text.indexOf(label);

    if (index >= 0) {
      const after = text
        .slice(index + label.length)
        .trim();

      const next = after.search(
        /تفسیر\s*:\s*صراط الجنان|Kanz ul Iman|Kanz ul Irfan|Share/i
      );

      const value =
        next >= 0
          ? after.slice(0, next)
          : after.slice(0, 2500);

      if (value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
}

function extractTafsir(text: string): string | null {
  const labels = [
    "تفسیر : ‎صراط الجنان",
    "تفسیر : صراط الجنان",
    "تفسیر: ‎صراط الجنان",
    "تفسیر: صراط الجنان",
    "صراط الجنان",
  ];

  for (const label of labels) {
    const index = text.indexOf(label);

    if (index >= 0) {
      return text
        .slice(index + label.length)
        .trim()
        .slice(0, 15000);
    }
  }

  return null;
}

function extractReferenceLines(text: string): string[] {
  const lines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  return lines.filter((line) =>
    /(?:الحدیث|حدیث|تفسیر|فتاوی|جلد|صفحہ|ص\.|کتاب|باب|البقرۃ|آل عمران|الانفال|النحل|ہود)/i.test(
      line
    )
  ).slice(0, 100);
}

function detectTranslationName(text: string): string | null {
  if (/کنزالایمان/.test(text)) {
    return "Kanz-ul-Iman";
  }

  if (/کنزالعرفان/.test(text)) {
    return "Kanz-ul-Irfan";
  }

  return null;
}

async function fetchQuranAyahPages(
  ayahPage: string
) {
  const base = ayahPage.replace(/\/+$/, "");

  const pages = [
    `${base}/translation-1/tafseer`,
    `${base}/translation-2/tafseer`,
    `${base}/translation-1`,
    `${base}/translation-2`,
  ];

  const results = await Promise.all(
    unique(pages).map((url) => fetchSource(url))
  );

  return results.filter((x) => x.ok);
}

function buildQuranOutput(
  query: string,
  requestedMode: string,
  basePage: Awaited<ReturnType<typeof fetchSource>> | null,
  translationPages: Awaited<ReturnType<typeof fetchSource>>[]
) {
  const allText = [
    basePage?.text || "",
    ...translationPages.map((x) => x.text),
  ].join("\n\n");

  const arabic =
    (basePage && extractArabicAyah(basePage.text)) ||
    extractArabicAyah(allText);

  const translationResults = translationPages.map((page) => ({
    url: page.url,
    translation_name: detectTranslationName(page.text),
    text: extractTranslation(page.text),
    has_tafsir: Boolean(extractTafsir(page.text)),
  }));

  const kanzulIman =
    translationResults.find(
      (x) => x.translation_name === "Kanz-ul-Iman"
    )?.text || null;

  const kanzulIrfan =
    translationResults.find(
      (x) => x.translation_name === "Kanz-ul-Irfan"
    )?.text || null;

  const tafsir =
    translationPages
      .map((x) => extractTafsir(x.text))
      .find(Boolean) || null;

  const references = unique(
    translationPages.flatMap((x) =>
      extractReferenceLines(x.text)
    )
  );

  const links = unique([
    ...(basePage?.links || []),
    ...translationPages.flatMap((x) => x.links),
  ]);

  const output: Record<string, unknown> = {
    query,
    requested_mode: requestedMode,
    source: SOURCES.quran,
    source_url: basePage?.url || null,

    available: {
      arabic: Boolean(arabic),
      kanzul_iman: Boolean(kanzulIman),
      kanzul_irfan: Boolean(kanzulIrfan),
      sirat_ul_jinan: Boolean(tafsir),
      references: references.length > 0,
    },

    official_pages: translationPages.map((x) => x.url),

    data: {},
  };

  const data = output.data as Record<string, unknown>;

  if (
    requestedMode === "all" ||
    requestedMode === "quran_only" ||
    requestedMode === "arabic"
  ) {
    data.arabic = arabic;
  }

  if (
    requestedMode === "all" ||
    requestedMode === "kanzul_iman"
  ) {
    data.kanzul_iman = kanzulIman;
  }

  if (
    requestedMode === "all" ||
    requestedMode === "kanzul_irfan"
  ) {
    data.kanzul_irfan = kanzulIrfan;
  }

  if (
    requestedMode === "all" ||
    requestedMode === "tafsir"
  ) {
    data.sirat_ul_jinan = tafsir;
  }

  if (
    requestedMode === "all" ||
    requestedMode === "references"
  ) {
    data.references = references;
  }

  if (requestedMode === "summary") {
    data.summary_instruction =
      "Generate a concise summary only from the returned official source material.";
    data.source_material = allText.slice(0, 12000);
  }

  output.rules = [
    "Only official Dawat-e-Islami source material is used.",
    "Never reconstruct missing Quran text from memory.",
    "Never fabricate translation or tafsir.",
    "Never invent bibliographic references.",
    "If a requested item is unavailable, return null and mark it unavailable.",
    "Preserve official URLs.",
    "Separate source material from generated explanation.",
  ];

  output.source_links = links.slice(0, 100);

  return output;
}

/* =========================================================
   BOOK LIBRARY
========================================================= */

function isBookPage(url: string): boolean {
  try {
    const path = new URL(url).pathname;

    return (
      /^\/bookslibrary\/ur\/[^/]+(?:\/page-\d+)?$/i.test(path) &&
      !path.includes("/search")
    );
  } catch {
    return false;
  }
}

function getBookSlug(url: string): string {
  try {
    const parts = new URL(url).pathname
      .split("/")
      .filter(Boolean);

    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function extractBookTitle(text: string): string | null {
  const patterns = [
    /(?:^|\n)#?\s*([^\n]{2,120})\s*\n\s*شیئر کیجئے/,
    /(?:^|\n)([^\n]{2,120})\s*\n\s*(?:مصنف|مصنف:)/,
    /(?:^|\n)([^\n]{2,120})\s*\n\s*(?:Image|آن لائن پڑھیں)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractField(
  text: string,
  labels: string[]
): string | null {
  for (const label of labels) {
    const regex = new RegExp(
      `${label}\\s*:?\\s*([^\\n]{1,300})`,
      "i"
    );

    const match = text.match(regex);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function scoreBook(
  query: string,
  url: string,
  text: string
): number {
  const q = normalizeUrdu(query);
  const haystack = normalizeUrdu(
    `${url}\n${text.slice(0, 12000)}`
  );

  let score = 0;

  if (haystack.includes(q)) {
    score += 50;
  }

  const words = q
    .split(/\s+/)
    .filter((x) => x.length >= 2);

  for (const word of words) {
    if (haystack.includes(word)) {
      score += 10;
    }
  }

  if (url.includes("/bookslibrary/ur/")) {
    score += 5;
  }

  return score;
}

async function searchBooks(
  query: string,
  page: number
) {
  const variants = unique([
    query,
    query.replace(/ے/g, "ی"),
    query.replace(/ي/g, "ی"),
    "صبر",
    "صابرین",
    "صبر و استقامت",
  ]).slice(0, 6);

  const searchResults: Awaited<
    ReturnType<typeof fetchSource>
  >[] = [];

  for (const variant of variants) {
    const url =
      `${BASE}/bookslibrary/ur/search` +
      `?stext=${encodeURIComponent(variant)}` +
      `&pn=${page}` +
      `&filterLang=ur`;

    const result = await fetchSource(url);

    if (result.ok) {
      searchResults.push(result);
    }
  }

  const candidateLinks = unique(
    searchResults
      .flatMap((x) => x.links)
      .filter(isBookPage)
  );

  const candidates = candidateLinks.slice(0, 30);

  const pages = await Promise.all(
    candidates.map((url) => fetchSource(url))
  );

  const books = pages
    .filter((x) => x.ok)
    .map((pageResult) => {
      const title = extractBookTitle(pageResult.text);

      const author = extractField(
        pageResult.text,
        ["مصنف", "مصنف:"]
      );

      const publisher = extractField(
        pageResult.text,
        ["پبلشر", "ناشر", "پبلشر:"]
      );

      const publicationDate = extractField(
        pageResult.text,
        ["تاریخ اشاعت", "تاریخ اشاعت:"]
      );

      const onlinePages = extractField(
        pageResult.text,
        ["آن لائن پڑھیں صفحات", "آن لائن پڑھیں صفحات:"]
      );

      const category = extractField(
        pageResult.text,
        ["کیٹیگری", "کیٹیگری:"]
      );

      return {
        title,
        author,
        publisher,
        publication_date: publicationDate,
        online_pages: onlinePages,
        category,
        url: pageResult.url,
        relevance_score: scoreBook(
          query,
          pageResult.url,
          pageResult.text
        ),
        matched_context: findContext(
          pageResult.text,
          query,
          1000,
          2500
        ),
      };
    })
    .sort(
      (a, b) =>
        b.relevance_score - a.relevance_score
    );

  return {
    query,
    page,
    source: SOURCES.books,
    search_pages: searchResults.map((x) => x.url),
    result_count: books.length,
    results: books.slice(0, 15),
    search_note:
      books.length
        ? "Book pages were discovered and individually fetched from the official Al Madina Books Library."
        : "No book page was discovered from the current official search results. This does NOT prove that the library has no relevant books.",
  };
}

/* =========================================================
   SERVER
========================================================= */

function createServer() {
  const server = new McpServer({
    name: "Dawat-e-Islami Research MCP",
    version: "4.0.0",
  });

  /* -------------------------------------------------------
     1. QURAN RESEARCH
  ------------------------------------------------------- */

  server.registerTool(
    "quran_research",
    {
      description:
        "Research official Dawat-e-Islami Quran content. " +
        "Uses exact Quran ayah pages when discoverable and preserves " +
        "Arabic, Kanz-ul-Iman, Kanz-ul-Irfan, Sirat-ul-Jinan and references. " +
        "Never fabricates missing material.",

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
      const searchUrl =
        `${QURAN.search}?q=${encodeURIComponent(query)}`;

      const searchResult =
        await fetchSource(searchUrl);

      const ayahLinks =
        searchResult.links.filter((link) =>
          /\/quran\/.+\/ayat-\d+/i.test(link)
        );

      let primaryPage: Awaited<
        ReturnType<typeof fetchSource>
      > | null = null;

      if (ayahLinks.length) {
        primaryPage =
          await fetchSource(ayahLinks[0]);
      } else {
        primaryPage = searchResult;
      }

      let translationPages: Awaited<
        ReturnType<typeof fetchSource>
      >[] = [];

      if (
        primaryPage?.url &&
        /\/quran\/.+\/ayat-\d+/i.test(primaryPage.url)
      ) {
        translationPages =
          await fetchQuranAyahPages(primaryPage.url);
      }

      const output = buildQuranOutput(
        query,
        mode,
        primaryPage,
        translationPages
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                search_url: searchUrl,
                ...output,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* -------------------------------------------------------
     2. EXACT QURAN AYAH
  ------------------------------------------------------- */

  server.registerTool(
    "quran_ayah",
    {
      description:
        "Look up an exact Quran surah and ayah using official " +
        "Dawat-e-Islami Quran pages. Attempts exact ayah page discovery " +
        "before extracting Arabic, translations, Sirat-ul-Jinan and references.",

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
      const exactPage =
        await findExactAyahPage(surah, ayah);

      if (!exactPage) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  surah,
                  ayah,
                  reference: `${surah}:${ayah}`,
                  available: false,
                  message:
                    "Exact official ayah page could not be discovered from the current Quran search. No Quran text was fabricated.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const primary =
        await fetchSource(exactPage);

      const translationPages =
        await fetchQuranAyahPages(exactPage);

      const output = buildQuranOutput(
        `${surah}:${ayah}`,
        mode,
        primary,
        translationPages
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
                exact_ayah_page: exactPage,
                ...output,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* -------------------------------------------------------
     3. QURAN SEARCH
  ------------------------------------------------------- */

  server.registerTool(
    "search_quran",
    {
      description:
        "Search the official Dawat-e-Islami Quran portal for a Quranic " +
        "word, phrase, topic, surah or ayah and return official results and links.",

      inputSchema: {
        query: z.string().min(1).max(300),
      },
    },

    async ({ query }) => {
      const url =
        `${QURAN.search}?q=${encodeURIComponent(query)}`;

      const result = await fetchSource(url);

      const ayahLinks =
        result.links.filter((link) =>
          /\/quran\/.+\/ayat-\d+/i.test(link)
        );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: SOURCES.quran,
                query,
                url,
                http_status: result.status,
                official_source_text:
                  result.text,
                ayah_result_links:
                  ayahLinks.slice(0, 50),
                official_links:
                  result.links.slice(0, 100),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* -------------------------------------------------------
     4. QURAN SOURCE INFO
  ------------------------------------------------------- */

  server.registerTool(
    "quran_source_info",
    {
      description:
        "Return official Dawat-e-Islami Quran and Sirat-ul-Jinan information.",
      inputSchema: {},
    },

    async () => {
      const result =
        await fetchSource(QURAN.intro);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: SOURCES.quran,
                url: QURAN.intro,
                status: result.status,
                text: result.text,
                links: result.links.slice(0, 100),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* -------------------------------------------------------
     5. IMPROVED BOOK SEARCH
  ------------------------------------------------------- */

  server.registerTool(
    "search_dawat_books",
    {
      description:
        "Search the official Dawat-e-Islami Al Madina Books Library. " +
        "Discovers actual book pages, fetches their metadata and ranks " +
        "relevant results. A zero result never means the library is empty.",

      inputSchema: {
        query: z.string().min(1).max(300),
        page: z.number().int().min(1).max(50).default(1),
      },
    },

    async ({ query, page }) => {
      const output =
        await searchBooks(query, page);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              output,
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* -------------------------------------------------------
     6. ISLAMIC PORTAL
  ------------------------------------------------------- */

  server.registerTool(
    "search_islamic_portal",
    {
      description:
        "Search the official Dawat-e-Islami Islamic Portal only. " +
        "Do not substitute News or Faizan-e-Madina.",

      inputSchema: {
        query: z.string().min(1).max(300),
      },
    },

    async ({ query }) => {
      const url =
        `${BASE}/islamicportal?search=${encodeURIComponent(query)}`;

      const result =
        await fetchSource(url);

      const portalLinks =
        result.links.filter((x) =>
          x.includes("/islamicportal")
        );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: SOURCES.portal,
                query,
                url,
                status: result.status,
                text: result.text,
                official_portal_links:
                  portalLinks.slice(0, 100),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /* -------------------------------------------------------
     7. ALL DAWAT SOURCES
  ------------------------------------------------------- */

  server.registerTool(
    "research_dawat_sources",
    {
      description:
        "Run one research question across official Dawat Books, Quran and Islamic Portal.",
      inputSchema: {
        query: z.string().min(1).max(300),
      },
    },

    async ({ query }) => {
      const [
        books,
        quran,
        portal,
      ] = await Promise.all([
        searchBooks(query, 1),

        fetchSource(
          `${QURAN.search}?q=${encodeURIComponent(query)}`
        ),

        fetchSource(
          `${BASE}/islamicportal?search=${encodeURIComponent(query)}`
        ),
      ]);

      const quranLinks =
        quran.links.filter((x) =>
          /\/quran\/.+\/ayat-\d+/i.test(x)
        );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,

                books,

                quran: {
                  source: SOURCES.quran,
                  url: quran.url,
                  status: quran.status,
                  text: quran.text,
                  ayah_links:
                    quranLinks.slice(0, 50),
                  links:
                    quran.links.slice(0, 100),
                },

                islamic_portal: {
                  source: SOURCES.portal,
                  url: portal.url,
                  status: portal.status,
                  text: portal.text,
                  links:
                    portal.links
                      .filter((x) =>
                        x.includes("/islamicportal")
                      )
                      .slice(0, 100),
                },

                rules: [
                  "Official Dawat sources only.",
                  "Never fabricate missing text.",
                  "Never treat zero search results as proof that a source has no relevant material.",
                  "Preserve official URLs.",
                  "Keep Books, Quran and Islamic Portal results separated.",
                  "Do not substitute News or Faizan-e-Madina for Islamic Portal.",
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

  /* -------------------------------------------------------
     8. POLICY
  ------------------------------------------------------- */

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

OFFICIAL SOURCES
1. Dawat-e-Islami Quran
2. Kanz-ul-Iman
3. Kanz-ul-Irfan
4. Sirat-ul-Jinan
5. Dawat-e-Islami Al Madina Books Library
6. Dawat-e-Islami Islamic Portal

QURAN
- Prefer exact official ayah pages.
- Preserve official Arabic.
- Preserve Kanz-ul-Iman when officially returned.
- Preserve Kanz-ul-Irfan when officially returned.
- Preserve Sirat-ul-Jinan when officially returned.
- Preserve available references.
- Never reconstruct missing Quran material.

BOOK LIBRARY
- Search the official Al Madina Books Library.
- Discover actual book pages.
- Fetch book metadata from the book page.
- Rank results by relevance.
- A zero result does NOT prove that the library contains no relevant book.
- Never invent title, author, publisher, date, pages or URL.

ISLAMIC PORTAL
- Islamic Portal only.
- Do not substitute News.
- Do not substitute Faizan-e-Madina.

CITATION
- Quran: (سورۃ، سورۃ نمبر:آیت نمبر)
- Preserve official URLs.
- Preserve volume/page only when actually supplied by the source.
- Never invent hadith numbers, page numbers, authors or publishers.

SOURCE INTEGRITY
- Source text and generated explanation must remain separate.
- Missing information must be marked unavailable.
- Never fabricate unavailable material.

EXTERNAL MCP
- Shamela remains a separate MCP connection.
- Turath remains a separate MCP connection.
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
