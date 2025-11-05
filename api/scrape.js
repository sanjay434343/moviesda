import axios from "axios";
import * as cheerio from "cheerio";

const urlCache = new Map();

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://moviesda14.com",
        },
        timeout: 15000,
        maxRedirects: 5,
      });
      return data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function extractMetadata($, url) {
  const baseUrl = new URL(url).origin;
  
  const metadata = {
    title: $("h1").first().text().trim() || 
           $("title").text().replace(/Download|Moviesda/gi, "").trim() || null,
    description: $('meta[name="description"]').attr("content") || null,
    image: $('meta[property="og:image"]').attr("content") || 
           $("img[src*='poster'], img[src*='shots']").first().attr("src") || null,
    date: $(".details div").filter((i, el) => $(el).text().includes("Added On"))
          .text().replace(/Added On:?\s*/gi, "").trim() || null,
    size: $(".details div").filter((i, el) => $(el).text().includes("File Size"))
          .text().replace(/File Size:?\s*/gi, "").trim() || null,
    duration: $(".details div").filter((i, el) => $(el).text().includes("Duration"))
              .text().replace(/Duration:?\s*/gi, "").trim() || null,
    resolution: $(".details div").filter((i, el) => 
                $(el).text().match(/Resolution|Video Quality/i))
                .text().replace(/Resolution:?\s*|Video Quality:?\s*/gi, "").trim() || null,
  };

  if (metadata.image && metadata.image.startsWith("/")) {
    metadata.image = `${baseUrl}${metadata.image}`;
  }

  return metadata;
}

function extractAllLinks($, baseUrl) {
  const links = [];
  const seenUrls = new Set();
  const ignorePatterns = /facebook|twitter|whatsapp|telegram|instagram|dmca|privacy|terms|contact|home/i;

  $("a").each((i, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();

    if (!href || ignorePatterns.test(href) || !text) return;

    let fullUrl;
    try {
      fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).href;
    } catch { return; }

    if (seenUrls.has(fullUrl)) return;
    seenUrls.add(fullUrl);

    // Detect if this is a relevant link
    const isRelevant = 
      /download|stream|watch|play|server|cdn|file|uptodl|onestream/i.test(href) ||
      /download|watch|server|play/i.test(text);

    if (isRelevant) {
      links.push({
        title: text,
        url: fullUrl,
        type: href.includes("download.moviespage") ? "intermediate" :
              href.includes("uptodl") || href.includes(".mp4") || href.includes(".mkv") ? "final" :
              href.includes("stream") || href.includes("play.onestream") ? "stream" : "unknown"
      });
    }
  });

  return links;
}

async function scrapeIntermediatePage(url, metadata) {
  console.log(`  → Scraping intermediate: ${url}`);
  
  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    // Update metadata if missing
    const pageMetadata = extractMetadata($, url);
    metadata.date = metadata.date || pageMetadata.date;
    metadata.size = metadata.size || pageMetadata.size;
    metadata.duration = metadata.duration || pageMetadata.duration;
    metadata.resolution = metadata.resolution || pageMetadata.resolution;
    metadata.image = metadata.image || pageMetadata.image;

    const links = extractAllLinks($, url);
    
    // Find final download/stream links
    const finalLinks = links.filter(l => l.type === "final" || l.type === "stream");
    
    if (finalLinks.length > 0) {
      return finalLinks.map(link => ({
        title: link.title,
        url: link.url,
        img: metadata.image
      }));
    }

    // Look for buttons or specific elements with onclick/data attributes
    const buttons = [];
    $("button, a.btn, .download-btn, .watch-btn").each((i, el) => {
      const onclick = $(el).attr("onclick");
      const dataUrl = $(el).attr("data-url");
      const href = $(el).attr("href");
      const text = $(el).text().trim();

      const targetUrl = dataUrl || href;
      if (targetUrl && targetUrl.startsWith("http")) {
        buttons.push({
          title: text || `Link ${i + 1}`,
          url: targetUrl,
          img: metadata.image
        });
      }
    });

    return buttons.length > 0 ? buttons : [];
  } catch (err) {
    console.error(`  ✗ Error on ${url}:`, err.message);
    return [];
  }
}

async function crawlPage(url, maxDepth = 2) {
  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  console.log(`\n🔍 Starting crawl: ${url}`);

  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);
    const baseUrl = new URL(url).origin;

    const metadata = extractMetadata($, url);
    const links = extractAllLinks($, url);

    console.log(`📊 Found ${links.length} links`);
    
    // Separate link types
    const finalLinks = links.filter(l => l.type === "final" || l.type === "stream");
    const intermediateLinks = links.filter(l => l.type === "intermediate");

    let results = [];

    // If we have final links, use them
    if (finalLinks.length > 0) {
      console.log(`✓ Found ${finalLinks.length} final links`);
      results = finalLinks.map(link => ({
        title: link.title,
        url: link.url,
        img: metadata.image
      }));
    } 
    // Otherwise crawl intermediate pages
    else if (intermediateLinks.length > 0 && maxDepth > 0) {
      console.log(`↪ Following ${intermediateLinks.length} intermediate links...`);
      
      for (const link of intermediateLinks.slice(0, 10)) {
        const subResults = await scrapeIntermediatePage(link.url, { ...metadata });
        results.push(...subResults);
        
        // Add small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      }
    }
    // Last resort: return all semi-relevant links
    else if (links.length > 0) {
      console.log(`⚠ No final links found, returning all available links`);
      results = links.slice(0, 10).map(link => ({
        title: link.title,
        url: link.url,
        img: metadata.image
      }));
    }

    const result = {
      source: url,
      metadata,
      total: results.length,
      results
    };

    urlCache.set(url, result);
    return result;

  } catch (err) {
    console.error(`❌ Main error on ${url}:`, err.message);
    throw err;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, depth = 2 } = req.query;

  if (!url) {
    return res.status(400).json({
      error: "Missing URL parameter",
      usage: "/api/scrape?url=https://moviesda14.com/movie&depth=2"
    });
  }

  const targetURL = decodeURIComponent(url);
  const maxDepth = Math.min(parseInt(depth) || 2, 3);

  try {
    const result = await crawlPage(targetURL, maxDepth);

    if (!result || result.total === 0) {
      return res.status(404).json({
        error: "No download links found",
        source: targetURL,
        metadata: result?.metadata || null
      });
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: targetURL
    });
  }
}
