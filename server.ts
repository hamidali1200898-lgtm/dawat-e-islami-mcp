import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

const APP_NAME = "Dawat-e-Islami Research";
const APP_VERSION = "6.0.0";

const OFFICIAL = "https://www.dawateislami.net";

const serverInfo = {
  name: APP_NAME,
  version: APP_VERSION,
};

type SearchResult = {
  title: string;
  url: string;
  source: string;
  excerpt?: string;
  author?: string;
  publisher?: string;
  publicationDate?: string;
  category?: string;
  pages?: string;
  isbn?: string;
};

type QuranResult = {
  surah?: string;
  ayah?: string;
  arabic?: string;
  kanzUlIman?: string;
  kanzUlIrfan?: string;
  siratUlJinan?: string;
  references?: string[];
  url: string;
  rawExcerpt?: string;
};

const textOutputSchema = z.object({
  text: z.string(),
});

const searchOutputSchema = z.object({
  query: z.string(),
  count: z.number(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      source: z.string(),
      excerpt: z.string().optional(),
      author: z.string().optional(),
      publisher: z.string().optional(),
      publicationDate: z.string().optional(),
      category: z.string().optional(),
      pages: z.string().optional(),
      isbn: z.string().optional(),
    })
  ),
});

const quranOutputSchema = z.object({
  query: z.string(),
  count: z.number(),
  results: z.array(
    z.object({
      surah: z.string().optional(),
      ayah: z.string().optional(),
      arabic: z.string().optional(),
      kanzUlIman: z.string().optional(),
      kanzUlIrfan: z.string().optional(),
      siratUlJinan: z.string().optional(),
      references: z.array(z.string()).optional(),
      url: z.string(),
      rawExcerpt: z.string().optional(),
    })
  ),
});

function cleanHtml(html: string): string {
  return html
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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ًٌٍَُِّْـٰٖٗ]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/[ۀة]/g, "ہ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slugifyQuery(query: string): string {
  return normalizeText(query)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function isOfficialUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "www.dawateislami.net" ||
        u.hostname === "dawateislami.net" ||
        u.hostname.endsWith(".dawateislami.net"))
    );
  } catch {
    return false;
  }
}

async function fetchOfficial(
  url: string,
  timeoutMs = 12000
): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  if (!isOfficialUrl(url)) {
    return {
      ok: false,
      status: 400,
      text: "",
      url,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Dawat-e-Islami-Research-MCP/6.0 (+https://www.dawateislami.net)",
      },
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      text,
      url: response.url,
    };
  } catch {
    return {
      ok: false,
      status: 599,
      text: "",
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractLinks(html: string, prefix?: string): string[] {
  const links: string[] = [];

  const regex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const href = decodeEntities(match[1]);

    try {
      const absolute = new URL(href, OFFICIAL).toString();

      if (!isOfficialUrl(absolute)) continue;

      if (prefix && !absolute.includes(prefix)) continue;

      links.push(absolute);
    } catch {
      // ignore malformed URL
    }
  }

  return [...new Set(links)];
}

function extractTitle(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  if (h1) {
    const value = cleanHtml(h1[1]);
    if (value.length > 1) return value;
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (title) {
    return cleanHtml(title[1]).replace(/\s*\|\s*Dawat.*$/i, "").trim();
  }

  return "";
}

function extractMeta(
  html: string,
  patterns: RegExp[]
): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      const value = cleanHtml(match[1]);
      if (value) return value;
    }
  }

  return undefined;
}

