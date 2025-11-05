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

  const { url } = req.query; // optional ?url=

  try {
    const targetURL = url
      ? decodeURIComponent(url)
      : "https://moviesda14.com/tamil-2021-movies/";

    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const $ = cheerio.load(html);

    // If it's the main list page
    if (!url) {
      const results = [];

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

      return res.status(200).json({
        source: targetURL,
        total: results.length,
        results
      });
    }

    // If it's a movie-specific page
    const title = $("title").text().trim();
    const description = $('meta[name="description"]').attr("content") || "";
    const downloadLinks = [];

    $("a").each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href");

      // Only collect valid download-related links
      if (
        href &&
        (href.includes(".mp4") ||
          href.includes(".mkv") ||
          href.includes("download"))
      ) {
        const absoluteURL = href.startsWith("http")
          ? href
          : `https://moviesda14.com${href}`;
        downloadLinks.push({ text, url: absoluteURL });
      }
    });

    res.status(200).json({
      source: targetURL,
      title,
      description,
      totalLinks: downloadLinks.length,
      downloadLinks,
      rawHTML: html.substring(0, 4000) + "... [trimmed]"
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message
    });
  }
}
