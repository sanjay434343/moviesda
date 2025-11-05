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

  async function parseMovieList(targetURL) {
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);
    const results = [];

    $("div.f").each((_, el) => {
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

    return results;
  }

  async function extractDownloadInfo(movieUrl) {
    const html = await fetchHtml(movieUrl);
    const $ = cheerio.load(html);

    const title = $("title").text().trim();
    const results = [];

    $("div.f").each((_, el) => {
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

    // Follow into download pages for each version
    for (let i = 0; i < results.length; i++) {
      const movie = results[i];
      try {
        const subHtml = await fetchHtml(movie.url);
        const $$ = cheerio.load(subHtml);

        const dlLink = $$("a[href*='/download/']").first().attr("href");
        if (dlLink) {
          const absDL = dlLink.startsWith("http")
            ? dlLink
            : `${baseURL}${dlLink}`;
          movie.downloadPage = absDL;

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
          movie.final = [];
        }
      } catch (err) {
        console.log("❌ Failed:", movie.title, err.message);
      }
    }

    return { source: movieUrl, total: results.length, results };
  }

  try {
    let currentUrl = decodeURIComponent(url);
    let list = await parseMovieList(currentUrl);

    // 🔁 If there’s only 1 result (like “Original Movie”), auto-follow it
    if (list.length === 1 && list[0].url.includes("-original-")) {
      currentUrl = list[0].url;
      list = await parseMovieList(currentUrl);
    }

    // If still not found (i.e. we are at “original-movie”), go deep
    if (list.length === 0 || currentUrl.includes("-original-movie")) {
      const result = await extractDownloadInfo(currentUrl);
      return res.status(200).json(result);
    }

    // Otherwise, normal list
    res.status(200).json({
      source: currentUrl,
      total: list.length,
      results: list,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
