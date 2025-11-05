import axios from "axios";
import * as cheerio from "cheerio";

// Cache to avoid re-scraping same URLs
const urlCache = new Map();

// Helper to make requests with retry logic
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
          Referer: "https://google.com",
        },
        timeout: 10000,
      });
      return data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Extract metadata from page
function extractMetadata($, url) {
  const metadata = {
    title:
      $("title").text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text().trim() ||
      null,
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      $("p").first().text().trim() ||
      null,
    image:
      $('meta[property="og:image"]').attr("content") ||
      $("img.poster, img.thumbnail, .movie-poster img, img[itemprop='image']")
        .first()
        .attr("src") ||
      $("img").first().attr("src") ||
      null,
    date:
      $("div.details:contains('Added On'), .date, .release-date, time")
        .first()
        .text()
        .replace(/Added On:|Date:|Released:/gi, "")
        .trim() ||
      $("time").first().text().trim() ||
      null,
    size:
      $("div.details:contains('File Size'), .file-size, .size")
        .first()
        .text()
        .replace(/File Size:|Size:/gi, "")
        .trim() ||
      null,
    duration:
      $("div.details:contains('Duration'), .duration, .runtime")
        .first()
        .text()
        .replace(/Duration:|Runtime:/gi, "")
        .trim() ||
      null,
    resolution:
      $(
        "div.details:contains('Resolution'), div.details:contains('Video Resolution'), .resolution, .quality"
      )
        .first()
        .text()
        .replace(/Resolution:|Video Resolution:|Quality:/gi, "")
        .trim() ||
      null,
  };

  // Normalize image URLs
  if (metadata.image && metadata.image.startsWith("/")) {
    const base = new URL(url).origin;
    metadata.image = `${base}${metadata.image}`;
  }

  return metadata;
}

// Check if URL is a final download/stream link
function isFinalLink(url, text) {
  const downloadPatterns = [
    /\.mp4$/i,
    /\.mkv$/i,
    /\.avi$/i,
    /cdn.*download/i,
    /uptodl\.ch/i,
    /download\.php/i,
    /stream.*hash=/i,
  ];

  return downloadPatterns.some((pattern) => pattern.test(url));
}

// Extract links from page
function extractLinks($, baseUrl, depth) {
  const ignoreList = [
    "facebook",
    "twitter",
    "whatsapp",
    "telegram",
    "sms",
    "dmca",
    "contact",
    "home",
    "privacy",
    "terms",
    "disclaimer",
  ];

  const links = [];
  const seenUrls = new Set();

  $("a").each((i, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();

    if (!href || !text || text.length < 2) return;

    // Skip ignored patterns
    if (ignoreList.some((bad) => href.toLowerCase().includes(bad))) return;

    // Build full URL
    let fullUrl;
    try {
      fullUrl = href.startsWith("http")
        ? href
        : new URL(href, baseUrl).href;
    } catch {
      return;
    }

    // Avoid duplicates
    if (seenUrls.has(fullUrl)) return;
    seenUrls.add(fullUrl);

    // Check if it's a relevant link
    const isRelevant =
      href.includes("download") ||
      href.includes("stream") ||
      href.includes("watch") ||
      href.includes("play") ||
      href.includes("server") ||
      text.toLowerCase().includes("download") ||
      text.toLowerCase().includes("watch") ||
      text.toLowerCase().includes("server");

    if (isRelevant) {
      links.push({
        title: text,
        url: fullUrl,
        isFinal: isFinalLink(fullUrl, text),
      });
    }
  });

  return links;
}

// Recursively crawl until we find final download links
async function crawlPage(url, maxDepth = 3, currentDepth = 0, visited = new Set()) {
  // Prevent infinite loops
  if (currentDepth >= maxDepth || visited.has(url)) {
    return null;
  }

  visited.add(url);

  // Check cache
  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  console.log(`[Depth ${currentDepth}] Crawling: ${url}`);

  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    // Extract metadata
    const metadata = extractMetadata($, url);

    // Extract links
    const links = extractLinks($, url, currentDepth);

    // Separate final links from intermediate ones
    const finalLinks = links.filter((l) => l.isFinal);
    const intermediateLinks = links.filter((l) => !l.isFinal);

    // If we found final download links, return immediately
    if (finalLinks.length > 0) {
      const result = {
        source: url,
        metadata,
        total: finalLinks.length,
        results: finalLinks.map((link) => ({
          title: link.title,
          url: link.url,
          img: metadata.image,
        })),
      };

      urlCache.set(url, result);
      return result;
    }

    // Otherwise, crawl intermediate links (limit to 5 per level)
    if (intermediateLinks.length > 0 && currentDepth < maxDepth) {
      for (const link of intermediateLinks.slice(0, 5)) {
        const result = await crawlPage(
          link.url,
          maxDepth,
          currentDepth + 1,
          visited
        );

        // If we found final links in a child page, return it
        if (result && result.results && result.results.length > 0) {
          // Merge metadata from parent if child is missing data
          if (!result.metadata.image && metadata.image) {
            result.metadata.image = metadata.image;
            result.results.forEach((r) => (r.img = metadata.image));
          }
          if (!result.metadata.title && metadata.title) {
            result.metadata.title = metadata.title;
          }

          return result;
        }
      }
    }

    // If we got here, we didn't find final links
    // Return what we have so far
    const result = {
      source: url,
      metadata,
      total: links.length,
      results: links.slice(0, 10).map((link) => ({
        title: link.title,
        url: link.url,
        img: metadata.image,
      })),
    };

    urlCache.set(url, result);
    return result;
  } catch (err) {
    console.error(`Error crawling ${url}:`, err.message);
    return null;
  }
}

// API Handler
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, depth = 3 } = req.query;

  if (!url) {
    return res.status(400).json({
      error: "Missing URL parameter",
      usage: "/api/scrape?url=https://example.com&depth=3",
    });
  }

  const targetURL = decodeURIComponent(url);
  const maxDepth = Math.min(parseInt(depth) || 3, 5); // Cap at 5 levels

  try {
    console.log(`Starting crawl for: ${targetURL}`);
    const result = await crawlPage(targetURL, maxDepth);

    if (!result) {
      return res.status(404).json({
        error: "Could not extract data from URL",
        source: targetURL,
      });
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: targetURL,
    });
  }
}
