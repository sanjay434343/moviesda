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
      date:
        $("div.details:contains('Added On')").text().replace("Added On:", "").trim() ||
        $("time").first().text().trim() ||
        null,
      size:
        $("div.details:contains('File Size')").text().replace("File Size:", "").trim() ||
        null,
      duration:
        $("div.details:contains('Duration')").text().replace("Duration:", "").trim() ||
        null,
      resolution:
        $("div.details:contains('Resolution')").text().replace("Resolution:", "").trim() ||
        $("div.details:contains('Video Resolution')").text().replace("Video Resolution:", "").trim() ||
        null,
    };

    // Normalize relative image URLs
    if (metadata.image && metadata.image.startsWith("/")) {
      const base = new URL(targetURL).origin;
      metadata.image = `${base}${metadata.image}`;
    }

    // 🎯 Extract main download and watch links (ignore junk)
    const ignoreList = [
      "facebook",
      "twitter",
      "whatsapp",
      "sms",
      "dmca",
      "contact",
      "home",
    ];

    $("a").each((i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();

      if (
        href &&
        !ignoreList.some((bad) => href.toLowerCase().includes(bad)) &&
        (href.includes("download") ||
          href.includes(".mp4") ||
          href.includes(".mkv") ||
          href.includes("cdn") ||
          href.includes("stream") ||
          href.includes("file") ||
          href.includes("watch")) &&
        text.length > 2
      ) {
        const fullUrl = href.startsWith("http")
          ? href
          : `${new URL(targetURL).origin}${href}`;

        results.push({
          title: text,
          url: fullUrl,
        });
      }
    });

    // 🎞 Include basic image or poster with each result
    if (metadata.image) {
      results.forEach((item) => (item.img = metadata.image));
    }

    // Return result
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
