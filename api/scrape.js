import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url)
    return res
      .status(400)
      .json({ error: "Missing ?url parameter (example: ?url=https://download.moviespage.site/download/page/93108)" });

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

    // 🎞 Extract metadata
    const title = $("title").text().trim();
    const image = $(".albumcover img").attr("src") || null;

    const fileName = $(".details:contains('File Name')").text().replace("File Name:", "").trim() || null;
    const size = $(".details:contains('File Size')").text().replace("File Size:", "").trim() || null;
    const resolution = $(".details:contains('Video Size')").text().replace("Video Size:", "").trim() || null;
    const format = $(".details:contains('Format')").text().replace("Format:", "").trim() || null;
    const duration = $(".details:contains('Duration')").text().replace("Duration:", "").trim() || null;
    const addedOn = $(".details:contains('Added On')").text().replace("Added On:", "").trim() || null;

    // 🧩 Extract Download Servers
    const downloadServers = [];
    $("div.dline:contains('File Download Links')")
      .next(".download")
      .find("a")
      .each((_, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr("href");
        if (href) {
          downloadServers.push({
            name,
            url: href.startsWith("http") ? href : new URL(href, targetURL).href,
          });
        }
      });

    // 🎥 Extract Watch Online Servers
    const watchServers = [];
    $("div.dline:contains('Watch Online Links')")
      .next(".download")
      .find("a")
      .each((_, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr("href");
        if (href) {
          watchServers.push({
            name,
            url: href.startsWith("http") ? href : new URL(href, targetURL).href,
          });
        }
      });

    // ✅ Build response
    const result = {
      source: targetURL,
      title,
      image,
      file: {
        name: fileName,
        size,
        resolution,
        format,
        duration,
        addedOn,
      },
      downloadServers,
      watchServers,
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      error: "Failed to parse page",
      details: err.message,
      source: url,
    });
  }
}
