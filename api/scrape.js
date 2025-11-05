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
  const targetURL = url ? decodeURIComponent(url) : `${baseURL}/tamil-2025-movies/`;

  try {
    const { data: html } = await axios.get(targetURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);

    // 🧠 Basic metadata
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

    // Detect if it's a movie detail page
    const isMovieDetail = $(".mv-content").length > 0 || $("div.mv-content").length > 0;

    // 🎬 Movie detail page scraping
    if (isMovieDetail) {
      const movie = {};
      const poster = $(".mv-content img").attr("src");
      const imgFull = poster?.startsWith("http")
        ? poster
        : `${baseURL}${poster}`;

      metadata.poster = imgFull;

      // Extract movie details from <ul> under .mv-content
      const ul = $(".mv-content ul li");
      ul.each((i, el) => {
        const text = $(el).text().trim();

        if (text.toLowerCase().includes("file size")) {
          movie.size = text.replace("File Size:", "").trim();
        } else if (text.toLowerCase().includes("download format")) {
          movie.format = text.replace("Download Format:", "").trim();
        } else if (text.toLowerCase().includes(".mp4")) {
          movie.name = text;
        }
      });

      // Extract download link
      const dlLink = $(".mv-content a").attr("href");
      if (dlLink)
        movie.downloadUrl = dlLink.startsWith("http")
          ? dlLink
          : `${baseURL}${dlLink}`;

      // Extract page tags / related search
      const tags = [];
      $(".incoming-search-terms li").each((i, el) => {
        tags.push($(el).text().trim());
      });

      // ✅ Send detail page data
      return res.status(200).json({
        source: targetURL,
        metadata,
        movie,
        tags,
      });
    }

    // 🎞️ Else: it's a listing page (fallback)
    const results = [];
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const img = $(el).find("img").attr("src");
      if (href && title && !title.toLowerCase().includes("movies")) {
        results.push({
          title,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
          img: img ? `${baseURL}${img}` : null,
        });
      }
    });

    const pagination = {
      currentPage: $("#currentPage").text().trim() || null,
      totalPages: $("#totalPages").text().trim() || null,
    };

    res.status(200).json({
      source: targetURL,
      metadata,
      pagination,
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