function extractBookMetadata(html: string): Omit<SearchResult, "title" | "url" | "source"> {
  const plain = cleanHtml(html);

  const author =
    extractMeta(html, [
      /مصنف\s*[:：]?\s*<\/[^>]+>\s*([^<]{2,150})/i,
      /مصنف\s*[:：]?\s*([^<\n]{2,150})/i,
    ]) ??
    findAfterLabel(plain, ["مصنف", "Author"]);

  const publisher =
    extractMeta(html, [
      /پبلشر\s*[:：]?\s*([^<\n]{2,150})/i,
      /Publisher\s*[:：]?\s*([^<\n]{2,150})/i,
    ]) ??
    findAfterLabel(plain, ["پبلشر", "Publisher"]);

  const publicationDate =
    extractMeta(html, [
      /تاریخ اشاعت\s*[:：]?\s*([^<\n]{2,100})/i,
      /Publication Date\s*[:：]?\s*([^<\n]{2,100})/i,
    ]) ??
    findAfterLabel(plain, ["تاریخ اشاعت", "Publication Date"]);

  const category =
    findAfterLabel(plain, ["کیٹیگری", "Category"]) ??
    undefined;

  const pages =
    findAfterLabel(plain, [
      "آن لائن پڑھیں صفحات",
      "پی ڈی ایف صفحات",
      "Pages",
    ]) ?? undefined;

  const isbn =
    findAfterLabel(plain, ["ISBN نمبر", "ISBN"]) ?? undefined;

  return {
    author: cleanOptional(author),
    publisher: cleanOptional(publisher),
    publicationDate: cleanOptional(publicationDate),
    category: cleanOptional(category),
    pages: cleanOptional(pages),
    isbn: cleanOptional(isbn),
  };
}

function cleanOptional(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^[\s:：-]+/, "")
    .trim();

  return cleaned || undefined;
}

function findAfterLabel(
  text: string,
  labels: string[]
): string | undefined {
  for (const label of labels) {
    const index = text.toLowerCase().indexOf(label.toLowerCase());

    if (index === -1) continue;

    const after = text
      .slice(index + label.length)
      .replace(/^[\s:：-]+/, "")
      .split("\n")[0]
      .trim();

    if (after && after.length < 250) {
      return after;
    }
  }

  return undefined;
}

function excerptAround(
  text: string,
  query: string,
  maxLength = 1400
): string {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);

  const index = normalizedText.indexOf(normalizedQuery);

  if (index === -1) {
    return text.slice(0, maxLength);
  }

  const start = Math.max(0, index - 500);
  const end = Math.min(text.length, index + maxLength);

  return text.slice(start, end);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/*
 * Known official Dawat-e-Islami pages.
 *
 * These are seeds only. They are not used to fabricate search results.
 */
const KNOWN_BOOKS: SearchResult[] = [
  {
    title: "صبر کے فضائل",
    url: `${OFFICIAL}/bookslibrary/ur/sabar-kay-fazail`,
    source: "Al Madina Books Library",
    author: "Ameer-e-Ahl-e-Sunnat",
    publisher: "Maktaba-tul-Madina",
    publicationDate: "September 16, 2021",
    category:
      "Malfuzat-e-Ameer-e-Ahl-e-Sunnat, Malfuzat Ameer-e-Ahl-e-Sunnat",
    pages: "19",
    isbn: "N/A",
  },
];

const KNOWN_PORTAL: SearchResult[] = [
  {
    title: "صبر",
    url: `${OFFICIAL}/islamicportal/ur/farzuloom/sabar`,
    source: "Dawat-e-Islami Islamic Portal",
  },
];

const KNOWN_QURAN: Record<string, string[]> = {
  صبر: [
    "11:115",
    "2:153",
    "2:155",
    "3:146",
    "3:200",
    "8:46",
    "16:126",
    "16:127",
    "25:75",
    "29:59",
    "31:17",
    "32:24",
    "39:10",
    "41:35",
    "46:35",
    "52:48",
    "70:5",
    "76:12",
    "90:17",
  ],
  sabr: [
    "11:115",
    "2:153",
    "2:155",
    "3:146",
    "3:200",
    "8:46",
    "16:126",
    "16:127",
    "25:75",
    "29:59",
    "31:17",
    "32:24",
    "39:10",
    "41:35",
    "46:35",
    "52:48",
    "70:5",
    "76:12",
    "90:17",
  ],
  صابر: [
    "2:153",
    "3:146",
    "3:200",
    "8:46",
    "16:127",
    "39:10",
    "41:35",
  ],
  sabir: [
    "2:153",
    "3:146",
    "3:200",
    "8:46",
    "16:127",
    "39:10",
    "41:35",
  ],
};

