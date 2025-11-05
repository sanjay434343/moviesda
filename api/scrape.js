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
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://google.com",
      },
    });

    const $ = cheerio.load(html);
    const results = [];

    // Case 1️⃣: Movie list (div.f)
    if ($("div.f").length > 0) {
      $("div.f").each((i, el) => {
        const title = $(el).find("a").text().trim();
        const href = $(el).find("a").attr("href");
        const imgSrc = $(el).find("img").attr("src");

        if (title && href) {
          results.push({
            title,
            url: href.startsWith("http") ? href : `https://moviesda14.com${href}`,
            img: imgSrc
              ? imgSrc.startsWith("http")
                ? imgSrc
                : `https://moviesda14.com${imgSrc}`
              : null,
          });
        }
      });
    }

    // Case 2️⃣: Movie download info page (div.bf .download)
    else if ($("div.bf").length > 0 && $("div.download a").length > 0) {
      const poster =
        $("div.albumcover img").attr("src") &&
        ($("div.albumcover img").attr("src").startsWith("http")
          ? $("div.albumcover img").attr("src")
          : `https://moviesda14.com${$("div.albumcover img").attr("src")}`);

      $("div.download a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");
        if (href) {
          results.push({
            title,
            url: href.startsWith("http")
              ? href
              : `https://moviesda14.com${href}`,
            img: poster || null,
          });
        }
      });
    }

    // Case 3️⃣: Final CDN or external watch page (with direct download/stream links)
    else if ($("a[href]").length > 0) {
      $("a[href]").each((i, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim() || "External Link";
        if (
          href &&
          (href.includes("http") ||
            href.includes("cdn.") ||
            href.includes("stream") ||
            href.includes("download"))
        ) {
          results.push({
            title: text,
            url: href,
          });
        }
      });
    }

    // Fallback: No results, just return the raw HTML for debugging
    if (results.length === 0) {
      res.status(200).json({
        source: targetURL,
        total: 0,
        message: "No matches found. Check structure.",
        raw: html.substring(0, 3000) + "... [trimmed]",
      });
      return;
    }

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
