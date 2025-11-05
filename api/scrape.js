import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url)
    return res.status(400).json({ error: "Missing ?url parameter" });

  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://google.com",
      },
      timeout: 15000,
    });
    return data;
  }

  try {
    const targetURL = decodeURIComponent(url);
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);

    // 🖼️ Basic metadata
    const details = {
      source: targetURL,
      title: $("title").text().trim() || null,
      poster: $(".albumcover img").attr("src") || null,
      fileName:
        $(".details:contains('File Name')")
          .text()
          .replace("File Name:", "")
          .trim() || null,
      size:
        $(".details:contains('File Size')")
          .text()
          .replace("File Size:", "")
          .trim() || null,
      videoSize:
        $(".details:contains('Video Size')")
          .text()
          .replace("Video Size:", "")
          .trim() || null,
      format:
        $(".details:contains('Format')")
          .text()
          .replace("Format:", "")
          .trim() || null,
      duration:
        $(".details:contains('Duration')")
          .text()
          .replace("Duration:", "")
          .trim() || null,
      addedOn:
        $(".details:contains('Added On')")
          .text()
          .replace("Added On:", "")
          .trim() || null,
      downloads: [],
      watchOnline: [],
    };

    // Normalize poster URL if needed
    if (details.poster && details.poster.startsWith("/")) {
      details.poster = `https://moviesda14.com${details.poster}`;
    }

    // 🎯 File Download Links (Server 1, Server 2)
    $(".download .dlink a").each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href");
      if (href && href.includes(".mp4")) {
        details.downloads.push({
          server: name,
          url: href,
        });
      }
    });

    // 🎬 Watch Online Links (onestream or play domain)
    $(".download .dlink a").each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr("href");
      if (href && href.includes("onestream")) {
        details.watchOnline.push({
          server: name,
          url: href,
        });
      }
    });

    // ✅ Final clean response
    res.status(200).json(details);
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch or parse the page",
      details: err.message,
      source: url,
    });
  }
}