const SURAH_NAMES: Record<string, string> = {
  "1": "al-fatihah",
  "2": "al-baqarah",
  "3": "al-imran",
  "4": "an-nisa",
  "5": "al-maidah",
  "6": "al-anam",
  "7": "al-araf",
  "8": "al-anfal",
  "9": "at-taubah",
  "10": "yunus",
  "11": "hud",
  "12": "yusuf",
  "13": "ar-rad",
  "14": "ibrahim",
  "15": "al-hijr",
  "16": "an-nahl",
  "17": "al-isra",
  "18": "al-kahf",
  "19": "maryam",
  "20": "ta-ha",
  "21": "al-anbiya",
  "22": "al-hajj",
  "23": "al-muminun",
  "24": "an-nur",
  "25": "al-furqan",
  "26": "ash-shuara",
  "27": "an-naml",
  "28": "al-qasas",
  "29": "al-ankabut",
  "30": "ar-rum",
  "31": "luqman",
  "32": "as-sajdah",
  "33": "al-ahzab",
  "34": "saba",
  "35": "fatir",
  "36": "ya-sin",
  "37": "as-saffat",
  "38": "sad",
  "39": "az-zumar",
  "40": "ghafir",
  "41": "fussilat",
  "42": "ash-shura",
  "43": "az-zukhruf",
  "44": "ad-dukhan",
  "45": "al-jathiyah",
  "46": "al-ahqaf",
  "47": "muhammad",
  "48": "al-fath",
  "49": "al-hujurat",
  "50": "qaf",
  "51": "adh-dhariyat",
  "52": "at-tur",
  "53": "an-najm",
  "54": "al-qamar",
  "55": "ar-rahman",
  "56": "al-waqiah",
  "57": "al-hadid",
  "58": "al-mujadilah",
  "59": "al-hashr",
  "60": "al-mumtahanah",
  "61": "as-saff",
  "62": "al-jumuah",
  "63": "al-munafiqun",
  "64": "at-taghabun",
  "65": "at-talaq",
  "66": "at-tahrim",
  "67": "al-mulk",
  "68": "al-qalam",
  "69": "al-haqqah",
  "70": "al-maarij",
  "71": "nuh",
  "72": "al-jinn",
  "73": "al-muzzammil",
  "74": "al-muddaththir",
  "75": "al-qiyamah",
  "76": "al-insan",
  "77": "al-mursalat",
  "78": "an-naba",
  "79": "an-naziat",
  "80": "abasa",
  "81": "at-takwir",
  "82": "al-infitar",
  "83": "al-mutaffifin",
  "84": "al-inshiqaq",
  "85": "al-buruj",
  "86": "at-tariq",
  "87": "al-ala",
  "88": "al-ghashiyah",
  "89": "al-fajr",
  "90": "al-balad",
  "91": "ash-shams",
  "92": "al-layl",
  "93": "ad-duha",
  "94": "ash-sharh",
  "95": "at-tin",
  "96": "al-alaq",
  "97": "al-qadr",
  "98": "al-bayyinah",
  "99": "az-zalzalah",
  "100": "al-adiyat",
  "101": "al-qariah",
  "102": "at-takathur",
  "103": "al-asr",
  "104": "al-humazah",
  "105": "al-fil",
  "106": "quraysh",
  "107": "al-maun",
  "108": "al-kawthar",
  "109": "al-kafirun",
  "110": "an-nasr",
  "111": "al-masad",
  "112": "al-ikhlas",
  "113": "al-falaq",
  "114": "an-nas",
};

function quranUrl(reference: string, tafseer = false): string {
  const [surah, ayah] = reference.split(":");
  const slug = SURAH_NAMES[surah];

  if (!slug || !ayah) {
    return `${OFFICIAL}/quran`;
  }

  const base = `${OFFICIAL}/quran/surah-${slug}/ayat-${ayah}`;

  return tafseer ? `${base}/tafseer` : base;
}

function extractSection(
  text: string,
  startMarkers: string[],
  endMarkers: string[]
): string | undefined {
  let start = -1;
  let markerLength = 0;

  for (const marker of startMarkers) {
    const i = text.indexOf(marker);

    if (i !== -1 && (start === -1 || i < start)) {
      start = i;
      markerLength = marker.length;
    }
  }

  if (start === -1) return undefined;

  const contentStart = start + markerLength;

  let end = text.length;

  for (const marker of endMarkers) {
    const i = text.indexOf(marker, contentStart);

    if (i !== -1 && i < end) {
      end = i;
    }
  }

  const result = text.slice(contentStart, end).trim();

  if (!result) return undefined;

  return result;
}

