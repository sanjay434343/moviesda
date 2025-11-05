import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, lang, year } = req.query;

  // ✅ Construct dynamic target URL
  let targetURL;
  if (url) {
    targetURL = decodeURIComponent(url);
  } else if (lang && year) {
    targetURL = `https://moviesda14.com/${lang}-${year}-movies/`;
  } else {
    return res.status(400).json({
      error: "Missing parameters. Please provide either ?url= or ?lang= & ?year=",
    });
  }

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

    // 🎬 Metadata Extraction
    const metadata = {
      title:
        $("title").text().trim() ||
        $('meta[property="og:title"]').attr("content") ||
        null,
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $("p").first().text().trim() ||
        null,
      image:
        $('meta[property="og:image"]').attr("content") ||
        $("img").first().attr("src") ||
        null,
    };

    // ✅ Normalize image URL
    if (metadata.image && metadata.image.startsWith("/")) {
      const base = new URL(targetURL).origin;
      metadata.image = `${base}${metadata.image}`;
    }

    // 🎯 Extract only actual movie entries: <div class="f"> links
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const imgSrc = $(el).find("img").attr("src");

      // ignore empty, header, or category links
      if (
        title &&
        href &&
        !title.toLowerCase().includes("moviesda") &&
        !title.toLowerCase().includes("disclaimer") &&
        !title.toLowerCase().includes("telegram") &&
        !title.toLowerCase().includes("collection")
      ) {
        const base = new URL(targetURL).origin;
        const fullUrl = href.startsWith("http") ? href : `${base}${href}`;
        const fullImg = imgSrc
          ? imgSrc.startsWith("http")
            ? imgSrc
            : `${base}${imgSrc}`
          : null;

        results.push({
          title,
          url: fullUrl,
          img: fullImg,
        });
      }
    });

    // If no valid movie results found
    if (results.length === 0) {
      return res.status(404).json({
        source: targetURL,
        message: "No movies found for the given language/year.",
        metadata,
        total: 0,
        results: [],
      });
    }

    // ✅ Send response
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
    });
  }
}
