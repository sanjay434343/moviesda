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

  // 🧠 Helper to fetch HTML
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });
    return data;
  }

  try {
    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);

    const results = [];

    // 🔹 Extract movie listings (title, url, image)
    $("div.f").each((_, el) => {
      const title = $(el).find("a").text().trim();
      let href = $(el).find("a").attr("href");
      let img = $(el).find("img").attr("src");

      if (!href || !title) return;

      // Normalize full URLs
      if (!href.startsWith("http")) href = `${baseURL}${href}`;
      if (img && img.startsWith("/")) img = `${baseURL}${img}`;
      if (!img) img = `${baseURL}/img/dir.gif`;

      results.push({ title, url: href, img });
    });

    // 🔹 Count how many movies found
    const total = results.length;

    // 🔹 Return response
    res.status(200).json({
      source: decodeURIComponent(url),
      total,
      results,
    });
  } catch (err) {
    console.error("❌ Scrape failed:", err.message);
    res.status(500).json({
      error: "Failed to scrape movie list",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