function extractQuranData(
  html: string,
  reference: string
): QuranResult {
  const text = cleanHtml(html);

  const kanzUlIman =
    extractSection(
      text,
      [
        "کنزالایمان",
        "Kanz ul Iman",
        "Kanz-ul-Imaan",
      ],
      [
        "کنزالعرفان",
        "Kanz ul Irfan",
        "Kanz-ul-Irfan",
        "تفسیر :",
        "تفسیر:",
        "Next Ayat",
        "Prev Ayat",
      ]
    ) ?? undefined;

  const kanzUlIrfan =
    extractSection(
      text,
      [
        "کنزالعرفان",
        "Kanz ul Irfan",
        "Kanz-ul-Irfan",
      ],
      [
        "تفسیر :",
        "تفسیر:",
        "Next Ayat",
        "Prev Ayat",
      ]
    ) ?? undefined;

  const siratUlJinan =
    extractSection(
      text,
      [
        "تفسیر : ‎صراط الجنان",
        "تفسیر : صراط الجنان",
        "تفسیر: صراط الجنان",
        "صراط الجنان",
      ],
      [
        "Next Ayat",
        "Prev Ayat",
        "Copyright",
      ]
    ) ?? undefined;

  const arabic = extractArabicAyah(text, reference);

  const references = extractReferences(text);

  const surahAyahMatch = text.match(
    /(?:^|\s)(\d{1,3})\.(\d{1,3})(?:\s|$)/
  );

  return {
    surah: surahAyahMatch?.[1],
    ayah: surahAyahMatch?.[2],
    arabic,
    kanzUlIman: cleanupQuranSection(kanzUlIman),
    kanzUlIrfan: cleanupQuranSection(kanzUlIrfan),
    siratUlJinan: cleanupQuranSection(siratUlJinan),
    references,
    url: quranUrl(reference, false),
    rawExcerpt: excerptAround(text, reference, 2200),
  };
}

function cleanupQuranSection(value?: string): string | undefined {
  if (!value) return undefined;

  let result = value
    .replace(/English Translation of Kanz-ul-Imaan/gi, "")
    .replace(/English Translation of Kanz-ul-Irfan/gi, "")
    .replace(/Kanz ul Iman/gi, "")
    .replace(/Kanz ul Irfan/gi, "")
    .replace(/Next Ayat/gi, "")
    .replace(/Prev Ayat/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!result) return undefined;

  // Avoid returning a huge unrelated page section.
  if (result.length > 6000) {
    result = result.slice(0, 6000).trim();
  }

  return result;
}

function extractArabicAyah(
  text: string,
  reference: string
): string | undefined {
  const [surah, ayah] = reference.split(":");

  const markerCandidates = [
    `${surah}.${ayah}`,
    `${surah} . ${ayah}`,
    `${surah}.${ayah}`,
  ];

  let index = -1;

  for (const marker of markerCandidates) {
    const i = text.indexOf(marker);

    if (i !== -1) {
      index = i;
      break;
    }
  }

  if (index === -1) return undefined;

  const after = text.slice(index + 10, index + 2500);

  const arabicMatches = after.match(
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF][\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\sۖۗۘۙۚۛۜ۝۞ۣ۟۠ۡۢۤۥۦۧۨ۩۪ۭ۫۬ۮۯ]{30,}/g
  );

  if (!arabicMatches?.length) return undefined;

  const candidate = arabicMatches[0]
    .replace(/\s+/g, " ")
    .trim();

  return candidate.length > 3000
    ? candidate.slice(0, 3000)
    : candidate;
}

function extractReferences(text: string): string[] {
  const references: string[] = [];

  const patterns = [
    /\[[0-9]+\][^.\n]{2,250}\([^)]{2,250}\)/g,
    /\([^()\n]{2,250}(?:صفحہ|جلد|vol\.|pp\.|page)[^()\n]{0,100}\)/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) ?? [];

    for (const match of matches) {
      const clean = match.replace(/\s+/g, " ").trim();

      if (clean.length > 10 && clean.length < 500) {
        references.push(clean);
      }
    }
  }

  return unique(references).slice(0, 50);
}

async function getQuranAyah(
  reference: string
): Promise<QuranResult | null> {
  const url = quranUrl(reference, true);

  const response = await fetchOfficial(url);

  if (!response.ok) {
    return null;
  }

  const result = extractQuranData(response.text, reference);

  result.url = response.url || url;

  return result;
}

