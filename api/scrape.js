import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS headers for all origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  const targetURL = url
    ? decodeURIComponent(url)
    : "https://moviesda14.com/tamil-2021-movies/";

  try {
    // Fetch HTML content
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://google.com",
      },
    });

    const $ = cheerio.load(html);
    const results = [];

    // Case 1️⃣: Movie list page (div.f)
    if ($("div.f").length > 0) {
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

          results.push({ title, url: absoluteURL, img: absoluteImg });
        }
      });
    }

    // Case 2️⃣: Movie download page (div.bf)
    else if ($("div.bf").length > 0) {
      const img = $("div.albumcover img").attr("src");
      const fileTitle = $("div.details strong")
        .first()
        .parent()
        .text()
        .trim()
        .replace("File Name:", "")
        .trim();

      // Extract download server links
      $("div.download .dlink a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");

        if (href) {
          const absoluteURL = href.startsWith("http")
            ? href
            : `https://moviesda14.com${href}`;
          const absoluteImg = img
            ? img.startsWith("http")
              ? img
              : `https://moviesda14.com${img}`
            : null;

          results.push({
            title,
            url: absoluteURL,
            img: absoluteImg,
          });
        }
      });
    }

    // Case 3️⃣: Download page or other links (fallback)
    else {
      $("a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");

        if (href && title.length > 2) {
          const absoluteURL = href.startsWith("http")
            ? href
            : `https://moviesda14.com${href}`;

          results.push({ title, url: absoluteURL });
        }
      });
    }

    // Respond with results
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
