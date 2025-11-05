import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";
  const targetURL = decodeURIComponent(url);

  // 🧩 Helper: Fetch page safely
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });
    return data;
  }

  // 🧩 Helper: Extract file download data
  async function extractFilePage(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      const fileDetails = {
        title:
          $("title").text().trim() ||
          $('meta[property="og:title"]').attr("content") ||
          null,
        description:
          $('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          null,
        poster:
          $("img").first().attr("src") &&
          ($("img").first().attr("src").startsWith("http")
            ? $("img").first().attr("src")
            : `${new URL(downloadPageUrl).origin}${$("img").first().attr("src")}`),
        file: {
          name: $("div.details:contains('File Name')").text().replace("File Name:", "").trim(),
          size: $("div.details:contains('File Size')").text().replace("File Size:", "").trim(),
          duration: $("div.details:contains('Duration')").text().replace("Duration:", "").trim(),
          resolution: $("div.details:contains('Video Resolution')").text().replace("Video Resolution:", "").trim(),
          format: $("div.details:contains('Format')").text().replace("Format:", "").trim(),
          date: $("div.details:contains('Added On')").text().replace("Added On:", "").trim(),
        },
        servers: [],
      };

      $(".download .dlink a").each((_, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr("href");
        if (href) {
          const full = href.startsWith("http")
            ? href
            : `${new URL(downloadPageUrl).origin}${href}`;
          fileDetails.servers.push({ server: name, url: full });
        }
      });

      return fileDetails;
    } catch {
      return null;
    }
  }

  try {
    // 1️⃣ Step: Fetch the given movie page
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);

    // Extract poster and meta
    const metadata = {
      title:
        $("title").text().trim() ||
        $('meta[property="og:title"]').attr("content") ||
        null,
      description:
        $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        null,
      image:
        $('meta[property="og:image"]').attr("content") ||
        $("img").first().attr("src") ||
        null,
    };
    if (metadata.image && metadata.image.startsWith("/")) {
      metadata.image = `${baseURL}${metadata.image}`;
    }

    // 2️⃣ Step: Find download page links (https://download.moviespage.site/download/page/xxxx)
    const downloadLinks = [];
    $("a[href*='download.moviespage.site/download/page/']").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.includes("download/page/")) {
        const abs = href.startsWith("http")
          ? href
          : `${new URL(targetURL).origin}${href}`;
        downloadLinks.push(abs);
      }
    });

    // 3️⃣ Step: Fetch and parse each download page
    const allFiles = [];
    for (const link of downloadLinks) {
      const info = await extractFilePage(link);
      if (info) allFiles.push(info);
    }

    // 4️⃣ If no direct download links, return base info
    if (allFiles.length === 0) {
      return res.status(200).json({
        source: targetURL,
        metadata,
        total: 0,
        results: [],
      });
    }

    // ✅ Final structured result
    res.status(200).json({
      source: targetURL,
      total: allFiles.length,
      results: allFiles,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape",
      details: err.message,
      source: targetURL,
    });
  }
}
