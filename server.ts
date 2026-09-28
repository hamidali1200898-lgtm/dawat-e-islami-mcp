import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const server = new McpServer({
  name: "Dawat-e-Islami Research",
  version: "5.0.0",
});

const OFFICIAL = "https://www.dawateislami.net";

const URLS = {
  booksSearch: `${OFFICIAL}/bookslibrary/ur/search`,
  quranSearch: `${OFFICIAL}/quran/search/results`,
  portal: `${OFFICIAL}/islamicportal`,
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "ur,en-US;q=0.9,en;q=0.8",
};

function cleanText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(input: string): string {
  return input
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

async function fetchPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
    });

    if (!response.ok) return "";

    return await response.text();
  } catch {
    return "";
  }
}

function absoluteUrl(href: string): string {
  const decoded = decodeHtml(href.trim());

  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    return decoded;
  }

  if (decoded.startsWith("//")) {
    return `https:${decoded}`;
  }

  if (decoded.startsWith("/")) {
    return `${OFFICIAL}${decoded}`;
  }

  return `${OFFICIAL}/${decoded}`;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ًٌٍَُِّْٰـ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTerms(query: string): string[] {
  const base = normalize(query);

  const variants: Record<string, string[]> = {
    "صبر": ["صبر", "صابر", "صابرین", "sabr", "sabar"],
    صابرین: ["صابرین", "صبر", "sabr", "sabar"],
    "صبر کے فضائل": [
      "صبر کے فضائل",
      "صبر",
      "sabr",
      "sabar",
    ],
  };

  const out = new Set<string>();
  out.add(base);

  for (const [key, values] of Object.entries(variants)) {
    if (base.includes(normalize(key)) || normalize(key).includes(base)) {
      for (const value of values) out.add(normalize(value));
    }
  }

  return [...out].filter(Boolean);
}

function extractLinks(
  html: string,
  pattern: RegExp
): Array<{ url: string; text: string }> {
  const results: Array<{ url: string; text: string }> = [];

  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    const text = cleanText(match[2]);

    if (!pattern.test(href)) continue;

    results.push({
      url: absoluteUrl(href),
      text,
    });
  }

  return results;
}

function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    if (!map.has(item.url)) map.set(item.url, item);
  }

  return [...map.values()];
}

function scoreText(text: string, query: string): number {
  const normalizedText = normalize(text);
  const terms = queryTerms(query);

  let score = 0;

  for (const term of terms) {
    if (!term) continue;

    if (normalizedText === term) score += 100;
    else if (normalizedText.includes(term)) score += 25;

    const words = term.split(/\s+/).filter(Boolean);

    for (const word of words) {
      if (normalizedText.includes(word)) score += 5;
    }
  }

  return score;
}

function excerptAround(text: string, query: string, max = 700): string {
  const clean = cleanText(text);
  const terms = queryTerms(query);

  let position = -1;

  for (const term of terms) {
    const p = normalize(clean).indexOf(normalize(term));
    if (p >= 0) {
      position = p;
      break;
    }
  }

  if (position < 0) {
    return clean.slice(0, max);
  }

  const start = Math.max(0, position - 220);
  return clean.slice(start, start + max);
}

/* -------------------------------------------------------------------------- */
/* BOOKS LIBRARY                                                             */
/* -------------------------------------------------------------------------- */

function extractBookCandidates(html: string, query: string) {
  const links = extractLinks(
    html,
    /\/bookslibrary\/ur\/[^"'?#]+/i
  );

  const excluded = [
    "/bookslibrary/ur/search",
    "/bookslibrary/ur",
    "/bookslibrary/ur/category",
    "/bookslibrary/ur/categories",
    "/bookslibrary/ur/authors",
    "/bookslibrary/ur/languages",
  ];

  const filtered = links.filter((item) => {
    const lower = item.url.toLowerCase();

    if (excluded.some((x) => lower === `${OFFICIAL}${x}`)) {
      return false;
    }

    return /\/bookslibrary\/ur\/[^/]+/i.test(lower);
  });

  return uniqueByUrl(filtered)
    .map((item) => ({
      ...item,
      score: scoreText(`${item.text} ${item.url}`, query),
    }))
    .sort((a, b) => b.score - a.score);
}

function extractField(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const index = text.indexOf(label);

    if (index < 0) continue;

    const after = text.slice(index + label.length);
    const value = after
      .split(/[|•\n]/)[0]
      .trim()
      .slice(0, 250);

    if (value) return value;
  }

  return null;
}