async function searchBooks(query: string): Promise<SearchResult[]> {
  const normalized = normalizeText(query);
  const slug = slugifyQuery(query);

  const candidates: SearchResult[] = [];

  for (const item of KNOWN_BOOKS) {
    const haystack = normalizeText(
      `${item.title} ${item.author ?? ""} ${item.category ?? ""} ${item.url}`
    );

    if (
      haystack.includes(normalized) ||
      normalized.includes("صبر") ||
      normalized.includes("sabr") ||
      slug.includes("sabar")
    ) {
      candidates.push(item);
    }
  }

  /*
   * Search the official Al Madina Library index for links.
   * This does not trust third-party search engines.
   */
  const indexUrls = [
    `${OFFICIAL}/bookslibrary/ur`,
    `${OFFICIAL}/bookslibrary/ur/`,
  ];

  for (const indexUrl of indexUrls) {
    const response = await fetchOfficial(indexUrl, 10000);

    if (!response.ok) continue;

    const links = extractLinks(
      response.text,
      "/bookslibrary/ur/"
    );

    for (const link of links.slice(0, 250)) {
      const linkSlug = normalizeText(link);

      if (
        linkSlug.includes(normalized) ||
        linkSlug.includes(slug) ||
        (normalized.includes("صبر") && linkSlug.includes("sabar"))
      ) {
        candidates.push({
          title: "",
          url: link,
          source: "Al Madina Books Library",
        });
      }
    }
  }

  const uniqueUrls = unique(
    candidates.map((x) => x.url)
  ).slice(0, 12);

  const results: SearchResult[] = [];

  for (const candidateUrl of uniqueUrls) {
    const existing = candidates.find(
      (x) => x.url === candidateUrl
    );

    const response = await fetchOfficial(candidateUrl);

    if (!response.ok) continue;

    const title = extractTitle(response.text);

    const metadata = extractBookMetadata(response.text);

    const plain = cleanHtml(response.text);

    const queryFound =
      normalizeText(title).includes(normalized) ||
      normalizeText(plain).includes(normalized) ||
      normalized.includes("صبر") &&
        (normalizeText(title).includes("sabar") ||
          normalizeText(candidateUrl).includes("sabar"));

    if (!queryFound && title) {
      continue;
    }

    results.push({
      title:
        title ||
        existing?.title ||
        candidateUrl.split("/").pop() ||
        "Untitled",
      url: response.url || candidateUrl,
      source: "Al Madina Books Library",
      excerpt: excerptAround(plain, query, 1200),
      ...metadata,
    });
  }

  return deduplicateResults(results);
}

async function searchPortal(query: string): Promise<SearchResult[]> {
  const normalized = normalizeText(query);

  const candidates: SearchResult[] = [];

  for (const item of KNOWN_PORTAL) {
    const haystack = normalizeText(
      `${item.title} ${item.url}`
    );

    if (
      haystack.includes(normalized) ||
      normalized.includes("صبر") ||
      normalized.includes("sabr")
    ) {
      candidates.push(item);
    }
  }

  /*
   * Crawl the official Islamic Portal landing page and
   * discover relevant official links.
   */
  const pages = [
    `${OFFICIAL}/islamicportal/ur`,
    `${OFFICIAL}/islamicportal/ur/farzuloom`,
  ];

  for (const page of pages) {
    const response = await fetchOfficial(page, 10000);

    if (!response.ok) continue;

    const links = extractLinks(
      response.text,
      "/islamicportal/ur/"
    );

    for (const link of links.slice(0, 300)) {
      const linkNormalized = normalizeText(link);

      if (
        linkNormalized.includes(normalized) ||
        (normalized.includes("صبر") &&
          linkNormalized.includes("sabar"))
      ) {
        candidates.push({
          title: "",
          url: link,
          source: "Dawat-e-Islami Islamic Portal",
        });
      }
    }
  }

  const results: SearchResult[] = [];

  for (const candidate of unique(candidates.map((x) => x.url)).slice(
    0,
    15
  )) {
    const response = await fetchOfficial(candidate);

    if (!response.ok) continue;

    const plain = cleanHtml(response.text);
    const title = extractTitle(response.text);

    if (
      normalizeText(plain).includes(normalized) ||
      normalized.includes("صبر")
    ) {
      results.push({
        title:
          title ||
          candidates.find((x) => x.url === candidate)?.title ||
          "Islamic Portal",
        url: response.url || candidate,
        source: "Dawat-e-Islami Islamic Portal",
        excerpt: excerptAround(plain, query, 1800),
      });
    }
  }

  return deduplicateResults(results);
}

