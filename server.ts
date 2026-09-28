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

const PORTAL = {
  home: `${BASE}/islamicportal`,
};

const SOURCES = {
  books: "Dawat-e-Islami Al Madina Books Library",
  quran: "Dawat-e-Islami Quran",
  portal: "Dawat-e-Islami Islamic Portal",
};

/* ---------------------------------------------------------
   General helpers
--------------------------------------------------------- */

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/section>/gi, "\n")
        .replace(/<\/article>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function stripHtml(text: string): string {
  return normalizeWhitespace(
    decodeHtml(
      text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function extractLinks(html: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  const regex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtml(match[1].trim());

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
        url.startsWith(BASE) &&
        !seen.has(url)
      ) {
        seen.add(url);
        output.push(url);
      }
    } catch {
      // Ignore invalid URLs.
    }

    if (output.length >= 300) break;
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
        "User-Agent":
          "Dawat-e-Islami-Research-MCP/4.0",
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
        error instanceof Error
          ? error.message
          : String(error)
      }`,
      links: [],
    };
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, BASE).toString();
  } catch {
    return url;
  }
}

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـٰۤۡ]/g, "")
    .replace(/[^\p{L}\p{N}\s:.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSearchVariants(query: string): string[] {
  const variants = [
    query,
    normalizeForSearch(query),
  ];

  const q = normalizeForSearch(query);

  const transliterations: Record<string, string[]> = {
    "صبر": ["sabr", "sabar"],
    "صبر کے فضائل": [
      "sabr ke fazail",
      "sabar kay fazail",
      "sabr kay fazail",
    ],
    "نماز": ["namaz", "salah"],
    "روزہ": ["roza", "rozah", "fasting"],
    "زکوٰۃ": ["zakat"],
    "توبہ": ["tauba", "tawbah"],
    "تقویٰ": ["taqwa"],
    "اخلاق": ["akhlaq"],
  };

  for (const [key, values] of Object.entries(
    transliterations
  )) {
    if (
      q === normalizeForSearch(key) ||
      q.includes(normalizeForSearch(key))
    ) {
      variants.push(...values);
    }
  }

  return unique(
    variants.filter(Boolean).map((x) => x.trim())
  );
}

/* ---------------------------------------------------------
   HTML metadata helpers
--------------------------------------------------------- */

function extractTitle(html: string): string | null {
  const h1 =
    html.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    )?.[1];

  if (h1) {
    const value = stripHtml(h1);
    if (value) return value;
  }

  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1];

  if (title) {
    const value = stripHtml(title);
    if (value) return value;
  }

  return null;
}

function extractMeta(
  html: string,
  names: string[]
): string | null {
  for (const name of names) {
    const regex1 = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );

    const regex2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i"
    );

    const match =
      html.match(regex1) ||
      html.match(regex2);

    if (match?.[1]) {
      return stripHtml(match[1]);
    }
  }

  return null;
}

function findContext(
  text: string,
  query: string,
  before = 1200,
  after = 3500
): string {
  const normalizedText =
    normalizeForSearch(text);

  const normalizedQuery =
    normalizeForSearch(query);

  const index =
    normalizedText.indexOf(normalizedQuery);

  if (index < 0) {
    return text.slice(0, before + after);
  }

  const start = Math.max(
    0,
    index - before
  );

  const end = Math.min(
    text.length,
    index + after
  );

  return text.slice(start, end).trim();
}

function extractLabeledSection(
  text: string,
  labels: string[],
  max = 8000
): string | null {
  for (const label of labels) {
    const index = text.indexOf(label);

    if (index >= 0) {
      return text
        .slice(index, index + max)
        .trim();
    }
  }

  return null;
}

/* ---------------------------------------------------------
   Quran helpers
--------------------------------------------------------- */

function parseAyahLinks(
  links: string[],
  surah: number,
  ayah: number
): string[] {
  const needle = `/ayat-${ayah}`;

  return unique(
    links.filter((link) => {
      try {
        const u = new URL(link);

        return (
          u.hostname === "www.dawateislami.net" &&
          u.pathname.includes("/quran/") &&
          u.pathname.includes(needle)
        );
      } catch {
        return false;
      }
    })
  ).slice(0, 10);
}

async function discoverAyahPage(
  surah: number,
  ayah: number
) {
  const query = `${surah}:${ayah}`;

  const searchUrl =
    `${QURAN.search}?q=${encodeURIComponent(query)}`;

  const search = await fetchSource(
    searchUrl
  );

  const directLinks = parseAyahLinks(
    search.links,
    surah,
    ayah
  );

  /*
   * Fallback: search result HTML may contain
   * the direct Quran URL even if link extraction
   * did not catch it.
   */
  const htmlUrls =
    search.html.match(
      /https?:\/\/www\.dawateislami\.net\/quran\/[^"' <]+/gi
    ) || [];

  for (const raw of htmlUrls) {
    const clean = raw
      .replace(/&amp;/g, "&")
      .replace(/[),.;]+$/g, "");

    if (
      clean.includes(`/ayat-${ayah}`)
    ) {
      directLinks.push(clean);
    }
  }

  const candidates = unique(
    directLinks
  );

  /*
   * If search returned no direct link, use the
   * site's established public URL pattern.
   * This is only a discovery candidate; we verify
   * it with fetch before using it.
   */
  if (!candidates.length) {
    candidates.push(
      `${BASE}/quran/surah-${surah}/ayat-${ayah}/translation-1/tafseer`,
      `${BASE}/quran/surah-${surah}/ayat-${ayah}/translation-2/tafseer`,
      `${BASE}/quran/surah-${surah}/ayat-${ayah}/translation-3/tafseer`
    );
  }

  const pages = [];

  for (const candidate of candidates.slice(0, 6)) {
    const page = await fetchSource(
      candidate
    );

    if (
      page.ok &&
      page.status >= 200 &&
      page.status < 400 &&
      page.text.length > 100
    ) {
      pages.push(page);
    }
  }

  return {
    query,
    search,
    pages,
  };
}

function extractArabicAyah(
  text: string,
  ayah: number
): string | null {
  /*
   * Official pages contain the ayah number and
   * Arabic text nearby. Keep this conservative.
   */
  const reference =
    new RegExp(
      `\\b\\d+\\.${ayah}\\b`
    );

  const match =
    text.match(reference);

  if (match?.index !== undefined) {
    const section = text.slice(
      match.index,
      match.index + 1600
    );

    const arabic =
      section.match(
        /([\u0600-\u06FF][\u0600-\u06FF\sًٌٍَُِّْٰۭٖٕۖۚۗۙۛۜۢٗٔـٓۤۡۥۦۧۨ۩ؕؔؒؓؑﷲ()،؛:.!-]{20,})/
      );

    if (arabic?.[1]) {
      return normalizeWhitespace(
        arabic[1]
      );
    }
  }

  return null;
}

function extractQuranPageData(
  page: Awaited<ReturnType<typeof fetchSource>>,
  ayah: number
) {
  const text = page.text;

  const arabic =
    extractArabicAyah(
      text,
      ayah
    );

  const kanzulIman =
    extractLabeledSection(
      text,
      [
        "کنزالایمان",
        "ترجمہ کنزالایمان",
        "ترجمۂ کنزالایمان",
        "Kanz ul Iman",
      ],
      5000
    );

  const kanzulIrfan =
    extractLabeledSection(
      text,
      [
        "کنز العرفان",
        "ترجمہ کنز العرفان",
        "ترجمۂ کنز العرفان",
        "Kanz ul Irfan",
      ],
      5000
    );

  const siratUlJinan =
    extractLabeledSection(
      text,
      [
        "تفسیر : صراط الجنان",
        "تفسیر صراط الجنان",
        "صراط الجنان",
        "صِراطُ الجِنان",
      ],
      9000
    );

  const references =
    extractLabeledSection(
      text,
      [
        "حوالہ",
        "حوالہ جات",
        "References",
        "Source",
      ],
      5000
    );

  return {
    url: page.url,
    status: page.status,
    title: extractTitle(page.html),
    arabic,
    kanzul_iman: kanzulIman,
    kanzul_irfan: kanzulIrfan,
    sirat_ul_jinan: siratUlJinan,
    references,
    source_text: findContext(
      text,
      `${ayah}`,
      1000,
      5000
    ),
    links: page.links
      .filter((x) =>
        x.includes("/quran/")
      )
      .slice(0, 40),
  };
}

function selectQuranMode(
  data: any,
  mode: string
) {
  if (mode === "arabic") {
    return {
      arabic: data.arabic,
      source_url: data.url,
    };
  }

  if (mode === "kanzul_iman") {
    return {
      kanzul_iman:
        data.kanzul_iman,
      source_url: data.url,
    };
  }

  if (mode === "kanzul_irfan") {
    return {
      kanzul_irfan:
        data.kanzul_irfan,
      source_url: data.url,
    };
  }

  if (mode === "tafsir") {
    return {
      sirat_ul_jinan:
        data.sirat_ul_jinan,
      source_url: data.url,
    };
  }

  if (mode === "references") {
    return {
      references:
        data.references,
      source_url: data.url,
    };
  }

  return data;
}

async function getQuranAyahResearch(
  surah: number,
  ayah: number
) {
  const discovered =
    await discoverAyahPage(
      surah,
      ayah
    );

  const pages =
    discovered.pages;

  const pageData =
    pages.map((page) =>
      extractQuranPageData(
        page,
        ayah
      )
    );

  /*
   * Merge information from multiple official
   * translation/tafseer pages without inventing
   * missing fields.
   */
  const merged: any = {
    surah,
    ayah,
    reference: `${surah}:${ayah}`,
    source: SOURCES.quran,
    discovery_url:
      discovered.search.url,
    pages_checked:
      pageData.length,
    official_pages: pageData,
  };

  for (const item of pageData) {
    if (!merged.arabic && item.arabic) {
      merged.arabic = item.arabic;
    }

    if (
      !merged.kanzul_iman &&
      item.kanzul_iman
    ) {
      merged.kanzul_iman =
        item.kanzul_iman;
    }

    if (
      !merged.kanzul_irfan &&
      item.kanzul_irfan
    ) {
      merged.kanzul_irfan =
        item.kanzul_irfan;
    }

    if (
      !merged.sirat_ul_jinan &&
      item.sirat_ul_jinan
    ) {
      merged.sirat_ul_jinan =
        item.sirat_ul_jinan;
    }

    if (
      !merged.references &&
      item.references
    ) {
      merged.references =
        item.references;
    }
  }

  merged.detected = {
    arabic: Boolean(merged.arabic),
    kanzul_iman:
      Boolean(merged.kanzul_iman),
    kanzul_irfan:
      Boolean(merged.kanzul_irfan),
    sirat_ul_jinan:
      Boolean(merged.sirat_ul_jinan),
    references:
      Boolean(merged.references),
  };

  merged.research_rules = [
    "Only official Dawat-e-Islami Quran pages are used.",
    "Never reconstruct missing Quran text.",
    "Never invent a translation.",
    "Never invent tafsir.",
    "Never invent page numbers or references.",
    "Preserve the official source URL.",
    "Source text must remain distinguishable from generated explanation.",
  ];

  return merged;
}

/* ---------------------------------------------------------
   Books Library helpers
--------------------------------------------------------- */

function isBookCandidate(url: string): boolean {
  try {
    const u = new URL(url);

    if (
      u.hostname !==
      "www.dawateislami.net"
    ) {
      return false;
    }

    if (
      !u.pathname.startsWith(
        "/bookslibrary/ur/"
      )
    ) {
      return false;
    }

    const parts =
      u.pathname
        .split("/")
        .filter(Boolean);

    if (parts.length < 3) {
      return false;
    }

    const last =
      parts[parts.length - 1];

    const excluded = new Set([
      "search",
      "category",
      "categories",
      "author",
      "authors",
      "home",
      "books",
      "download",
      "read",
      "page",
    ]);

    if (
      excluded.has(
        last.toLowerCase()
      )
    ) {
      return false;
    }

    /*
     * Search pages may expose category and
     * navigation URLs. A real book generally has
     * either one slug or a book/section slug pair.
     */
    return parts.length >= 4 ||
      parts.length === 3;
  } catch {
    return false;
  }
}

function extractBookMetadata(
  page: Awaited<ReturnType<typeof fetchSource>>
) {
  const text = page.text;

  const title =
    extractTitle(page.html);

  function field(
    labels: string[]
  ): string | null {
    for (const label of labels) {
      const regex =
        new RegExp(
          `${label}\\s*[:：]?\\s*([^\\n]{2,180})`,
          "i"
        );

      const match =
        text.match(regex);

      if (match?.[1]) {
        return match[1]
          .replace(
            /\s+/g,
            " "
          )
          .trim();
      }
    }

    return null;
  }

  const author =
    field([
      "مصنف",
      "مصنف:",
      "Author",
    ]);

  const publisher =
    field([
      "پبلشر",
      "Publisher",
    ]);

  const publicationDate =
    field([
      "تاریخ اشاعت",
      "Publication Date",
    ]);

  const category =
    field([
      "کیٹیگری",
      "Category",
    ]);

  const onlinePages =
    field([
      "آن لائن پڑھیں صفحات",
      "Online Reading Pages",
    ]);

  const pdfPages =
    field([
      "پی ڈی ایف صفحات",
      "PDF Pages",
    ]);

  const isbn =
    field([
      "ISBN نمبر",
      "ISBN",
    ]);

  /*
   * Try to isolate "کتاب کے بارے میں"
   * without returning the entire page.
   */
  const description =
    extractLabeledSection(
      text,
      [
        "کتاب کے بارے میں",
        "About the Book",
      ],
      1800
    );

  return {
    title,
    author,
    publisher,
    publication_date:
      publicationDate,
    category,
    online_pages:
      onlinePages,
    pdf_pages:
      pdfPages,
    isbn,
    description,
  };
}

function scoreBook(
  query: string,
  url: string,
  metadata: any,
  text: string
): number {
  const variants =
    makeSearchVariants(query)
      .map(normalizeForSearch)
      .filter(Boolean);

  const haystack =
    normalizeForSearch(
      [
        url,
        metadata.title || "",
        metadata.author || "",
        metadata.category || "",
        metadata.description || "",
        text.slice(0, 8000),
      ].join(" ")
    );

  let score = 0;

  for (const variant of variants) {
    if (!variant) continue;

    if (
      normalizeForSearch(
        metadata.title || ""
      ).includes(variant)
    ) {
      score += 100;
    }

    if (
      haystack.includes(variant)
    ) {
      score += 25;
    }

    const words =
      variant
        .split(/\s+/)
        .filter(Boolean);

    for (const word of words) {
      if (
        word.length >= 2 &&
        haystack.includes(word)
      ) {
        score += 5;
      }
    }
  }

  /*
   * A direct book page with meaningful text
   * receives a small base score.
   */
  if (text.length > 500) {
    score += 5;
  }

  return score;
}

function extractBookCandidatesFromHtml(
  html: string,
  query: string
): string[] {
  const links =
    extractLinks(html);

  const candidates =
    links.filter(
      isBookCandidate
    );

  const variants =
    makeSearchVariants(query)
      .map(normalizeForSearch)
      .filter(Boolean);

  const scored =
    candidates.map((url) => {
      const normalized =
        normalizeForSearch(url);

      let score = 0;

      for (const variant of variants) {
        if (
          normalized.includes(variant)
        ) {
          score += 50;
        }

        for (const word of variant.split(/\s+/)) {
          if (
            word.length >= 2 &&
            normalized.includes(word)
          ) {
            score += 5;
          }
        }
      }

      return {
        url,
        score,
      };
    });

  return scored
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .map((x) => x.url);
}

async function searchBooks(
  query: string,
  pageNumber: number
) {
  const variants =
    makeSearchVariants(query);

  const searchUrls =
    variants.map(
      (variant) =>
        `${BOOKS.search}?stext=${encodeURIComponent(
          variant
        )}&pn=${pageNumber}&filterLang=ur`
    );

  const searchPages =
    await Promise.all(
      searchUrls.map(fetchSource)
    );

  const candidateUrls =
    unique(
      searchPages.flatMap(
        (page) =>
          extractBookCandidatesFromHtml(
            page.html,
            query
          )
      )
    );

  /*
   * Search pages sometimes expose only a limited
   * number of useful links. Add direct slug-like
   * candidates from URLs found in HTML.
   */
  const moreCandidates =
    unique(
      searchPages.flatMap(
        (page) =>
          page.links.filter(
            isBookCandidate
          )
      )
    );

  const allCandidates =
    unique([
      ...candidateUrls,
      ...moreCandidates,
    ]).slice(0, 20);

  const bookPages =
    await Promise.all(
      allCandidates.map(
        fetchSource
      )
    );

  const books =
    bookPages
      .filter(
        (page) =>
          page.ok &&
          page.status >= 200 &&
          page.status < 400 &&
          isBookCandidate(page.url)
      )
      .map((page) => {
        const metadata =
          extractBookMetadata(
            page
          );

        const score =
          scoreBook(
            query,
            page.url,
            metadata,
            page.text
          );

        return {
          ...metadata,
          url: page.url,
          score,
          matched_excerpt:
            findContext(
              page.text,
              query,
              500,
              1800
            ),
        };
      })
      .filter(
        (book) =>
          book.score > 5
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  /*
   * De-duplicate by URL.
   */
  const seen =
    new Set<string>();

  const uniqueBooks =
    books.filter((book) => {
      if (seen.has(book.url)) {
        return false;
      }

      seen.add(book.url);
      return true;
    });

  return {
    query,
    page: pageNumber,
    source: SOURCES.books,
    search_urls: searchUrls,
    search_statuses:
      searchPages.map(
        (x) => ({
          url: x.url,
          status: x.status,
        })
      ),
    candidate_count:
      allCandidates.length,
    results:
      uniqueBooks.slice(0, 12),
    official_search_links:
      unique(
        searchPages.flatMap(
          (x) =>
            x.links.filter(
              (link) =>
                link.includes(
                  "/bookslibrary/ur/"
                )
            )
        )
      ).slice(0, 50),
    rules: [
      "Results come from official Dawat-e-Islami Al Madina Books Library pages.",
      "Book metadata is returned only when detected on the official page.",
      "Missing metadata is returned as null rather than invented.",
      "Source URLs are preserved.",
      "Matched excerpts are bounded; do not reproduce entire copyrighted books.",
    ],
  };
}

/* ---------------------------------------------------------
   Islamic Portal helpers
--------------------------------------------------------- */

function filterPortalLinks(
  links: string[]
): string[] {
  return unique(
    links.filter((url) => {
      try {
        const u = new URL(url);

        return (
          u.hostname ===
            "www.dawateislami.net" &&
          u.pathname.startsWith(
            "/islamicportal"
          )
        );
      } catch {
        return false;
      }
    })
  ).slice(0, 50);
}

/* ---------------------------------------------------------
   Server
--------------------------------------------------------- */

function createServer() {
  const server = new McpServer({
    name:
      "Dawat-e-Islami Research MCP",
    version: "4.0.0",
  });

  /* =======================================================
     1. COMPLETE QURAN RESEARCH
     ======================================================= */

  server.registerTool(
    "quran_research",
    {
      description:
        "Primary official Dawat-e-Islami Quran research tool. " +
        "For a specific surah:ayah it attempts direct official ayah pages " +
        "and extracts Arabic, Kanz-ul-Iman, Kanz-ul-Irfan, Sirat-ul-Jinan " +
        "and references. For general topics it searches the official Quran portal. " +
        "Never fabricate missing source text.",

      inputSchema: {
        query:
          z.string()
            .min(1)
            .max(300),

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
      /*
       * Recognize canonical references such as:
       * 2:153
       * 2 : 153
       */
      const ref =
        query.match(
          /^\s*(\d{1,3})\s*:\s*(\d{1,3})\s*$/
        );

      if (ref) {
        const surah =
          Number(ref[1]);

        const ayah =
          Number(ref[2]);

        if (
          surah >= 1 &&
          surah <= 114 &&
          ayah >= 1 &&
          ayah <= 286
        ) {
          const research =
            await getQuranAyahResearch(
              surah,
              ayah
            );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...research,
                    requested_mode:
                      mode,
                    selected_output:
                      selectQuranMode(
                        research,
                        mode
                      ),
                    summary_policy:
                      mode === "summary"
                        ? "Generate a concise summary from the official source data; clearly label it as AI-generated and do not present it as source text."
                        : null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      const url =
        `${QURAN.search}?q=${encodeURIComponent(
          query
        )}`;

      const result =
        await fetchSource(url);

      const kanzulIman =
        extractLabeledSection(
          result.text,
          [
            "کنزالایمان",
            "ترجمہ کنزالایمان",
            "ترجمۂ کنزالایمان",
            "Kanz ul Iman",
          ],
          5000
        );

      const kanzulIrfan =
        extractLabeledSection(
          result.text,
          [
            "کنز العرفان",
            "ترجمہ کنز العرفان",
            "ترجمۂ کنز العرفان",
            "Kanz ul Irfan",
          ],
          5000
        );

      const siratUlJinan =
        extractLabeledSection(
          result.text,
          [
            "تفسیر صراط الجنان",
            "تفسیر : صراط الجنان",
            "صراط الجنان",
          ],
          8000
        );

      const output: any = {
        query,
        source: SOURCES.quran,
        source_url: result.url,
        http_status: result.status,
        requested_mode: mode,

        detected: {
          kanzul_iman:
            Boolean(kanzulIman),
          kanzul_irfan:
            Boolean(kanzulIrfan),
          sirat_ul_jinan:
            Boolean(siratUlJinan),
        },

        source_text:
          result.text.slice(
            0,
            12000
          ),

        source_links:
          result.links
            .filter((x) =>
              x.includes("/quran/")
            )
            .slice(0, 50),

        research_rules: [
          "Use official source text only.",
          "Do not fabricate Quran Arabic.",
          "Do not fabricate translations.",
          "Do not fabricate tafsir.",
          "Do not fabricate citations.",
          "Preserve official URLs.",
        ],
      };

      if (
        mode ===
        "kanzul_iman"
      ) {
        output.output = {
          kanzul_iman:
            kanzulIman,
        };
      } else if (
        mode ===
        "kanzul_irfan"
      ) {
        output.output = {
          kanzul_irfan:
            kanzulIrfan,
        };
      } else if (
        mode === "tafsir"
      ) {
        output.output = {
          sirat_ul_jinan:
            siratUlJinan,
        };
      } else if (
        mode === "quran_only"
      ) {
        output.output = {
          source_text:
            result.text.slice(
              0,
              12000
            ),
        };
      } else if (
        mode === "references"
      ) {
        output.output = {
          source_links:
            result.links
              .filter((x) =>
                x.includes("/quran/")
              )
              .slice(0, 50),
        };
      }

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

  /* =======================================================
     2. QURAN AYAH
     ======================================================= */

  server.registerTool(
    "quran_ayah",
    {
      description:
        "Look up a specific Quran ayah from official Dawat-e-Islami pages. " +
        "Attempts direct ayah/translation/tafseer pages and merges only " +
        "information actually found on official pages.",

      inputSchema: {
        surah:
          z.number()
            .int()
            .min(1)
            .max(114),

        ayah:
          z.number()
            .int()
            .min(1)
            .max(286),

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

    async ({
      surah,
      ayah,
      mode,
    }) => {
      const research =
        await getQuranAyahResearch(
          surah,
          ayah
        );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...research,
                requested_mode:
                  mode,
                selected_output:
                  selectQuranMode(
                    research,
                    mode
                  ),
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
        "Search the official Dawat-e-Islami Quran portal for Quranic " +
        "words, phrases, topics, surahs or ayahs. Returns official " +
        "search content and Quran URLs.",

      inputSchema: {
        query:
          z.string()
            .min(1)
            .max(300),
      },
    },

    async ({ query }) => {
      const url =
        `${QURAN.search}?q=${encodeURIComponent(
          query
        )}`;

      const result =
        await fetchSource(url);

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
              result.text ||
                "(No text returned.)",
              "",
              "OFFICIAL QURAN LINKS:",
              result.links
                .filter((x) =>
                  x.includes("/quran/")
                )
                .slice(0, 50)
                .map(
                  (x) => `- ${x}`
                )
                .join("\n") ||
                "(No Quran links returned.)",
            ].join("\n"),
          },
        ],
      };
    }
  );

  /* =======================================================
     4. QURAN SOURCE INFO
     ======================================================= */

  server.registerTool(
    "quran_source_info",
    {
      description:
        "Return official Dawat-e-Islami information about its Quran, " +
        "Kanz-ul-Iman, Kanz-ul-Irfan and Sirat-ul-Jinan resources.",

      inputSchema: {},
    },

    async () => {
      const result =
        await fetchSource(
          QURAN.intro
        );

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
              "OFFICIAL QURAN LINKS:",
              result.links
                .filter((x) =>
                  x.includes("/quran/")
                )
                .slice(0, 50)
                .join("\n"),
            ].join("\n"),
          },
        ],
      };
    }
  );

  /* =======================================================
     5. DAWAT BOOK LIBRARY — IMPROVED
     ======================================================= */

  server.registerTool(
    "search_dawat_books",
    {
      description:
        "Search the official Dawat-e-Islami Al Madina Books Library. " +
        "Returns matched official book pages with title, author, publisher, " +
        "publication information, page counts, URL and a bounded matched excerpt. " +
        "Never reports No Data Found merely because the search page is difficult to parse.",

      inputSchema: {
        query:
          z.string()
            .min(1)
            .max(300),

        page:
          z.number()
            .int()
            .min(1)
            .max(50)
            .default(1),
      },
    },

    async ({
      query,
      page,
    }) => {
      const research =
        await searchBooks(
          query,
          page
        );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              research,
              null,
              2
            ),
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
        "Search the official Dawat-e-Islami Islamic Portal only. " +
        "Does not substitute Books Library, News or Faizan-e-Madina.",

      inputSchema: {
        query:
          z.string()
            .min(1)
            .max(300),
      },
    },

    async ({ query }) => {
      const url =
        `${PORTAL.home}?search=${encodeURIComponent(
          query
        )}`;

      const result =
        await fetchSource(url);

      const portalLinks =
        filterPortalLinks(
          result.links
        );

      return {
        content: [
          {
            type: "text",
            text: [
              `SOURCE: ${SOURCES.portal}`,
              `QUERY: ${query}`,
              `URL: ${url}`,
              `HTTP STATUS: ${result.status}`,
              "",
              "OFFICIAL ISLAMIC PORTAL TEXT:",
              result.text ||
                "(No text returned.)",
              "",
              "OFFICIAL ISLAMIC PORTAL LINKS:",
              portalLinks.join(
                "\n"
              ) ||
                "(No portal links returned.)",
              "",
              "SOURCE RULE:",
              "Only /islamicportal pages are included here. Books Library, News and Faizan-e-Madina are not silently substituted.",
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
        "Run a broad research question across the official Dawat-e-Islami " +
        "Al Madina Books Library, Quran and Islamic Portal. Results remain " +
        "separated by source.",

      inputSchema: {
        query:
          z.string()
            .min(1)
            .max(300),
      },
    },

    async ({ query }) => {
      /*
       * Run the improved Books search first.
       * Quran and Portal are fetched independently.
       */
      const [
        books,
        quran,
        portal,
      ] = await Promise.all([
        searchBooks(
          query,
          1
        ),

        fetchSource(
          `${QURAN.search}?q=${encodeURIComponent(
            query
          )}`
        ),

        fetchSource(
          `${PORTAL.home}?search=${encodeURIComponent(
            query
          )}`
        ),
      ]);

      const portalLinks =
        filterPortalLinks(
          portal.links
        );

      const quranData = {
        name: SOURCES.quran,
        url: quran.url,
        status: quran.status,
        source_text:
          quran.text.slice(
            0,
            12000
          ),
        links:
          quran.links
            .filter((x) =>
              x.includes("/quran/")
            )
            .slice(0, 40),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,

                sources: {
                  books: {
                    ...books,
                    name: SOURCES.books,
                  },

                  quran:
                    quranData,

                  islamic_portal: {
                    name:
                      SOURCES.portal,
                    url:
                      portal.url,
                    status:
                      portal.status,
                    source_text:
                      portal.text.slice(
                        0,
                        10000
                      ),
                    links:
                      portalLinks,
                  },
                },

                source_separation:
                  true,

                rules: [
                  "Official Dawat-e-Islami sources only.",
                  "Books Library results are taken from official book pages.",
                  "Quran source remains separate from Books Library.",
                  "Islamic Portal remains separate from Books Library.",
                  "No News substitution.",
                  "No Faizan-e-Madina substitution.",
                  "Never fabricate unavailable text.",
                  "Never invent page numbers.",
                  "Never invent authors, publishers or hadith numbers.",
                  "Preserve official source URLs.",
                  "AI-generated explanation must be clearly distinguished from source text.",
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
        "Return the configured Dawat-e-Islami research and source policy.",

      inputSchema: {},
    },

    async () => {
      return {
        content: [
          {
            type: "text",
            text: `
DAWAT-E-ISLAMI RESEARCH POLICY

PRIMARY DAWAT SOURCES
1. Al Madina Books Library
2. Official Dawat-e-Islami Quran
3. Official Dawat-e-Islami Islamic Portal

QURAN
- Official Arabic Quran
- Kanz-ul-Iman
- Kanz-ul-Irfan
- Sirat-ul-Jinan
- Official Quran references

QURAN CITATION
- Use Quran reference as:
  (سورۃ، سورۃ نمبر:آیت نمبر)
- Example:
  (البقرۃ، 2:153)

BOOK CITATION
- Preserve author, book, publisher,
  city, year, volume and page only
  when actually available from the source.
- Never invent missing bibliographic data.

SOURCE HANDLING
- Official source URLs must be preserved.
- Source text and AI-generated explanation
  must remain separate.
- Missing source data must be marked unavailable.
- Never fabricate Quran Arabic.
- Never fabricate translations.
- Never fabricate tafsir.
- Never fabricate hadith numbers.
- Never fabricate page numbers.

BOOK SEARCH
- Search the official Al Madina Books Library.
- Resolve actual book pages when possible.
- Return title, author, publisher, date,
  category and page information when detected.
- Return bounded relevant excerpts.
- Do not reproduce entire copyrighted books.

ISLAMIC PORTAL
- Only /islamicportal pages.
- Do not silently replace it with Books Library.
- Do not silently replace it with News.
- Do not silently replace it with Faizan-e-Madina.

EXTERNAL MCP ARCHITECTURE
- Shamela remains its own MCP connection.
- Turath remains its own MCP connection.
- This Worker does not proxy Shamela OAuth.
- This Worker does not proxy Turath sessions.
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
    return createMcpHandler(
      createServer
    )(
      request,
      env,
      ctx
    );
  },
};
