// Google News's RSS search feed is public and needs no key/auth, which
// makes it a more reliable news source in this app than trying to scrape
// an authenticated news API. Trade-off: it's a general news aggregator,
// not finance-specialist, so results can occasionally include tangential
// stories that merely mention the company/sector name.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return "";
  return decodeXmlEntities(match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim());
}

export async function fetchGoogleNews(query, max = 8) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml" },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    return items.slice(0, max).map((block) => ({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate"),
      source: extractTag(block, "source"),
    }));
  } catch {
    return [];
  }
}
