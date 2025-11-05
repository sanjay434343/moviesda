import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  const baseURL = "https://moviesda14.com";
  const targetURL = url ? decodeURIComponent(url) : `${baseURL}/`;

  try {
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);

    // ✅ Metadata
    const metadata = {
      title:
        $("title").text().trim() ||
        $('meta[property="og:title"]').attr("content") ||
        null,
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        null,
      poster: null,
    };

    // Detect main poster (usually inside .albumcover img)
    const poster = $(".albumcover img").attr("src") || $("img").first().attr("src");
    if (poster) {
      metadata.poster = poster.startsWith("http")
        ? poster
        : `${baseURL}${poster}`;
    }

    // 🎬 Movie information
    const movie = {};
    $("div.details").each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes("File Name:"))
        movie.name = text.replace("File Name:", "").trim();
      else if (text.includes("File Size:"))
        movie.size = text.replace("File Size:", "").trim();
      else if (text.includes("Duration:"))
        movie.duration = text.replace("Duration:", "").trim();
      else if (text.includes("Video Resolution:"))
        movie.resolution = text.replace("Video Resolution:", "").trim();
      else if (text.includes("Download Format:"))
        movie.format = text.replace("Download Format:", "").trim();
      else if (text.includes("Added On:"))
        movie.addedOn = text.replace("Added On:", "").trim();
    });

    // ✅ Extract download server links
    const downloads = [];
    $(".download .dlink a").each((i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href");
      if (href) {
        const absUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
        downloads.push({
          server: title,
          url: absUrl,
        });
      }
    });

    // ✅ Tags (from .Tag or incoming-search-terms)
    const tags = [];
    $(".incoming-search-terms li").each((i, el) =>
      tags.push($(el).text().trim())
    );
    if (tags.length === 0) {
      $(".Tag .green")
        .text()
        .split(/[.,]/)
        .forEach((t) => {
          if (t.trim()) tags.push(t.trim());
        });
    }

    // ✅ Final Response
    res.status(200).json({
      source: targetURL,
      metadata,
      movie,
      downloads,
      tags,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: targetURL,
    });
  }
}