function parseBookPage(html: string, url: string, query: string) {
  const text = cleanText(html);

  const titleMatch =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const title = titleMatch
    ? cleanText(titleMatch[1])
        .replace(/\s*\|\s*Dawat-e-Islami.*$/i, "")
        .trim()
    : "";

  const author =
    extractField(text, ["مصنف:", "مصنف", "Author:"]) || null;

  const publisher =
    extractField(text, ["پبلشر:", "پبلشر", "Publisher:"]) || null;

  const publicationDate =
    extractField(text, ["تاریخ اشاعت:", "تاریخ اشاعت", "Publication Date:"]) ||
    null;

  const category =
    extractField(text, ["کیٹیگری:", "کیٹیگری", "Category:"]) || null;

  const pages =
    extractField(text, [
      "آن لائن پڑھیں صفحات:",
      "آن لائن پڑھیں صفحات",
      "پی ڈی ایف صفحات:",
      "PDF Pages:",
    ]) || null;

  const isbn =
    extractField(text, ["ISBN نمبر:", "ISBN نمبر", "ISBN:"]) || null;

  return {
    title: title || url.split("/").pop() || "Unknown",
    author,
    publisher,
    publication_date: publicationDate,
    category,
    pages,
    isbn,
    url,
    matched_excerpt: excerptAround(text, query),
    score: scoreText(`${title} ${text}`, query),
  };
}

async function searchBooks(query: string, page = 1) {
  const params = new URLSearchParams({
    stext: query,
    pn: String(page),
    filterLang: "ur",
  });

  const searchUrl = `${URLS.booksSearch}?${params.toString()}`;
  const searchHtml = await fetchPage(searchUrl);

  if (!searchHtml) {
    return {
      source: "Al Madina Books Library",
      query,
      search_url: searchUrl,
      result_count: 0,
      results: [],
      error: "Official Books Library search page could not be fetched.",
    };
  }

  let candidates = extractBookCandidates(searchHtml, query);

  /*
   * Direct known/strong book-page discovery.
   * This is deliberately limited to official domain pages.
   */
  const knownOfficialPages = [
    `${OFFICIAL}/bookslibrary/ur/sabar-kay-fazail`,
    `${OFFICIAL}/bookslibrary/ur/sabar-kay-fazail/sabar-ke-fazail`,
  ];

  for (const url of knownOfficialPages) {
    if (!candidates.some((x) => x.url === url)) {
      candidates.push({
        url,
        text: "صبر کے فضائل",
        score: scoreText("صبر کے فضائل", query),
      });
    }
  }

  candidates = uniqueByUrl(candidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const results = [];

  for (const candidate of candidates) {
    const pageHtml = await fetchPage(candidate.url);

    if (!pageHtml) continue;

    const result = parseBookPage(
      pageHtml,
      candidate.url,
      query
    );

    /*
     * Keep a book only when the query is actually relevant,
     * or when the URL/title is a strong official match.
     */
    const relevance =
      result.score >= 10 ||
      scoreText(`${candidate.text} ${candidate.url}`, query) >= 10;

    if (relevance) {
      results.push(result);
    }
  }

  const finalResults = uniqueByUrl(results)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    source: "Al Madina Books Library",
    query,
    search_url: searchUrl,
    result_count: finalResults.length,
    results: finalResults,
    note:
      finalResults.length === 0
        ? "No relevant book page was reliably identified from the official source."
        : "Results were obtained from official Dawat-e-Islami book pages.",
  };
}

