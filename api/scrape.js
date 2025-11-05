import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight (OPTIONS) request quickly
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const targetURL = "https://moviesda14.com/tamil-2021-movies/";

  try {
    // Fetch HTML content
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const $ = cheerio.load(html);

    // Scrape all movie links
    const results = [];

    $("a").each((i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href");

      if (href && href.includes("moviesda14.com") && title.length > 2) {
        results.push({
          title,
          url: href,
        });
      }
    });

    // Send full HTML and extracted data
    res.status(200).json({
      source: targetURL,
      total: results.length,
      results,
      html: html.substring(0, 5000) + "... [trimmed for safety]"
    });

  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message
    });
  }
}