function deduplicateResults(
  results: SearchResult[]
): SearchResult[] {
  const seen = new Set<string>();
  const output: SearchResult[] = [];

  for (const result of results) {
    if (!result.url || seen.has(result.url)) continue;

    seen.add(result.url);
    output.push(result);
  }

  return output;
}

async function searchQuran(query: string): Promise<QuranResult[]> {
  const normalized = normalizeText(query);

  const refs =
    KNOWN_QURAN[normalized] ??
    KNOWN_QURAN[query.trim()] ??
    [];

  if (!refs.length) {
    return [];
  }

  const results: QuranResult[] = [];

  /*
   * Fetch several references in parallel but keep a reasonable limit.
   */
  const selected = refs.slice(0, 20);

  const fetched = await Promise.all(
    selected.map(async (reference) => {
      try {
        return await getQuranAyah(reference);
      } catch {
        return null;
      }
    })
  );

  for (const result of fetched) {
    if (result) results.push(result);
  }

  return results;
}

function researchPolicyText(): string {
  return `
Dawat-e-Islami Research MCP — Source Policy

1. Primary Dawat source:
   https://www.dawateislami.net/

2. Al Madina Books Library:
   https://www.dawateislami.net/bookslibrary/

3. Quran:
   https://www.dawateislami.net/quran/

4. Islamic Portal:
   https://www.dawateislami.net/islamicportal/

5. Only official Dawat-e-Islami domains are accepted by this MCP.

6. Never invent:
   - Quran Arabic
   - Kanz-ul-Iman text
   - Kanz-ul-Irfan text
   - Sirat-ul-Jinan text
   - book author
   - publisher
   - volume/page
   - hadith number
   - citation
   - publication information

7. If an official page does not expose a requested field, return that field as unavailable instead of guessing.

8. Keep source text separate from AI-generated explanation.

9. Preserve the official source URL with every result.

10. This MCP does not include Faizan-e-Madina News as a research source.

11. Quran references should use:
    (Surah name, chapter:ayah)
    e.g. (البقرۃ، 2:153)

12. For book references, only use bibliographic data actually exposed by
    the official source.

13. Search results are evidence of pages found by the MCP, not proof that
    no other official material exists.
`.trim();
}

function formatResultsForModel(
  query: string,
  books: SearchResult[],
  portal: SearchResult[],
  quran: QuranResult[]
): string {
  const output = {
    query,
    sourcePolicy: {
      officialDomainOnly: true,
      newsExcluded: true,
      fabricationForbidden: true,
    },
    quran,
    alMadinaBooks: books,
    islamicPortal: portal,
  };

  return JSON.stringify(output, null, 2);
}