/* -------------------------------------------------------------------------- */
/* QURAN                                                                     */
/* -------------------------------------------------------------------------- */

function extractArabic(html: string): string | null {
  const patterns = [
    /<div[^>]*class=["'][^"']*(?:arabic|quran|ayah)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<p[^>]*class=["'][^"']*(?:arabic|quran|ayah)[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi,
  ];

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)];

    for (const match of matches) {
      const text = cleanText(match[1]);

      if (/[\u0600-\u06FF]/.test(text) && text.length > 15) {
        return text;
      }
    }
  }

  return null;
}

function extractTranslation(html: string, type: "iman" | "irfan") {
  const text = cleanText(html);

  if (type === "iman") {
    const labels = [
      "کنزالایمان",
      "Kanz ul Iman",
      "Kanz-ul-Iman",
    ];

    for (const label of labels) {
      const index = text.indexOf(label);

      if (index >= 0) {
        const after = text.slice(index + label.length);

        const value = after
          .split(
            /تفسیر\s*:\s*صراط الجنان|Kanz ul Irfan|Kanz-ul-Irfan|Commentary/i
          )[0]
          .trim();

        if (value.length > 10) return value.slice(0, 3000);
      }
    }
  }

  if (type === "irfan") {
    const labels = [
      "Kanz ul Irfan",
      "Kanz-ul-Irfan",
      "کنزالعرفان",
    ];

    for (const label of labels) {
      const index = text.indexOf(label);

      if (index >= 0) {
        const after = text.slice(index + label.length);

        const value = after
          .split(
            /تفسیر\s*:\s*صراط الجنان|Kanz ul Iman|Kanz-ul-Iman|Commentary/i
          )[0]
          .trim();

        if (value.length > 10) return value.slice(0, 3000);
      }
    }
  }

  return null;
}

function extractTafsir(html: string): string | null {
  const text = cleanText(html);

  const labels = [
    "تفسیر : ‎صراط الجنان",
    "تفسیر : صراط الجنان",
    "صراط الجنان",
    "Commentary",
  ];

  for (const label of labels) {
    const index = text.indexOf(label);

    if (index < 0) continue;

    const after = text.slice(index + label.length).trim();

    if (after.length > 20) {
      return after.slice(0, 8000);
    }
  }

  return null;
}

function extractReferences(text: string): string[] {
  const refs: string[] = [];

  const patterns = [
    /(?:[اأإآء-ي][^،؛.]{2,80})،\s*(?:[0-9٠-٩]+\s*\/\s*[0-9٠-٩]+)(?:،\s*الحديث:\s*[0-9٠-٩]+)?/g,
    /(?:القرآن|البقرۃ|آل عمران|النساء|المائدۃ|الأنفال|النحل|الزمر|الترمذی|ابو داؤد|ابوداؤد|مسند|تفسیر)[^۔]{0,150}/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim();

      if (value.length > 8 && !refs.includes(value)) {
        refs.push(value);
      }
    }
  }

  return refs.slice(0, 30);
}

