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

  // 🧩 Helper: fetch HTML safely
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

  // 🧩 Extract file info from final download.page
  async function extractDownloadPageData(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      const fileDetails = {
        title: $("title").text().trim() || null,
        img: $(".albumcover img").attr("src") || null,
        fileName: $(".details:contains('File Name')").text().replace("File Name:", "").trim() || null,
        size: $(".details:contains('File Size')").text().replace("File Size:", "").trim() || null,
        videoSize: $(".details:contains('Video Size')").text().replace("Video Size:", "").trim() || null,
        format: $(".details:contains('Format')").text().replace("Format:", "").trim() || null,
        duration: $(".details:contains('Duration')").text().replace("Duration:", "").trim() || null,
        addedOn: $(".details:contains('Added On')").text().replace("Added On:", "").trim() || null,
        servers: [],
      };

      // Normalize image URL
      if (fileDetails.img && fileDetails.img.startsWith("/")) {
        fileDetails.img = `${baseURL}${fileDetails.img}`;
      }

      // Extract server links
      $(".download .dlink a").each((_, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr("href");
        if (href) {
          fileDetails.servers.push({
            name,
            url: href.startsWith("http") ? href : `${baseURL}${href}`,
          });
        }
      });

      return fileDetails;
    } catch (err) {
      console.log("❌ Error in extractDownloadPageData:", err.message);
      return null;
    }
  }

  // 🧩 Extract nested pages and final links
  async function extractMovieData(movieUrl) {
    const html = await fetchHtml(movieUrl);
    const $ = cheerio.load(html);

    const results = [];

    // Collect submovie versions (e.g. 720p / 360p)
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

    // For each version, go to download page
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

          // Fetch download page
          const dlHtml = await fetchHtml(absDL);
          const $$$ = cheerio.load(dlHtml);

          // Extract final servers (like https://download.moviespage.site/download/page/93206)
          const servers = $$$(".download .dlink a")
            .map((_, el) => $$$($(el)).attr("href"))
            .get()
            .map((u) => (u.startsWith("http") ? u : `${baseURL}${u}`));

          movie.servers = servers;
          movie.final = [];

          // Step into each server page (download.moviespage.site)
          for (const serverUrl of servers) {
            const fileDetails = await extractDownloadPageData(serverUrl);
            if (fileDetails) movie.final.push(fileDetails);
          }
        }
      } catch (err) {
        console.log("❌ Failed for:", movie.title, err.message);
      }
    }

    return { source: movieUrl, total: results.length, results };
  }

  try {
    // 🌐 Fetch initial page
    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);
    const links = [];

    $("div.f").each((_, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      if (href && title) {
        links.push({
          title,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
        });
      }
    });

    // If only one link (e.g. “Original Movie”), go inside automatically
    if (links.length === 1 && links[0].url.includes("-original-")) {
      const result = await extractMovieData(links[0].url);
      return res.status(200).json(result);
    }

    // If already an original movie page, go inside
    if (url.includes("-original-")) {
      const result = await extractMovieData(url);
      return res.status(200).json(result);
    }

    // Otherwise, return the first level list
    res.status(200).json({
      source: decodeURIComponent(url),
      total: links.length,
      results: links,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
