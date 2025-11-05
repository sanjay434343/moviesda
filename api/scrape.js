import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const targetURL = "https://moviesda14.com/tamil-2021-movies/";

  try {
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const $ = cheerio.load(html);
    const results = [];

    // Scrape all movie entries (each div.f contains movie link)
    $(".f a").each((i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href");

      if (href && title) {
        const absoluteURL = href.startsWith("http")
          ? href
          : `https://moviesda14.com${href}`;

        results.push({ title, url: absoluteURL });
      }
    });

    res.status(200).json({
      source: targetURL,
      total: results.length,
      results
    });

  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message
    });
  }
}