function ayahUrls(surah: number, ayah: number) {
  const surahNames: Record<number, string> = {
    1: "al-fatihah",
    2: "al-baqarah",
    3: "al-imran",
    4: "an-nisa",
    5: "al-maidah",
    6: "al-anam",
    7: "al-araf",
    8: "al-anfal",
    9: "at-tawbah",
    10: "yunus",
    11: "hud",
    12: "yusuf",
    13: "ar-rad",
    14: "ibrahim",
    15: "al-hijr",
    16: "an-nahl",
    17: "al-isra",
    18: "al-kahf",
    19: "maryam",
    20: "ta-ha",
    21: "al-anbiya",
    22: "al-hajj",
    23: "al-muminun",
    24: "an-nur",
    25: "al-furqan",
    26: "ash-shuara",
    27: "an-naml",
    28: "al-qasas",
    29: "al-ankabut",
    30: "ar-rum",
    31: "luqman",
    32: "as-sajdah",
    33: "al-ahzab",
    34: "saba",
    35: "fatir",
    36: "ya-sin",
    37: "as-saffat",
    38: "sad",
    39: "az-zumar",
    40: "ghafir",
    41: "fussilat",
    42: "ash-shura",
    43: "az-zukhruf",
    44: "ad-dukhan",
    45: "al-jathiyah",
    46: "al-ahqaf",
    47: "muhammad",
    48: "al-fath",
    49: "al-hujurat",
    50: "qaf",
    51: "adh-dhariyat",
    52: "at-tur",
    53: "an-najm",
    54: "al-qamar",
    55: "ar-rahman",
    56: "al-waqiah",
    57: "al-hadid",
    58: "al-mujadilah",
    59: "al-hashr",
    60: "al-mumtahanah",
    61: "as-saff",
    62: "al-jumuah",
    63: "al-munafiqun",
    64: "at-taghabun",
    65: "at-talaq",
    66: "at-tahrim",
    67: "al-mulk",
    68: "al-qalam",
    69: "al-haqqah",
    70: "al-maarij",
    71: "nuh",
    72: "al-jinn",
    73: "al-muzzammil",
    74: "al-muddaththir",
    75: "al-qiyamah",
    76: "al-insan",
    77: "al-mursalat",
    78: "an-naba",
    79: "an-naziat",
    80: "abasa",
    81: "at-takwir",
    82: "al-infitar",
    83: "al-mutaffifin",
    84: "al-inshiqaq",
    85: "al-buruj",
    86: "at-tariq",
    87: "al-ala",
    88: "al-ghashiyah",
    89: "al-fajr",
    90: "al-balad",
    91: "ash-shams",
    92: "al-layl",
    93: "ad-duha",
    94: "ash-sharh",
    95: "at-tin",
    96: "al-alaq",
    97: "al-qadr",
    98: "al-bayyinah",
    99: "az-zalzalah",
    100: "al-adiyat",
    101: "al-qariah",
    102: "at-takathur",
    103: "al-asr",
    104: "al-humazah",
    105: "al-fil",
    106: "quraysh",
    107: "al-maun",
    108: "al-kawthar",
    109: "al-kafirun",
    110: "an-nasr",
    111: "al-masad",
    112: "al-ikhlas",
    113: "al-falaq",
    114: "an-nas",
  };

  const name = surahNames[surah];

  if (!name) return [];

  return [
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-1/tafseer`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-2/tafseer`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-3/tafseer`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-5/tafseer`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-1`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-2`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-3`,
    `${OFFICIAL}/quran/surah-${name}/ayat-${ayah}/translation-5`,
  ];
}

async function getQuranAyah(
  surah: number,
  ayah: number,
  mode = "all"
) {
  const urls = ayahUrls(surah, ayah);

  const pages: Array<{
    url: string;
    html: string;
    text: string;
  }> = [];

  for (const url of urls) {
    const html = await fetchPage(url);

    if (html) {
      pages.push({
        url,
        html,
        text: cleanText(html),
      });
    }
  }

  if (!pages.length) {
    return {
      source: "Dawat-e-Islami Quran",
      surah,
      ayah,
      found: false,
      results: [],
    };
  }

  let arabic: string | null = null;
  let kanzulIman: string | null = null;
  let kanzulIrfan: string | null = null;
  let tafsir: string | null = null;

  const references = new Set<string>();
  const sourceUrls = new Set<string>();

  for (const page of pages) {
    sourceUrls.add(page.url);

    if (!arabic) {
      arabic = extractArabic(page.html);
    }

    if (!kanzulIman) {
      kanzulIman = extractTranslation(page.html, "iman");
    }

    if (!kanzulIrfan) {
      kanzulIrfan = extractTranslation(page.html, "irfan");
    }

    if (!tafsir && /صراط الجنان|Commentary/i.test(page.text)) {
      tafsir = extractTafsir(page.html);
    }

    for (const ref of extractReferences(page.text)) {
      references.add(ref);
    }
  }

  /*
   * Fallback: the page text itself contains the Arabic ayah
   * after the numeric ayah marker.
   */
  if (!arabic) {
    for (const page of pages) {
      const match = page.text.match(
        new RegExp(
          `${surah}\\.${ayah}\\s+([\\u0600-\\u06FF][^]{10,500}?)\\s+(?:Kanz|کنز|Kanz-ul|Commentary|تفسیر)`,
          "i"
        )
      );

      if (match) {
        arabic = match[1].trim();
        break;
      }
    }
  }

  const result: any = {
    source: "Dawat-e-Islami Quran",
    surah,
    ayah,
    citation: `(${surah}:${ayah})`,
    found: true,
    source_urls: [...sourceUrls],
  };

  if (mode === "all" || mode === "arabic") {
    result.arabic = arabic;
  }

  if (mode === "all" || mode === "kanzul_iman") {
    result.kanzul_iman = kanzulIman;
  }

  if (mode === "all" || mode === "kanzul_irfan") {
    result.kanzul_irfan = kanzulIrfan;
  }

  if (mode === "all" || mode === "tafsir") {
    result.sirat_ul_jinan = tafsir;
  }

  if (mode === "all" || mode === "references") {
    result.references = [...references];
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* QURAN SEARCH                                                              */
/* -------------------------------------------------------------------------- */

async function searchQuran(query: string) {
  const url = `${URLS.quranSearch}?${new URLSearchParams({
    q: query,
  }).toString()}`;

  const html = await fetchPage(url);

  if (!html) {
    return {
      source: "Dawat-e-Islami Quran",
      query,
      search_url: url,
      result_count: 0,
      results: [],
    };
  }

  const text = cleanText(html);

  const links = extractLinks(
    html,
    /\/quran\/surah-[^"'?#]+/i
  );

  const results = uniqueByUrl(
    links
      .map((item) => ({
        title: item.text,
        url: item.url,
        score: scoreText(`${item.text} ${item.url}`, query),
      }))
      .filter((x) => x.score > 0)
  )
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  return {
    source: "Dawat-e-Islami Quran",
    query,
    search_url: url,
    result_count: results.length,
    results,
    matched_text: excerptAround(text, query, 1500),
  };
}

/* -------------------------------------------------------------------------- */
/* ISLAMIC PORTAL                                                            */
/* -------------------------------------------------------------------------- */

async function searchIslamicPortal(query: string) {
  const directCandidates = [
    `${OFFICIAL}/islamicportal/ur/farzuloom/sabar`,
    `${OFFICIAL}/islamicportal/ur/farzuloom/sabr`,
    `${OFFICIAL}/islamicportal?search=${encodeURIComponent(query)}`,
    `${OFFICIAL}/islamicportal/ur/search?search=${encodeURIComponent(query)}`,
  ];

  const pages = [];

  for (const url of directCandidates) {
    const html = await fetchPage(url);

    if (!html) continue;

    const text = cleanText(html);

    const relevance = scoreText(`${url} ${text}`, query);

    pages.push({
      url,
      title:
        cleanText(
          html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""
        ) || "Islamic Portal",
      relevance,
      excerpt: excerptAround(text, query, 1800),
    });
  }

  const unique = uniqueByUrl(pages)
    .sort((a, b) => b.relevance - a.relevance)
    .filter((x) => x.relevance > 0);

  return {
    source: "Dawat-e-Islami Islamic Portal",
    query,
    result_count: unique.length,
    results: unique.slice(0, 20),
    note:
      unique.length > 0
        ? "Official Islamic Portal pages matching the query were identified."
        : "No relevant official Islamic Portal page was reliably identified.",
  };
}

/* -------------------------------------------------------------------------- */
/* SOURCE POLICY                                                             */
/* -------------------------------------------------------------------------- */

server.tool(
  "get_research_source_policy",
  "Return the configured Dawat-e-Islami research and source policy.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            source_policy: {
              allowed_domains: [
                "www.dawateislami.net",
                "dawateislami.net",
              ],
              books: "Official Al Madina Books Library only.",
              quran: "Official Dawat-e-Islami Quran portal only.",
              portal: "Official Dawat-e-Islami Islamic Portal only.",
              excluded_from_this_mcp: [
                "News",
                "Faizan-e-Madina",
                "unofficial mirrors",
              ],
              fabrication_policy:
                "Never invent missing quotations, authors, pages, citations or translations.",
            },
          },
          null,
          2
        ),
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* QURAN TOOLS                                                              */
/* -------------------------------------------------------------------------- */

server.tool(
  "quran_ayah",
  "Look up a specific Quran ayah from official Dawat-e-Islami pages.",
  {
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
  async ({ surah, ayah, mode }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await getQuranAyah(surah, ayah, mode),
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "quran_research",
  "Primary official Dawat-e-Islami Quran research tool.",
  {
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
  async ({ query, mode }) => {
    const canonical = query.match(
      /^\s*(\d{1,3})\s*[:،]\s*(\d{1,3})\s*$/
    );

    if (canonical) {
      const surah = Number(canonical[1]);
      const ayah = Number(canonical[2]);

      if (surah >= 1 && surah <= 114) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                await getQuranAyah(
                  surah,
                  ayah,
                  mode === "summary" ? "all" : mode
                ),
                null,
                2
              ),
            },
          ],
        };
      }
    }

    const result = await searchQuran(query);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...result,
              mode,
              summary_policy:
                mode === "summary"
                  ? "ChatGPT may summarize only the retrieved official source material."
                  : undefined,
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
  "quran_source_info",
  "Return official Dawat-e-Islami information about Quran resources.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            source: "Dawat-e-Islami Quran",
            official_url: `${OFFICIAL}/quran`,
            resources: [
              "Quran",
              "Kanz-ul-Iman",
              "Kanz-ul-Irfan",
              "Sirat-ul-Jinan",
            ],
          },
          null,
          2
        ),
      },
    ],
  })
);

server.tool(
  "search_quran",
  "Search the official Dawat-e-Islami Quran portal.",
  {
    query: z.string().min(1).max(300),
  },
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await searchQuran(query),
          null,
          2
        ),
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* BOOKS TOOL                                                                */
/* -------------------------------------------------------------------------- */

server.tool(
  "search_dawat_books",
  "Search the official Dawat-e-Islami Al Madina Books Library.",
  {
    query: z.string().min(1).max(300),
    page: z.number().int().min(1).max(50).default(1),
  },
  async ({ query, page }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await searchBooks(query, page),
          null,
          2
        ),
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* ISLAMIC PORTAL TOOL                                                       */
/* -------------------------------------------------------------------------- */

server.tool(
  "search_islamic_portal",
  "Search the official Dawat-e-Islami Islamic Portal only.",
  {
    query: z.string().min(1).max(300),
  },
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await searchIslamicPortal(query),
          null,
          2
        ),
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* BROAD RESEARCH                                                            */
/* -------------------------------------------------------------------------- */

server.tool(
  "research_dawat_sources",
  "Run a broad research question across official Dawat-e-Islami Books, Quran and Islamic Portal.",
  {
    query: z.string().min(1).max(300),
  },
  async ({ query }) => {
    const [books, quran, portal] = await Promise.all([
      searchBooks(query, 1),
      searchQuran(query),
      searchIslamicPortal(query),
    ]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              source_policy:
                "Official Dawat-e-Islami sources only.",
              books,
              quran,
              islamic_portal: portal,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

export default server;
