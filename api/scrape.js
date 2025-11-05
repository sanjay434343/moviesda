import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
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

  // 🧩 Helper function: fetch HTML
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });
    return data;
  }

  // 🧩 Extract poster image from a movie page
  function extractPosterFromHtml(html, pageUrl) {
    const $ = cheerio.load(html);
    const candidates = [
      $('meta[property="og:image"]').attr("content"),
      $('meta[name="og:image"]').attr("content"),
      $("picture source[type='image/webp']").attr("srcset"),
      $("picture source[type='image/jpeg']").attr("srcset"),
      $("picture img").attr("src"),
      $(".movie-info-container img").attr("src"),
      $("img.wp-post-image").attr("src"),
      $("img").first().attr("src"),
    ];

    for (const c of candidates) {
      if (c && c.length > 5) {
        if (c.startsWith("http")) return c;
        if (c.startsWith("//")) return `https:${c}`;
        if (c.startsWith("/")) return `${new URL(pageUrl).origin}${c}`;
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
    // 🌐 Fetch listing page
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);
    const results = [];

    // 🎬 Metadata
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

    // 🎥 Extract movies from div.f
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const img = $(el).find("img").attr("src");

      if (href && title && !title.toLowerCase().includes("movies")) {
        const fullUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
        const image = img
          ? img.startsWith("http")
            ? img
            : `${baseURL}${img}`
          : metadata.image;

        results.push({
          title,
          url: fullUrl,
          img: image,
        });
      }
    });

    // 🔁 If .f empty, fallback to <a href="*-movie/">
    if (results.length === 0) {
      $("a[href*='-movie']").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");
        if (href && title) {
          const fullUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
          results.push({ title, url: fullUrl, img: metadata.image });
        }
      });
    }

    // 📄 Pagination (only minimal info)
    const currentPage = $("#currentPage").text().trim() || null;
    const totalPages = $("#totalPages").text().trim() || null;

    // 🎞 If enabled, follow each movie link to get real poster
    if (shouldFollow && results.length > 0) {
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        try {
          const movieHtml = await fetchHtml(item.url);
          const poster = extractPosterFromHtml(movieHtml, item.url);
          if (poster) item.img = poster;
        } catch {
          // skip failed pages silently
        }
      }
    }

    // ✅ Send clean response
    res.status(200).json({
      source: targetURL,
      metadata,
      pagination: {
        currentPage,
        totalPages,
      },
      total: results.length,
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
