import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 🧠 Dynamic Parameters
  const { url, lang = "tamil", year = "2021" } = req.query;

  // Construct dynamic Moviesda URL
  const baseURL = "https://moviesda14.com";
  const targetURL = url
    ? decodeURIComponent(url)
    : `${baseURL}/${lang}-${year}-movies/`;

  try {
    // 🧩 Fetch HTML
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);
    const results = [];

    // 🎬 Metadata
    const metadata = {
      title: $("title").text().trim() || null,
      description:
        $('meta[name="description"]').attr("content") ||
        $("p").first().text().trim() ||
        null,
      image: $("img").first().attr("src")
        ? $("img").first().attr("src").startsWith("http")
          ? $("img").first().attr("src")
          : `${baseURL}${$("img").first().attr("src")}`
        : null,
    };

    // 🎯 Extract actual movie entries (usually in <div class="f">)
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const imgSrc = $(el).find("img").attr("src");

      // Skip folders like "Tamil 2024 Movies"
      if (
        href &&
        title &&
        !title.toLowerCase().includes("movies") &&
        !title.toLowerCase().includes("categories")
      ) {
        const movieUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
        const movieImg = imgSrc
          ? imgSrc.startsWith("http")
            ? imgSrc
            : `${baseURL}${imgSrc}`
          : metadata.image;

        results.push({
          title,
          url: movieUrl,
          img: movieImg,
        });
      }
    });

    // 🎞 Return structured data
    res.status(200).json({
      source: targetURL,
      metadata,
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: targetURL,
    });
  }
}
