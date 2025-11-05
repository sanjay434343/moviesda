import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
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

    // Movie metadata object
    const metadata = {
      title: $("title").first().text().trim() || null,
      description:
        $('meta[name="description"]').attr("content") ||
        $("p").first().text().trim() ||
        null,
      keywords: $('meta[name="keywords"]').attr("content") || null,
      date:
        $("div.details:contains('Added On')").text().replace("Added On:", "").trim() ||
        $("time").first().text().trim() ||
        null,
      image:
        $("img").first().attr("src") && $("img").first().attr("src").startsWith("http")
          ? $("img").first().attr("src")
          : $("img").first().attr("src")
          ? `https://moviesda14.com${$("img").first().attr("src")}`
          : null,
    };

    // Case 1️⃣: Movie list page (div.f)
    if ($("div.f").length > 0) {
      $("div.f").each((i, el) => {
        const title = $(el).find("a").text().trim();
        const href = $(el).find("a").attr("href");
        const imgSrc = $(el).find("img").attr("src");

        if (title && href) {
          results.push({
            title,
            url: href.startsWith("http")
              ? href
              : `https://moviesda14.com${href}`,
            img: imgSrc
              ? imgSrc.startsWith("http")
                ? imgSrc
                : `https://moviesda14.com${imgSrc}`
              : null,
          });
        }
      });
    }

    // Case 2️⃣: Movie download info or final file page
    else if ($("div.bf").length > 0) {
      const poster = $("div.albumcover img").attr("src");
      const absolutePoster = poster
        ? poster.startsWith("http")
          ? poster
          : `https://moviesda14.com${poster}`
        : null;

      // Extract "File Name" and "File Size" lines
      const fileDetails = {};
      $("div.details").each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes("File Name")) fileDetails.fileName = text.replace("File Name:", "").trim();
        if (text.includes("File Size")) fileDetails.fileSize = text.replace("File Size:", "").trim();
        if (text.includes("Duration")) fileDetails.duration = text.replace("Duration:", "").trim();
        if (text.includes("Video Resolution"))
          fileDetails.resolution = text.replace("Video Resolution:", "").trim();
      });

      // Extract all download and watch links
      $("div.download a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");

        // Skip social/share links
        if (
          href &&
          !href.includes("facebook") &&
          !href.includes("twitter") &&
          !href.includes("whatsapp")
        ) {
          results.push({
            title,
            url: href.startsWith("http")
              ? href
              : `https://moviesda14.com${href}`,
            img: absolutePoster,
          });
        }
      });

      // Include metadata info
      if (Object.keys(fileDetails).length > 0) {
        results.push({
          title: fileDetails.fileName || metadata.title,
          description: metadata.description,
          date: metadata.date,
          fileSize: fileDetails.fileSize,
          duration: fileDetails.duration,
          resolution: fileDetails.resolution,
          poster: absolutePoster,
        });
      }
    }

    // Case 3️⃣: Fallback for simple <a> based page
    else {
      $("a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href");

        if (
          href &&
          !href.includes("facebook") &&
          !href.includes("twitter") &&
          !href.includes("whatsapp") &&
          title.length > 2
        ) {
          results.push({ title, url: href });
        }
      });
    }

    // Return metadata and results
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