function buildServer(): McpServer {
  const server = new McpServer(serverInfo);

  /*
   * 1. Source policy
   */
  server.registerTool(
    "get_research_source_policy",
    {
      description:
        "Returns the source policy and citation rules for Dawat-e-Islami research.",
      outputSchema: textOutputSchema,
    },
    async () => ({
      content: [
        {
          type: "text",
          text: researchPolicyText(),
        },
      ],
      structuredContent: {
        text: researchPolicyText(),
      },
    })
  );

  /*
   * 2. Direct Quran ayah
   */
  server.registerTool(
    "quran_ayah",
    {
      description:
        "Fetch an official Dawat-e-Islami Quran ayah page and extract Arabic, Kanz-ul-Iman, Kanz-ul-Irfan, Sirat-ul-Jinan and available references.",
      inputSchema: z.object({
        reference: z
          .string()
          .regex(/^\d{1,3}:\d{1,3}$/)
          .describe("Quran reference such as 2:153"),
      }),
      outputSchema: quranOutputSchema,
    },
    async ({ reference }) => {
      const result = await getQuranAyah(reference);

      const results = result ? [result] : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                reference,
                count: results.length,
                results,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          query: reference,
          count: results.length,
          results,
        },
      };
    }
  );

  /*
   * 3. Quran research
   */
  server.registerTool(
    "quran_research",
    {
      description:
        "Research a Quran topic using official Dawat-e-Islami Quran pages. Supports known indexed topics such as sabr/sabar.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      outputSchema: quranOutputSchema,
    },
    async ({ query }) => {
      const results = await searchQuran(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                count: results.length,
                results,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          query,
          count: results.length,
          results,
        },
      };
    }
  );

  /*
   * 4. Quran source info
   */
  server.registerTool(
    "quran_source_info",
    {
      description:
        "Returns official Dawat-e-Islami Quran source information and URL patterns.",
      outputSchema: textOutputSchema,
    },
    async () => {
      const text = `
Official Quran source:
${OFFICIAL}/quran/

Direct ayah:
${OFFICIAL}/quran/surah-<surah-slug>/ayat-<ayah>

Tafsir:
${OFFICIAL}/quran/surah-<surah-slug>/ayat-<ayah>/tafseer

The official Quran pages expose Quran Arabic and may expose:
- Kanz-ul-Iman
- Kanz-ul-Irfan
- Sirat-ul-Jinan
- related source/reference material

Important:
If a requested translation or tafsir is not actually present on the
fetched official page, the MCP must not manufacture it.
`.trim();

      return {
        content: [{ type: "text", text }],
        structuredContent: { text },
      };
    }
  );

  /*
   * 5. Combined Dawat research
   */
  server.registerTool(
    "research_dawat_sources",
    {
      description:
        "Research one question across Dawat-e-Islami Quran, Al Madina Books Library and Islamic Portal, keeping sources separated.",
      inputSchema: z.object({
        query: z.string().min(1),
        includeQuran: z.boolean().default(true),
        includeBooks: z.boolean().default(true),
        includePortal: z.boolean().default(true),
      }),
      outputSchema: textOutputSchema,
    },
    async ({
      query,
      includeQuran,
      includeBooks,
      includePortal,
    }) => {
      const [quran, books, portal] = await Promise.all([
        includeQuran ? searchQuran(query) : Promise.resolve([]),
        includeBooks ? searchBooks(query) : Promise.resolve([]),
        includePortal ? searchPortal(query) : Promise.resolve([]),
      ]);

      const text = formatResultsForModel(
        query,
        books,
        portal,
        quran
      );

      return {
        content: [{ type: "text", text }],
        structuredContent: { text },
      };
    }
  );

  /*
   * 6. Al Madina Books
   */
  server.registerTool(
    "search_dawat_books",
    {
      description:
        "Search official Dawat-e-Islami Al Madina Books Library and return verified book pages and available bibliographic metadata.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      outputSchema: searchOutputSchema,
    },
    async ({ query }) => {
      const results = await searchBooks(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                count: results.length,
                results,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          query,
          count: results.length,
          results,
        },
      };
    }
  );

  /*
   * 7. Islamic Portal
   */
  server.registerTool(
    "search_islamic_portal",
    {
      description:
        "Search official Dawat-e-Islami Islamic Portal pages and return source URLs and relevant excerpts.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      outputSchema: searchOutputSchema,
    },
    async ({ query }) => {
      const results = await searchPortal(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                count: results.length,
                results,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          query,
          count: results.length,
          results,
        },
      };
    }
  );

  /*
   * 8. Quran search
   */
  server.registerTool(
    "search_quran",
    {
      description:
        "Search the official Dawat-e-Islami Quran index for a topic and return matching ayah pages.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      outputSchema: quranOutputSchema,
    },
    async ({ query }) => {
      const results = await searchQuran(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                count: results.length,
                results,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          query,
          count: results.length,
          results,
        },
      };
    }
  );

  return server;
}

/*
 * MCP Streamable HTTP handler.
 *
 * Cloudflare Workers supports the web-standard fetch handler directly.
 */
const mcpHandler = createMcpHandler(() => buildServer());

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Allow-Methods":
      "GET, POST, DELETE, OPTIONS",
    "Access-Control-Expose-Headers":
      "Mcp-Session-Id, WWW-Authenticate",
  };
}

function addCors(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    /*
     * Only the MCP endpoint is exposed.
     */
    const url = new URL(request.url);

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", {
        status: 404,
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    try {
      const response = await mcpHandler.fetch(request);
      return addCors(response);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown MCP server error";

      return new Response(
        JSON.stringify({
          error: "MCP server error",
          message,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders(),
            "Content-Type": "application/json; charset=utf-8",
          },
        }
      );
    }
  },
};
