import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  const targetURL = url
    ? decodeURIComponent(url)
    : "https://moviesda14.com/tamil-2021-movies/";

  try {
    const { data: html } = await axios.get(targetURL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });

    const $ = cheerio.load(html);
    const results = [];

    // 🎯 Extract <div class="f"> items
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const imgSrc = $(el).find("img").attr("src");

      if (title && href) {
        const absoluteURL = href.startsWith("http")
          ? href
          : `https://moviesda14.com${href}`;
        const absoluteImg = imgSrc
          ? imgSrc.startsWith("http")
            ? imgSrc
            : `https://moviesda14.com${imgSrc}`
          : null;

        results.push({
          title,
          url: absoluteURL,
          img: absoluteImg,
        });
      }
    });

    res.status(200).json({
      source: targetURL,
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
    });
  }
}
