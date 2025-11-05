import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

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

      // Try meta tags first
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

    const movies = [];

    const items = $("div.f");
    for (const el of items) {
      const title = $(el).find("a").text().trim();
      let href = $(el).find("a").attr("href");
      if (!href || !title) continue;

      if (!href.startsWith("http")) href = `${baseURL}${href}`;

      // Fetch poster for each movie
      const poster = await getPosterImage(href);
      if (poster && poster.match(/\.(jpg|jpeg|png|webp)$/i)) {
        movies.push({ title, url: href, img: poster });
      }
    }

    res.status(200).json({
      source: decodeURIComponent(url),
      total: movies.length,
      results: movies,
    });
  } catch (err) {
    console.error("❌ Failed to scrape:", err.message);
    res.status(500).json({
      error: "Failed to scrape movie list",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
