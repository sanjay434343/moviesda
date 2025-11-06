import axios from "axios";
import * as cheerio from "cheerio";

// Helper to resolve relative URLs
function getAbsoluteUrl(baseURL, url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${baseURL}${url}`;
  // Defensive: if weirdly not "/" and not "http"
  return `${baseURL}/${url}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url)
    return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";

  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 20000,
    });
    return data;
  }

  async function getPosterImage(movieUrl) {
    try {
      const html = await fetchHtml(movieUrl);
      const $ = cheerio.load(html);

      let img =
        $('meta[property="og:image"]').attr("content") ||
        $('meta[name="og:image"]').attr("content") ||
        $(".albumcover img").attr("src") ||
        $(".poster img").attr("src") ||
        $("img[src*='/uploads/']").first().attr("src");

      if (!img) return null;
      if (img.startsWith("/")) img = `${baseURL}${img}`;
      if (!img.match(/\.(jpg|jpeg|png|webp)$/i)) return null;

      return img;
    } catch {
      return null;
    }
  }

  try {
    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);

    // Extract improved pagination info
    const pagination = {
      current: null,
      total: null,
      pages: [],
      next: null,
      prev: null,
    };

    // Get current page, total pages
    pagination.current = parseInt($("#currentPage").text().trim()) ||
      parseInt($(".pagination a.active").first().text().trim()) || 1;
    pagination.total = parseInt($("#totalPages").text().trim()) || null;

    // Parse available <a> in .pagination
    $(".pagination a").each(function () {
      const pageText = $(this).text().trim();
      const href = $(this).attr("href");
      // Only add if it's a page number
      if (/^\d+$/.test(pageText)) {
        pagination.pages.push({
          number: parseInt(pageText),
          url: getAbsoluteUrl(baseURL, href),
          isCurrent: $(this).hasClass("active"),
        });
      }
      // Detect next/prev
      if ($(this).hasClass("next")) {
        pagination.next = getAbsoluteUrl(baseURL, href);
      } else if ($(this).hasClass("prev")) {
        pagination.prev = getAbsoluteUrl(baseURL, href);
      }
    });
    // In some cases, prev is the previous li sibling of active
    if (!pagination.prev) {
      const active = $(".pagination a.active").parent();
      const prevLi = active.prev("li").find("a");
      if (prevLi.length) {
        pagination.prev = getAbsoluteUrl(baseURL, prevLi.attr("href"));
      }
    }
    // Defensive: add ellipsis or last page, if pagination.total is set but not all links are present
    if (pagination.total && !pagination.pages.find(p => p.number === pagination.total)) {
      pagination.pages.push({
        number: pagination.total,
        url: getAbsoluteUrl(baseURL, `/tamil-2025-movies/?page=${pagination.total}`),
        isCurrent: false,
      });
    }

    // Extract movie list with real posters, FAST (no await in main loop, asyncMap)
    const items = $("div.f");
    const movies = await Promise.all(
      items.map(async (i, el) => {
        const title = $(el).find("a").text().trim();
        let href = $(el).find("a").attr("href");
        if (!href || !title) return null;
        href = getAbsoluteUrl(baseURL, href);

        let poster = await getPosterImage(href);
        if (!(poster && poster.match(/\.(jpg|jpeg|png|webp)$/i))) {
          poster = `${baseURL}/img/dir.gif`;
        }
        return { title, url: href, img: poster };
      }).get()
    ).then(resArr => resArr.filter(Boolean));

    res.status(200).json({
      source: decodeURIComponent(url),
      total: movies.length,
      pagination,
      results: movies,
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({
      error: "Failed to scrape movie list",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
