import axios from "axios";
import * as cheerio from "cheerio";

/**
 * /api/scrape?url=... or ?lang=tamil&year=2025
 * Optional: ?follow=false to skip fetching each movie page for posters
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, lang, year, search, date, follow = "true" } = req.query;
  const shouldFollow = String(follow).toLowerCase() !== "false";

  const baseURL = "https://moviesda14.com";
  const language = lang || search || "tamil";
  const yearOrDate = year || date || "2025";

  const targetURL = url
    ? decodeURIComponent(url)
    : `${baseURL}/${language}-${yearOrDate}-movies/`;

  // small helper to fetch HTML with headers
  async function fetchHtml(u) {
    try {
      const { data } = await axios.get(u, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
          Referer: "https://google.com",
        },
        timeout: 12000,
      });
      return data;
    } catch (e) {
      // bubble up
      throw new Error(`Failed to fetch ${u} — ${e.message}`);
    }
  }

  // Extract best poster from a movie page's HTML
  function extractPosterFromHtml(html, pageUrl) {
    const $ = cheerio.load(html);

    // Try multiple selectors in order of reliability
    const candidates = [
      $('meta[property="og:image"]').attr("content"),
      $('meta[name="og:image"]').attr("content"),
      $('picture source[type="image/webp"]').attr("srcset"),
      $('picture source[type="image/jpeg"]').attr("srcset"),
      $("picture img").attr("src"),
      $("div.movie-info-container img").attr("src"),
      $("img.wp-post-image").attr("src"),
      $("img").first().attr("src"),
    ];

    for (const c of candidates) {
      if (c && typeof c === "string" && c.trim().length > 5) {
        // Convert relative to absolute
        if (c.startsWith("//")) return `https:${c}`;
        if (c.startsWith("http")) return c;
        if (c.startsWith("/")) {
          try {
            const origin = new URL(pageUrl).origin;
            return `${origin}${c}`;
          } catch {
            return `${baseURL}${c}`;
          }
        }
        // sometimes srcset contains multiple values (comma separated)
        if (c.includes(",")) {
          const first = c.split(",")[0].trim().split(" ")[0];
          if (first.startsWith("http")) return first;
          if (first.startsWith("/")) return `${new URL(pageUrl).origin}${first}`;
        }
        return c;
      }
    }
    return null;
  }

  try {
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);
    const results = [];

    // Metadata
    const metadata = {
      title:
        $("title").text().trim() ||
        $('meta[property="og:title"]').attr("content") ||
        null,
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $("p").first().text().trim() ||
        null,
      image:
        $('meta[property="og:image"]').attr("content") ||
        $("img").first().attr("src") ||
        null,
    };

    if (metadata.image && metadata.image.startsWith("/")) {
      metadata.image = `${new URL(targetURL).origin}${metadata.image}`;
    }

    // Primary extraction: div.f blocks
    $("div.f").each((i, el) => {
      const anchor = $(el).find("a").first();
      const title = anchor.text().trim();
      const href = anchor.attr("href");
      const imgSrc = $(el).find("img").attr("src");

      if (href && title && !title.toLowerCase().includes("movies")) {
        const urlFull = href.startsWith("http") ? href : `${baseURL}${href}`;
        const img = imgSrc
          ? imgSrc.startsWith("http")
            ? imgSrc
            : `${baseURL}${imgSrc}`
          : metadata.image;

        results.push({
          title,
          url: urlFull,
          img,
        });
      }
    });

    // If none found, try div.bf anchors
    if (results.length === 0) {
      $("div.bf a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");
        if (href && title && href.includes("-movie")) {
          results.push({
            title,
            url: href.startsWith("http") ? href : `${baseURL}${href}`,
            img: metadata.image,
          });
        }
      });
    }

    // Fallback: any anchor with "-movie"
    if (results.length === 0) {
      $("a[href*='-movie']").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");
        if (href && title) {
          results.push({
            title,
            url: href.startsWith("http") ? href : `${baseURL}${href}`,
            img: metadata.image,
          });
        }
      });
    }

    // Pagination detection (unchanged)
    const pagination = {
      current: $("#currentPage").text().trim() || null,
      total: $("#totalPages").text().trim() || null,
      next: null,
      prev: null,
      pages: [],
    };
    $("ul.pagination a").each((i, el) => {
      const pageText = $(el).text().trim();
      const href = $(el).attr("href");
      if (!href) return;
      const full = href.startsWith("http") ? href : `${baseURL}${href}`;
      if (pageText === "»" || $(el).hasClass("next")) pagination.next = full;
      else if (pageText === "«" || $(el).hasClass("prev")) pagination.prev = full;
      else if (/^\d+$/.test(pageText)) pagination.pages.push({ page: Number(pageText), url: full });
    });

    // If user asked to follow each movie for correct poster, do it.
    if (shouldFollow && results.length > 0) {
      // To avoid hammering the site, do sequential requests here.
      // If you want speed, convert to Promise.all with concurrency control.
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        try {
          const movieHtml = await fetchHtml(item.url);
          const poster = extractPosterFromHtml(movieHtml, item.url);
          if (poster) item.img = poster;
        } catch (e) {
          // keep existing img if follow fails for that item
          // console.warn(e.message);
        }
      }
    }

    res.status(200).json({
      source: targetURL,
      metadata,
      total: results.length,
      pagination,
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: targetURL,
    });
  }
}
