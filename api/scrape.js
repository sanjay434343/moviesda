import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, lang, year, search, date } = req.query;

  const baseURL = "https://moviesda14.com";
  const language = lang || search || "tamil";
  const yearOrDate = year || date || "2025";

  const targetURL = url
    ? decodeURIComponent(url)
    : `${baseURL}/${language}-${yearOrDate}-movies/`;

  try {
    // 🌐 Fetch HTML content
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);
    const results = [];

    // 🧠 Extract Metadata
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
        $("img").first().attr("src") &&
        ($("img").first().attr("src").startsWith("http")
          ? $("img").first().attr("src")
          : `${baseURL}${$("img").first().attr("src")}`),
    };

    // 🎬 Extract movie list from div.f blocks
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const img = $(el).find("img").attr("src");

      if (href && title && !title.toLowerCase().includes("movies")) {
        results.push({
          title,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
          img: img
            ? img.startsWith("http")
              ? img
              : `${baseURL}${img}`
            : metadata.image,
        });
      }
    });

    // 🧩 If no .f elements found, try div.bf containers
    if (results.length === 0) {
      $("div.bf a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");
        if (href && title && href.includes("-movie")) {
          results.push({
            title,
            url: href.startsWith("http") ? href : `${baseURL}${href}`,
          });
        }
      });
    }

    // 🧩 Fallback: Any <a href="*-movie/">
    if (results.length === 0) {
      $("a[href*='-movie']").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");
        if (href && title && href.includes("-movie")) {
          results.push({
            title,
            url: href.startsWith("http") ? href : `${baseURL}${href}`,
          });
        }
      });
    }

    // 🧭 Pagination detection
    const pagination = {
      current: $("#currentPage").text().trim() || "1",
      total: $("#totalPages").text().trim() || null,
      next: null,
      prev: null,
      pages: [],
    };

    $("ul.pagination a").each((i, el) => {
      const pageText = $(el).text().trim();
      const href = $(el).attr("href");

      if (href) {
        const fullLink = href.startsWith("http")
          ? href
          : `${baseURL}${href}`;

        if (pageText === "»" || $(el).hasClass("next")) {
          pagination.next = fullLink;
        } else if (pageText === "«" || $(el).hasClass("prev")) {
          pagination.prev = fullLink;
        } else if (/^\d+$/.test(pageText)) {
          pagination.pages.push({
            page: Number(pageText),
            url: fullLink,
          });
        }
      }
    });

    // ✅ Response
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
