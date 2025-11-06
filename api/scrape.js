// ✅ Vercel-ready Moviesda Scraper API
import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://moviesda14.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
};

// ⚙️ Helper: Fetch page (with fallback proxy)
async function fetchPage(url) {
  try {
    console.log(`📡 Fetching: ${url}`);
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      validateStatus: () => true,
    });

    // Handle HTTP errors
    if (response.status >= 400)
      throw new Error(`HTTP ${response.status} - ${url}`);

    // Detect Cloudflare block
    if (
      response.data.includes("Cloudflare") ||
      response.data.includes("Just a moment...")
    ) {
      console.warn(`⚠️ Blocked by Cloudflare. Using fallback proxy for ${url}`);
      const proxyRes = await axios.get(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        { headers: HEADERS }
      );
      return cheerio.load(proxyRes.data);
    }

    return cheerio.load(response.data);
  } catch (error) {
    console.error(`❌ fetchPage failed for ${url}:`, error.message);
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

// 🧩 Step 1: Get all year categories
async function getCategories() {
  const $ = await fetchPage(BASE_URL);
  const categories = [];

  $("div.f a[href*='tamil-'][href*='movies/']").each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");

    if (/\d{4}/.test(href)) {
      categories.push({
        id: i + 1,
        name: text,
        url: href.startsWith("http") ? href : BASE_URL + href,
      });
    }
  });

  return categories;
}

// 🧩 Step 2: Get movies from a category
async function getMoviesFromCategory(categoryUrl) {
  const $ = await fetchPage(categoryUrl);
  const movies = [];

  $("div.f a[href$='-tamil-movie/'], div.f a[href*='-tamil-']").each(
    (i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href");

      if (text && href && href.includes("-tamil-")) {
        movies.push({
          id: i + 1,
          name: text,
          url: href.startsWith("http") ? href : BASE_URL + href,
        });
      }
    }
  );

  return movies;
}

// 🧩 Step 3: Get movie details
async function getMovieDetails(movieUrl) {
  const $ = await fetchPage(movieUrl);
  const details = {
    title:
      $("div.line h1").text().trim() ||
      $("title").text().split("|")[0].trim(),
    director: "",
    starring: "",
    genre: "",
    rating: "",
    language: "",
    synopsis: "",
    poster: "",
    qualities: [],
  };

  $("#movie-info ul.movie-info li").each((i, el) => {
    const text = $(el).text();
    if (text.includes("Director:"))
      details.director = $(el).find("span").text().trim();
    if (text.includes("Starring:"))
      details.starring = $(el).find("span").text().trim();
    if (text.includes("Genres:"))
      details.genre = $(el).find("span").text().trim();
    if (text.includes("Movie Rating:"))
      details.rating = $(el).find("span").text().trim();
    if (text.includes("Language:"))
      details.language = $(el).find("span").text().trim();
  });

  details.synopsis = $(".movie-synopsis").text().replace("Synopsis:", "").trim();

  const posterSrc = $("#movie-info img").attr("src");
  if (posterSrc) {
    details.poster = posterSrc.startsWith("http")
      ? posterSrc
      : BASE_URL + posterSrc;
  }

  $("div.f a[href*='original-'], div.f a[href*='-hd-']").each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (href && text)
      details.qualities.push({
        id: i + 1,
        name: text,
        url: href.startsWith("http") ? href : BASE_URL + href,
      });
  });

  return details;
}

// 🧩 Step 4: Get quality options
async function getQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];

  $("div.f a").each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (
      href &&
      (text.includes("1080p") ||
        text.includes("720p") ||
        text.includes("480p") ||
        text.includes("360p"))
    ) {
      options.push({
        id: i + 1,
        name: text,
        url: href.startsWith("http") ? href : BASE_URL + href,
      });
    }
  });

  return options;
}

// 🧩 Step 5: Get download file info
async function getDownloadInfo(qualityUrl) {
  const $ = await fetchPage(qualityUrl);
  const info = {
    fileName: $(".mv-content .left ul li strong").text().trim(),
    fileSize: "",
    format: "",
    downloadPageUrl: "",
  };

  $(".mv-content .left ul li").each((i, el) => {
    const text = $(el).text();
    if (text.includes("File Size:"))
      info.fileSize = text.replace("File Size:", "").trim();
    if (text.includes("Download Format:"))
      info.format = text.replace("Download Format:", "").trim();
  });

  const link = $(".mv-content .left ul li a").attr("href");
  if (link)
    info.downloadPageUrl = link.startsWith("http") ? link : BASE_URL + link;

  return info;
}

// 🧩 Step 6: Get server links
async function getServerLinks(downloadPageUrl) {
  const $ = await fetchPage(downloadPageUrl);
  const servers = [];

  $(".download .dlink a").each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (href)
      servers.push({
        id: i + 1,
        name: text,
        url: href,
      });
  });

  return servers;
}

// 🧩 Step 7: Get final download links
async function getFinalLinks(serverUrl) {
  const $ = await fetchPage(serverUrl);
  const links = { download: [], watch: [] };

  $(".download .dlink a").each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (href && text.toLowerCase().includes("download"))
      links.download.push({ id: i + 1, name: text, url: href });
    if (href && text.toLowerCase().includes("watch"))
      links.watch.push({ id: i + 1, name: text, url: href });
  });

  return links;
}

// 🌐 Main API Handler
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const {
    action,
    categoryUrl,
    movieUrl,
    originalUrl,
    qualityUrl,
    downloadUrl,
    serverUrl,
  } = req.query;

  try {
    switch (action) {
      case "getCategories":
        return res.status(200).json({
          success: true,
          step: 1,
          message: "Categories fetched ✓",
          data: await getCategories(),
        });

      case "getMovies":
        if (!categoryUrl)
          return res.status(400).json({ error: "categoryUrl is required" });
        return res.status(200).json({
          success: true,
          step: 2,
          message: "Movies fetched ✓",
          data: await getMoviesFromCategory(categoryUrl),
        });

      case "getMovieDetails":
        if (!movieUrl)
          return res.status(400).json({ error: "movieUrl is required" });
        return res.status(200).json({
          success: true,
          step: 3,
          message: "Movie details fetched ✓",
          data: await getMovieDetails(movieUrl),
        });

      case "getQualityOptions":
        if (!originalUrl)
          return res.status(400).json({ error: "originalUrl is required" });
        return res.status(200).json({
          success: true,
          step: 4,
          message: "Quality options fetched ✓",
          data: await getQualityOptions(originalUrl),
        });

      case "getDownloadInfo":
        if (!qualityUrl)
          return res.status(400).json({ error: "qualityUrl is required" });
        return res.status(200).json({
          success: true,
          step: 5,
          message: "Download info fetched ✓",
          data: await getDownloadInfo(qualityUrl),
        });

      case "getServerLinks":
        if (!downloadUrl)
          return res.status(400).json({ error: "downloadUrl is required" });
        return res.status(200).json({
          success: true,
          step: 6,
          message: "Server links fetched ✓",
          data: await getServerLinks(downloadUrl),
        });

      case "getFinalLinks":
        if (!serverUrl)
          return res.status(400).json({ error: "serverUrl is required" });
        return res.status(200).json({
          success: true,
          step: 7,
          message: "Final download links fetched ✓",
          data: await getFinalLinks(serverUrl),
        });

      default:
        return res.status(400).json({
          success: false,
          error: "Invalid action",
          availableActions: [
            "getCategories",
            "getMovies",
            "getMovieDetails",
            "getQualityOptions",
            "getDownloadInfo",
            "getServerLinks",
            "getFinalLinks",
          ],
        });
    }
  } catch (error) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
