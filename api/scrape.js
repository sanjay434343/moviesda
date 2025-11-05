import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ Allow all origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";

  // 🔹 Helper: fetch HTML
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

  // 🔹 Extract final CDN .mp4 from deep page (download.moviespage.site)
  async function getFinalCdnUrl(pageUrl) {
    try {
      const html = await fetchHtml(pageUrl);

      // 1️⃣ Direct .mp4 link
      const mp4Match = html.match(/https?:\/\/[^\s"']+\.mp4/);
      if (mp4Match) return mp4Match[0];

      // 2️⃣ iframe src
      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1].includes(".mp4")) return iframeMatch[1];

      // 3️⃣ meta refresh redirect
      const metaMatch = html.match(/<meta[^>]+url=([^"'>]+)/i);
      if (metaMatch && metaMatch[1]) return metaMatch[1];

      // 4️⃣ CDN domains (like uptodl, akamai, etc.)
      const cdnMatch = html.match(/https?:\/\/[^\s"']*(cdn|uptodl|dood|aws)[^\s"']+/i);
      if (cdnMatch) return cdnMatch[0];

      return null;
    } catch {
      return null;
    }
  }

  // 🔹 Extract all details from download.moviespage.site pages
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
        cdnLinks: [],
      };

      if (fileDetails.img && fileDetails.img.startsWith("/")) {
        fileDetails.img = `${baseURL}${fileDetails.img}`;
      }

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

      // Now go one level deeper — inside server links
      for (const server of fileDetails.servers) {
        const cdn = await getFinalCdnUrl(server.url);
        if (cdn) {
          fileDetails.cdnLinks.push({
            from: server.name,
            cdnUrl: cdn,
          });
        }
      }

      return fileDetails;
    } catch (err) {
      console.log("❌ Error in extractDownloadPageData:", err.message);
      return null;
    }
  }

  // 🔹 Extract movies + download pages
  async function extractMovieData(movieUrl) {
    const html = await fetchHtml(movieUrl);
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

          const servers = $$$(".download .dlink a")
            .map((_, el) => $$$($(el)).attr("href"))
            .get()
            .map((u) => (u.startsWith("http") ? u : `${baseURL}${u}`));

          movie.servers = servers;
          movie.final = [];

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
    // 🌐 Start scraping
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

    // Automatically follow "original movie" page
    if (links.length === 1 && links[0].url.includes("-original-")) {
      const result = await extractMovieData(links[0].url);
      return res.status(200).json(result);
    }

    if (url.includes("-original-")) {
      const result = await extractMovieData(url);
      return res.status(200).json(result);
    }

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
