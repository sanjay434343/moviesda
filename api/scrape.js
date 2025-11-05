import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing ?url parameter" });
  }

  const targetURL = decodeURIComponent(url);

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

  try {
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);

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
        $("img.albumcover").attr("src") ||
        $("img").first().attr("src") ||
        null,
      file: {
        name: $("div.details:contains('File Name')").text().replace("File Name:", "").trim(),
        size: $("div.details:contains('File Size')").text().replace("File Size:", "").trim(),
        duration: $("div.details:contains('Duration')").text().replace("Duration:", "").trim(),
        resolution: $("div.details:contains('Video Resolution')").text().replace("Video Resolution:", "").trim(),
        format: $("div.details:contains('Download Format')").text().replace("Download Format:", "").trim(),
        date: $("div.details:contains('Added On')").text().replace("Added On:", "").trim(),
      },
    };

    // Fix relative image URLs
    if (metadata.image && metadata.image.startsWith("/")) {
      metadata.image = `${new URL(targetURL).origin}${metadata.image}`;
    }

    // 🎯 Extract download servers
    const servers = [];
    $(".download .dlink a").each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href");
      if (href && href.includes("movies.downloadpage.site")) {
        const full = href.startsWith("http")
          ? href
          : `${new URL(targetURL).origin}${href}`;
        servers.push({ server: name, url: full });
      }
    });

    // ✅ Return clean JSON
    res.status(200).json({
      source: targetURL,
      metadata,
      total: servers.length,
      results: servers,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape download page",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
