import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url)
    return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";

  // 🧠 Fetch HTML
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

  // 🎬 Get poster (.jpg, .webp, etc.)
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

    // 🧩 Extract pagination info
    const pagination = {
      current: parseInt($("#currentPage").text().trim()) || null,
      total: parseInt($("#totalPages").text().trim()) || null,
      next: null,
      prev: null,
      pages: [],
    };

    $(".pagination a").each((_, el) => {
      const pageText = $(el).text().trim();
      const href = $(el).attr("href");
      if (!href || pageText === "»" || pageText === "«") return;

      let pageNum = parseInt(pageText);
      if (isNaN(pageNum)) return;

      const fullUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
      pagination.pages.push({ page: pageNum, url: fullUrl });
    });

    const nextPage = $(".pagination a.next").attr("href");
    const prevPage = $(".pagination a.prev").attr("href");

    if (nextPage)
      pagination.next = nextPage.startsWith("http")
        ? nextPage
        : `${baseURL}${nextPage}`;
    if (prevPage)
      pagination.prev = prevPage.startsWith("http")
        ? prevPage
        : `${baseURL}${prevPage}`;

    // 🎞️ Extract movie list
    const movies = [];
    const items = $("div.f");

    for (const el of items) {
      const title = $(el).find("a").text().trim();
      let href = $(el).find("a").attr("href");
      if (!href || !title) continue;
      if (!href.startsWith("http")) href = `${baseURL}${href}`;

      const poster = await getPosterImage(href);
      if (poster && poster.match(/\.(jpg|jpeg|png|webp)$/i)) {
        movies.push({ title, url: href, img: poster });
      } else {
        // fallback to /img/dir.gif if real image not found
        movies.push({ title, url: href, img: `${baseURL}/img/dir.gif` });
      }
    }

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
