import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const BASE = "https://www.dawateislami.net";

const QURAN = {
  search: `${BASE}/quran/search/results`,
  intro: `${BASE}/quran/intro/sirat-ul-jinan/saal`,
  home: `${BASE}/quran`,
};

const BOOKS = {
  search: `${BASE}/bookslibrary/ur/search`,
  home: `${BASE}/bookslibrary/ur`,
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
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/&#([0-9]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 10))
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
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function normalizeUrdu(text: string): string {
  return text
    .replace(/\u200c/g, "")
    .replace(/\u200d/g, "")
    .replace(/\u200e/g, "")
    .replace(/\u200f/g, "")
    .replace(/ي/g, "ی")
    .replace(/ى/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ہ")
    .replace(/ۀ/g, "ہ")
    .replace(/[ـ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function absoluteUrl(raw: string): string | null {
  try {
    const url = new URL(raw, BASE);

    if (
      url.hostname !== "www.dawateislami.net" &&
      url.hostname !== "dawateislami.net"
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function extractLinks(html: string): string[] {
  const links: string[] = [];

  const re =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;

  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const raw = m[1] || m[2] || m[3];

    if (!raw) continue;

    const url = absoluteUrl(raw);

    if (url) links.push(url);
  }

  return [...new Set(links)];
}

async function fetchSource(url: string): Promise<{
  url: string;
  html: string;
  text: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Dawat-e-Islami-MCP/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    const html = await response.text();

    return {
      url,
      html,
      text: htmlToText(html),
    };
  } finally {
    clearTimeout(timer);
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function findContext(
  text: string,
  query: string,
  before = 1200,
  after = 3500
): string {
  const normalizedText = normalizeUrdu(text);
  const normalizedQuery = normalizeUrdu(query);

  if (!normalizedQuery) return "";

  const index = normalizedText.indexOf(normalizedQuery);

  if (index < 0) {
    const words = normalizedQuery
      .split(/\s+/)
      .filter((x) => x.length > 2);

    for (const word of words) {
      const i = normalizedText.indexOf(word);

      if (i >= 0) {
        return text.slice(
          Math.max(0, i - before),
          Math.min(text.length, i + after)
        );
      }
    }

    return "";
  }

  return text.slice(
    Math.max(0, index - before),
    Math.min(text.length, index + normalizedQuery.length + after)
  );
}

function cleanSection(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sectionAfterLabel(
  text: string,
  labels: string[],
  stopLabels: string[],
  maxLength = 15000
): string | null {
  for (const label of labels) {
    const index = text.indexOf(label);

    if (index < 0) continue;

    let start = index + label.length;
    let end = Math.min(text.length, start + maxLength);

    for (const stop of stopLabels) {
      const stopIndex = text.indexOf(stop, start);

      if (stopIndex >= 0 && stopIndex < end) {
        end = stopIndex;
      }
    }

    const value = cleanSection(text.slice(start, end));

    if (value) return value;
  }

  return null;
}

/* =========================================================
   QURAN
   ========================================================= */

function isAyahLink(url: string, ayah: number): boolean {
  try {
    const u = new URL(url);

    return (
      u.hostname.includes("dawateislami.net") &&
      /\/quran\/[^/]+\/ayat-\d+/i.test(u.pathname) &&
      new RegExp(`/ayat-${ayah}(?:/|$)`, "i").test(u.pathname)
    );
  } catch {
    return false;
  }
}

function quranAyahNumberFromUrl(url: string): number | null {
  const m = url.match(/\/ayat-(\d+)/i);
  return m ? Number(m[1]) : null;
}

function quranSurahFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);

    const quranIndex = parts.indexOf("quran");

    if (quranIndex >= 0 && parts[quranIndex + 1]) {
      return parts[quranIndex + 1];
    }

    return null;
  } catch {
    return null;
  }
}

function extractArabicAyah(text: string): string | null {
  const lines = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const arabicLines = lines.filter((line) => {
    const arabicChars = (line.match(/[\u0600-\u06ff]/g) || []).length;
    const latinChars = (line.match(/[A-Za-z]/g) || []).length;

    return arabicChars >= 10 && arabicChars > latinChars * 2;
  });

  for (const line of arabicLines) {
    if (
      /ترجمہ|کنزالایمان|کنزالعرفان|تفسیر|صراط الجنان|Kanz|Tafseer/i.test(
        line
      )
    ) {
      continue;
    }

    if (line.length >= 20 && line.length <= 2500) {
      return line;
    }
  }

  const match = text.match(
    /(?:\d+\s*:\s*\d+|\d+\.\d+)\s*([\u0600-\u06ff][\s\S]{20,1800}?)(?=\n(?:کنز|ترجمہ|تفسیر|صراط)|$)/i
  );

  return match ? cleanSection(match[1]) : null;
}

function extractKanzByLabel(
  text: string,
  kind: "iman" | "irfan"
): string | null {
  const labels =
    kind === "iman"
      ? [
          "ترجمۂ کنزالایمان",
          "ترجمہ کنزالایمان",
          "کنزالایمان",
          "Kanz ul Iman",
        ]
      : [
          "ترجمۂ کنزالعرفان",
          "ترجمہ کنزالعرفان",
          "کنزالعرفان",
          "Kanz ul Irfan",
        ];

  const otherLabels =
    kind === "iman"
      ? [
          "ترجمۂ کنزالعرفان",
          "ترجمہ کنزالعرفان",
          "کنزالعرفان",
          "Kanz ul Irfan",
          "تفسیر :",
          "تفسیر:",
          "صراط الجنان",
        ]
      : [
          "ترجمۂ کنزالایمان",
          "ترجمہ کنزالایمان",
          "کنزالایمان",
          "Kanz ul Iman",
          "تفسیر :",
          "تفسیر:",
          "صراط الجنان",
        ];

  return sectionAfterLabel(
    text,
    labels,
    [
      ...otherLabels,
      "Share",
      "Facebook",
      "WhatsApp",
      "Home",
      "Al Quran",
    ],
    5000
  );
}

function extractTafsir(text: string): string | null {
  const labels = [
    "تفسیر : ‎صراط الجنان",
    "تفسیر : صراط الجنان",
    "تفسیر: ‎صراط الجنان",
    "تفسیر: صراط الجنان",
    "تفسیر :صراط الجنان",
    "تفسیر:صراط الجنان",
    "صراط الجنان",
  ];

  const value = sectionAfterLabel(
    text,
    labels,
    [
      "Share",
      "Facebook",
      "WhatsApp",
      "اس بارے میں سوال کریں",
      "دیگر تفاسیر",
      "Related",
      "Home",
    ],
    15000
  );

  return value ? cleanSection(value) : null;
}

function detectTranslation(text: string): "Kanz-ul-Iman" | "Kanz-ul-Irfan" | null {
  const iman = extractKanzByLabel(text, "iman");
  const irfan = extractKanzByLabel(text, "irfan");

  if (iman && !irfan) return "Kanz-ul-Iman";
  if (irfan && !iman) return "Kanz-ul-Irfan";

  return null;
}

async function discoverQuranRelatedPages(
  ayahUrl: string
): Promise<string[]> {
  const page = await fetchSource(ayahUrl);

  const links = extractLinks(page.html);

  const relevant = links.filter((url) => {
    const lower = url.toLowerCase();

    return (
      lower.includes("/quran/") &&
      (lower.includes("translation") ||
        lower.includes("tafseer") ||
        lower.includes("tafsir") ||
        lower.includes("ayat-"))
    );
  });

  return unique([ayahUrl, ...relevant]);
}

async function findExactAyahPage(
  surah: string,
  ayah: number
): Promise<string | null> {
  const queries = unique([
    `${surah}:${ayah}`,
    `${surah} ${ayah}`,
    `ayat-${ayah}`,
  ]);

  for (const query of queries) {
    const url = `${QURAN.search}?q=${encodeURIComponent(query)}`;

    try {
      const page = await fetchSource(url);

      const links = extractLinks(page.html).filter((x) =>
        isAyahLink(x, ayah)
      );

      for (const link of links) {
        const linkSurah = quranSurahFromUrl(link);

        if (!linkSurah) return link;

        const normalizedRequested = normalizeUrdu(surah);
        const normalizedFound = normalizeUrdu(linkSurah);

        if (
          normalizedFound === normalizedRequested ||
          normalizedFound.includes(normalizedRequested) ||
          normalizedRequested.includes(normalizedFound)
        ) {
          return link;
        }
      }
    } catch {
      // try next query
    }
  }

  return null;
}

async function buildQuranAyah(
  ayahUrl: string,
  requestedSurah: string,
  requestedAyah: number
) {
  const pages = await discoverQuranRelatedPages(ayahUrl);

  const fetched: Array<{
    url: string;
    text: string;
    html: string;
  }> = [];

  for (const url of pages.slice(0, 12)) {
    try {
      fetched.push(await fetchSource(url));
    } catch {
      // ignore unavailable related page
    }
  }

  const allText = fetched.map((x) => x.text).join("\n\n");

  let arabic: string | null = null;
  let kanzIman: string | null = null;
  let kanzIrfan: string | null = null;
  let tafsir: string | null = null;

  for (const page of fetched) {
    if (!arabic) arabic = extractArabicAyah(page.text);

    if (!kanzIman) {
      kanzIman = extractKanzByLabel(page.text, "iman");
    }

    if (!kanzIrfan) {
      kanzIrfan = extractKanzByLabel(page.text, "irfan");
    }

    if (!tafsir) {
      tafsir = extractTafsir(page.text);
    }
  }

  if (!arabic) arabic = extractArabicAyah(allText);
  if (!kanzIman) kanzIman = extractKanzByLabel(allText, "iman");
  if (!kanzIrfan) kanzIrfan = extractKanzByLabel(allText, "irfan");
  if (!tafsir) tafsir = extractTafsir(allText);

  return {
    source: SOURCES.quran,
    surah: requestedSurah,
    ayah: requestedAyah,

    arabic_text: arabic,

    translations: {
      kanz_ul_iman: kanzIman,
      kanz_ul_irfan: kanzIrfan,
    },

    tafsir: {
      name: tafsir ? "صراط الجنان" : null,
      text: tafsir,
    },

    availability: {
      arabic_text: Boolean(arabic),
      kanz_ul_iman: Boolean(kanzIman),
      kanz_ul_irfan: Boolean(kanzIrfan),
      sirat_ul_jinan: Boolean(tafsir),
    },

    official_urls: unique([
      ayahUrl,
      ...fetched.map((x) => x.url),
    ]),

    integrity: {
      source_only: true,
      invented_text: false,
      unavailable_fields_are_null: true,
    },
  };
}

/* =========================================================
   QURAN SEARCH
   ========================================================= */

async function searchQuran(
  query: string,
  limit = 10
) {
  const url = `${QURAN.search}?q=${encodeURIComponent(query)}`;
  const page = await fetchSource(url);

  const links = unique(
    extractLinks(page.html).filter((x) =>
      /\/quran\/[^/]+\/ayat-\d+/i.test(x)
    )
  );

  const results = links.slice(0, limit).map((link) => ({
    url: link,
    ayah: quranAyahNumberFromUrl(link),
    surah_slug: quranSurahFromUrl(link),
    context: findContext(page.text, query, 600, 1200),
  }));

  return {
    source: SOURCES.quran,
    query,
    results,
    search_url: url,
    official_source: QURAN.home,
  };
}

/* =========================================================
   BOOK LIBRARY
   ========================================================= */

function isBookPage(url: string): boolean {
  try {
    const u = new URL(url);

    if (!u.hostname.includes("dawateislami.net")) return false;

    const path = u.pathname;

    if (!path.startsWith("/bookslibrary/ur/")) return false;
    if (path.includes("/search")) return false;

    return true;
  } catch {
    return false;
  }
}

function isBookSearchPage(url: string): boolean {
  try {
    return new URL(url).pathname === "/bookslibrary/ur/search";
  } catch {
    return false;
  }
}

function extractBookTitle(text: string): string | null {
  const patterns = [
    /(?:Al Madina Library|المدینۃ لائبریری)\s*\n+([^\n]{2,180})/i,
    /Home\s*\n+Al Madina Library\s*\n+([^\n]{2,180})/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);

    if (m?.[1]) return m[1].trim();
  }

  const lines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const index = lines.findIndex((x) =>
    /Al Madina Library|المدینۃ لائبریری/i.test(x)
  );

  if (index >= 0 && lines[index + 1]) {
    return lines[index + 1];
  }

  return null;
}

function extractField(
  text: string,
  labels: string[]
): string | null {
  const lines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    for (const label of labels) {
      if (lines[i].toLowerCase().includes(label.toLowerCase())) {
        const sameLine = lines[i]
          .replace(new RegExp(label, "i"), "")
          .replace(/^[:：\-\s]+/, "")
          .trim();

        if (sameLine) return sameLine;

        if (lines[i + 1]) return lines[i + 1];
      }
    }
  }

  return null;
}

function scoreBook(title: string, query: string): number {
  const t = normalizeUrdu(title);
  const q = normalizeUrdu(query);

  if (!q) return 0;

  if (t === q) return 100;
  if (t.includes(q)) return 90;

  const words = q
    .split(/\s+/)
    .filter((x) => x.length > 1);

  let matches = 0;

  for (const word of words) {
    if (t.includes(word)) matches++;
  }

  return words.length ? Math.round((matches / words.length) * 80) : 0;
}

async function discoverBookInternalPages(
  bookUrl: string
): Promise<string[]> {
  const page = await fetchSource(bookUrl);

  const links = extractLinks(page.html).filter(isBookPage);

  const sameBook = (() => {
    try {
      const base = new URL(bookUrl);
      const baseParts = base.pathname
        .split("/")
        .filter(Boolean);

      const bookIndex = baseParts.indexOf("ur");

      if (bookIndex < 0 || !baseParts[bookIndex + 1]) {
        return links;
      }

      const slug = baseParts[bookIndex + 1];

      return links.filter((link) => {
        try {
          return new URL(link).pathname
            .split("/")
            .filter(Boolean)
            .includes(slug);
        } catch {
          return false;
        }
      });
    } catch {
      return links;
    }
  })();

  return unique([bookUrl, ...sameBook]);
}

async function searchInsideBook(
  bookUrl: string,
  query: string,
  maxPages = 30
) {
  const pages = await discoverBookInternalPages(bookUrl);

  const matches: Array<{
    url: string;
    title: string | null;
    matched_context: string;
  }> = [];

  for (const url of pages.slice(0, maxPages)) {
    try {
      const page = await fetchSource(url);

      const normalized = normalizeUrdu(page.text);
      const q = normalizeUrdu(query);

      if (!normalized.includes(q)) continue;

      matches.push({
        url,
        title: extractBookPageTitle(page.text),
        matched_context: findContext(
          page.text,
          query,
          1200,
          4500
        ),
      });
    } catch {
      // ignore individual page failures
    }
  }

  return matches;
}

function extractBookPageTitle(text: string): string | null {
  const lines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const ignored = new Set([
    "Home",
    "Al Madina Library",
    "Dawat-e-Islami",
    "Share",
  ]);

  for (const line of lines) {
    if (ignored.has(line)) continue;

    if (
      line.length >= 3 &&
      line.length <= 180 &&
      !/مصنف:|پبلشر:|تاریخ اشاعت|آن لائن پڑھیں|پی ڈی ایف/i.test(
        line
      )
    ) {
      return line;
    }
  }

  return null;
}

async function searchBooks(
  query: string,
  pageNumber = 1,
  insideBookUrl?: string
) {
  if (insideBookUrl) {
    if (!isBookPage(insideBookUrl)) {
      throw new Error(
        "insideBookUrl must be an official Dawat-e-Islami Al Madina Library URL."
      );
    }

    const results = await searchInsideBook(
      insideBookUrl,
      query
    );

    return {
      source: SOURCES.books,
      query,
      mode: "inside_book",
      book_url: insideBookUrl,
      results,
      official_url: insideBookUrl,
      integrity: {
        source_only: true,
        invented_text: false,
      },
    };
  }

  const searchUrl =
    `${BOOKS.search}?stext=${encodeURIComponent(query)}` +
    `&pn=${pageNumber}&filterLang=ur`;

  const page = await fetchSource(searchUrl);

  const bookLinks = unique(
    extractLinks(page.html).filter(isBookPage)
  );

  const results: Array<{
    title: string | null;
    author: string | null;
    publisher: string | null;
    publication_date: string | null;
    category: string | null;
    online_pages: string | null;
    url: string;
    relevance_score: number;
    matched_context: string;
  }> = [];

  for (const url of bookLinks.slice(0, 30)) {
    try {
      const book = await fetchSource(url);

      const title = extractBookTitle(book.text);

      results.push({
        title,
        author: extractField(book.text, [
          "مصنف:",
          "مصنف",
          "Author:",
          "Author",
        ]),
        publisher: extractField(book.text, [
          "پبلشر:",
          "پبلشر",
          "Publisher:",
          "Publisher",
        ]),
        publication_date: extractField(book.text, [
          "تاریخ اشاعت:",
          "تاریخ اشاعت",
          "Publication Date:",
          "Publication date:",
        ]),
        category: extractField(book.text, [
          "کیٹیگری:",
          "کیٹیگری",
          "Category:",
          "Category",
        ]),
        online_pages: extractField(book.text, [
          "آن لائن پڑھیں صفحات:",
          "آن لائن پڑھیں صفحات",
          "Online pages:",
          "Online Pages:",
        ]),
        url,
        relevance_score: scoreBook(title || "", query),
        matched_context: findContext(
          book.text,
          query,
          700,
          1800
        ),
      });
    } catch {
      // ignore failed book
    }
  }

  results.sort(
    (a, b) => b.relevance_score - a.relevance_score
  );

  return {
    source: SOURCES.books,
    query,
    mode: "book_search",
    page: pageNumber,
    search_url: searchUrl,
    results,
    official_url: BOOKS.home,
    integrity: {
      source_only: true,
      invented_text: false,
    },
  };
}

/* =========================================================
   ISLAMIC PORTAL
   ========================================================= */

async function searchIslamicPortal(query: string) {
  const url =
    `${BASE}/islamicportal?search=${encodeURIComponent(query)}`;

  const page = await fetchSource(url);

  const links = unique(
    extractLinks(page.html).filter((x) =>
      x.includes("/islamicportal")
    )
  );

  return {
    source: SOURCES.portal,
    query,
    search_url: url,
    text: findContext(page.text, query, 1500, 6000),
    links: links.slice(0, 30),
    official_url: `${BASE}/islamicportal`,
  };
}

/* =========================================================
   COMBINED RESEARCH
   ========================================================= */

async function researchDawatSources(query: string) {
  const [books, quran, portal] = await Promise.all([
    searchBooks(query, 1),
    searchQuran(query, 10).catch(() => ({
      source: SOURCES.quran,
      query,
      results: [],
      search_url: `${QURAN.search}?q=${encodeURIComponent(query)}`,
      official_source: QURAN.home,
    })),
    searchIslamicPortal(query).catch(() => ({
      source: SOURCES.portal,
      query,
      search_url:
        `${BASE}/islamicportal?search=${encodeURIComponent(query)}`,
      text: "",
      links: [],
      official_url: `${BASE}/islamicportal`,
    })),
  ]);

  return {
    query,
    sources: {
      quran,
      books,
      islamic_portal: portal,
    },
    source_policy: {
      official_only: true,
      do_not_invent_source_text: true,
      unavailable_source_text_must_be_null: true,
    },
  };
}

/* =========================================================
   MCP SERVER
   ========================================================= */

const server = new McpServer({
  name: "dawat-e-islami-mcp",
  version: "2.0.0",
});

server.tool(
  "quran_search",
  "Dawat-e-Islami Quran search. Finds official Quran ayah pages and returns official URLs and search context.",
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ query, limit }) => {
    const result = await searchQuran(
      query,
      limit || 10
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "quran_ayah",
  "Retrieve an exact Quran ayah from Dawat-e-Islami with Arabic text, Kanz-ul-Iman, Kanz-ul-Irfan, Sirat-ul-Jinan tafsir and official source URLs when available.",
  {
    surah: z.string().min(1),
    ayah: z.number().int().min(1),
  },
  async ({ surah, ayah }) => {
    const url = await findExactAyahPage(
      surah,
      ayah
    );

    if (!url) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source: SOURCES.quran,
                surah,
                ayah,
                available: false,
                message:
                  "Official Dawat-e-Islami ayah page was not found. No text was invented.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const result = await buildQuranAyah(
      url,
      surah,
      ayah
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "quran_research",
  "Search and research Dawat-e-Islami Quran sources. Can retrieve exact official ayah material when an exact ayah is identified.",
  {
    query: z.string().min(1),
    surah: z.string().optional(),
    ayah: z.number().int().min(1).optional(),
  },
  async ({ query, surah, ayah }) => {
    if (surah && ayah) {
      const url = await findExactAyahPage(
        surah,
        ayah
      );

      if (!url) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  source: SOURCES.quran,
                  available: false,
                  surah,
                  ayah,
                  query,
                  message:
                    "Exact official ayah page not found. No text invented.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await buildQuranAyah(
        url,
        surah,
        ayah
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const result = await searchQuran(
      query,
      10
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "quran_source_info",
  "Returns official Dawat-e-Islami information about the Quran, Kanz-ul-Iman, Kanz-ul-Irfan and Sirat-ul-Jinan.",
  {},
  async () => {
    const page = await fetchSource(QURAN.intro);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: SOURCES.quran,
              official_url: QURAN.intro,
              text: page.text,
              integrity: {
                source_only: true,
                invented_text: false,
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

server.tool(
  "search_dawat_books",
  "Search the official Dawat-e-Islami Al Madina Books Library. Returns book title, author, publisher, publication date, category, online pages and original official URL. If insideBookUrl is supplied, searches inside that specific book and returns matching internal pages and source text context.",
  {
    query: z.string().min(1),
    page: z.number().int().min(1).optional(),
    insideBookUrl: z.string().url().optional(),
  },
  async ({ query, page, insideBookUrl }) => {
    const result = await searchBooks(
      query,
      page || 1,
      insideBookUrl
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "book_open",
  "Open an official Dawat-e-Islami Al Madina Library book or internal book page and return its source text and URL.",
  {
    url: z.string().url(),
  },
  async ({ url }) => {
    if (!isBookPage(url)) {
      throw new Error(
        "Only official Dawat-e-Islami Al Madina Books Library URLs are allowed."
      );
    }

    const page = await fetchSource(url);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: SOURCES.books,
              url,
              title: extractBookPageTitle(page.text),
              text: page.text,
              integrity: {
                source_only: true,
                invented_text: false,
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

server.tool(
  "book_search_inside",
  "Search for a topic, phrase or text inside an official Dawat-e-Islami book. Returns the matching internal book page, context and original URL.",
  {
    query: z.string().min(1),
    bookUrl: z.string().url(),
    maxPages: z.number().int().min(1).max(100).optional(),
  },
  async ({ query, bookUrl, maxPages }) => {
    if (!isBookPage(bookUrl)) {
      throw new Error(
        "bookUrl must be an official Dawat-e-Islami Al Madina Library URL."
      );
    }

    const results = await searchInsideBook(
      bookUrl,
      query,
      maxPages || 30
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: SOURCES.books,
              query,
              book_url: bookUrl,
              results,
              integrity: {
                source_only: true,
                invented_text: false,
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

server.tool(
  "search_islamic_portal",
  "Search the official Dawat-e-Islami Islamic Portal.",
  {
    query: z.string().min(1),
  },
  async ({ query }) => {
    const result = await searchIslamicPortal(
      query
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "research_dawat_sources",
  "Search Dawat-e-Islami Quran, Al Madina Books Library and Islamic Portal together.",
  {
    query: z.string().min(1),
  },
  async ({ query }) => {
    const result = await researchDawatSources(
      query
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_research_source_policy",
  "Returns the source-integrity policy and official Dawat-e-Islami sources used by this MCP.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              official_sources: [
                "Dawat-e-Islami Quran",
                "Kanz-ul-Iman",
                "Kanz-ul-Irfan",
                "Sirat-ul-Jinan",
                "Al Madina Books Library",
                "Dawat-e-Islami Islamic Portal",
              ],

              official_domains: [
                "https://www.dawateislami.net",
              ],

              rules: [
                "Use official Dawat-e-Islami source pages.",
                "Do not invent Quran text.",
                "Do not invent translation text.",
                "Do not invent tafsir text.",
                "Do not invent book text.",
                "Return null/unavailable when exact source text cannot be retrieved.",
                "Return the original official URL whenever available.",
                "For books, search the book itself and its internal pages when possible.",
                "For Quran, distinguish Kanz-ul-Iman from Kanz-ul-Irfan.",
                "Sirat-ul-Jinan must be returned as tafsir only when official source text is actually found.",
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

const handler = createMcpHandler(
  server
);

export default {
  fetch: handler,
};
