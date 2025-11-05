import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  const baseURL = "https://moviesda14.com";
  if (!url) {
    return res.status(400).json({ error: "Missing ?url parameter" });
  }

  // 🧩 Helper: Safe HTML fetcher
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });
    return data;
  }

  try {
    // 🌐 Step 1: Fetch the main movie page (e.g. chengalpattu-2025-tamil-movie)
    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);
    const results = [];

    // 🎬 Step 2: Get sub-movie links (720p, 360p, etc.)
    $("div.f").each((i, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      const img = $(el).find("img").attr("src");

      if (href && title) {
        results.push({
          title,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
          img: img ? `${baseURL}${img}` : null,
        });
      }
    });

    // 🧩 Step 3: For each quality version, go inside and get the download page + servers
    for (let i = 0; i < results.length; i++) {
      const movie = results[i];

      try {
        // Fetch subpage (e.g. 720p or 360p movie page)
        const subHtml = await fetchHtml(movie.url);
        const $$ = cheerio.load(subHtml);

        // Find the main download page link
        const dlLink = $$("a[href*='/download/']").first().attr("href");
        if (dlLink) {
          const absDL = dlLink.startsWith("http")
            ? dlLink
            : `${baseURL}${dlLink}`;
          movie.downloadPage = absDL;

          // Step 4: Go into that download page and extract server URLs
          const dlHtml = await fetchHtml(absDL);
          const $$$ = cheerio.load(dlHtml);

          const servers = [];
          $$$(".download .dlink a").each((_, el) => {
            const href = $$$($(el)).attr("href");
            if (href) {
              servers.push(
                href.startsWith("http") ? href : `${baseURL}${href}`
              );
            }
          });

          movie.servers = servers;
          movie.final = []; // placeholder (no CDN crawl in this mode)
        }
      } catch (err) {
        console.log("Failed to process:", movie.title, err.message);
      }
    }

    // ✅ Return clean structured data
    res.status(200).json({
      source: decodeURIComponent(url),
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
