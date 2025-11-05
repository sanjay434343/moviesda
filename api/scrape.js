import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";

  // 🧩 Helper: Fetch HTML
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

  // 🧩 Extract final .mp4 CDN link
  async function getFinalCdnUrl(pageUrl) {
    try {
      const html = await fetchHtml(pageUrl);

      const mp4Match = html.match(/https?:\/\/[^\s"']+\.mp4/);
      if (mp4Match) return mp4Match[0];

      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1].includes(".mp4")) return iframeMatch[1];

      const metaMatch = html.match(/<meta[^>]+url=([^"'>]+)/i);
      if (metaMatch && metaMatch[1]) return metaMatch[1];

      const cdnMatch = html.match(/https?:\/\/[^\s"']*(hotshare|cdn|uptodl|aws|dood)[^\s"']+\.mp4/i);
      if (cdnMatch) return cdnMatch[0];

      return null;
    } catch {
      return null;
    }
  }

  // 🧩 Extract download page (where servers are listed)
  async function extractDownloadPageData(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      const file = {
        title: $("title").text().trim(),
        description: $(".Tag font").text().trim() || $("meta[name='description']").attr("content") || null,
        size: $(".details:contains('File Size')").text().replace("File Size:", "").trim(),
        format: $(".details:contains('Format')").text().replace("Format:", "").trim(),
        duration: $(".details:contains('Duration')").text().replace("Duration:", "").trim(),
        addedOn: $(".details:contains('Added On')").text().replace("Added On:", "").trim(),
        servers: [],
        cdnLinks: []
      };

      $(".download .dlink a").each((_, el) => {
        const href = $(el).attr("href");
        if (href) file.servers.push(href.startsWith("http") ? href : `${baseURL}${href}`);
      });

      // Follow each server to extract CDN link
      for (const s of file.servers) {
        const cdn = await getFinalCdnUrl(s);
        if (cdn && !file.cdnLinks.includes(cdn)) file.cdnLinks.push(cdn);
      }

      return file;
    } catch {
      return null;
    }
  }

  // 🧩 Extract movie and qualities
  async function extractMovieData(movieUrl) {
    const html = await fetchHtml(movieUrl);
    const $ = cheerio.load(html);

    const movieName = $("title").text().replace("Full Movie Download", "").trim() || "Movie";
    const allCdnLinks = {};

    $("div.f").each((_, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      if (href && title) allCdnLinks[title] = href.startsWith("http") ? href : `${baseURL}${href}`;
    });

    const mergedCdn = {};
    let metaData = null;

    for (const [title, href] of Object.entries(allCdnLinks)) {
      const quality = title.match(/\((.*?)\)/)?.[1] || "Unknown";

      try {
        const subHtml = await fetchHtml(href);
        const $$ = cheerio.load(subHtml);
        const dlLink = $$("a[href*='/download/']").first().attr("href");

        if (!dlLink) continue;
        const absDL = dlLink.startsWith("http") ? dlLink : `${baseURL}${dlLink}`;

        const file = await extractDownloadPageData(absDL);
        if (!file) continue;

        if (!metaData) metaData = file; // reuse first file's metadata

        // Match the CDN link to its quality label
        for (const link of file.cdnLinks) {
          if (link.includes("1080")) mergedCdn["1080p"] = link;
          else if (link.includes("720")) mergedCdn["720p"] = link;
          else if (link.includes("360")) mergedCdn["360p"] = link;
          else mergedCdn.other = link;
        }
      } catch (err) {
        console.log("❌ Failed:", err.message);
      }
    }

    return {
      movie: movieName,
      results: [
        {
          quality: "1080p HD",
          size: metaData?.size || null,
          duration: metaData?.duration || null,
          format: metaData?.format || null,
          addedOn: metaData?.addedOn || null,
          description: metaData?.description || "No description available.",
          cdn: [mergedCdn]
        }
      ]
    };
  }

  try {
    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);
    const firstLink = $("div.f a[href*='-original-']").attr("href");

    if (firstLink) {
      const result = await extractMovieData(`${baseURL}${firstLink}`);
      return res.status(200).json(result);
    }

    if (url.includes("-original-")) {
      const result = await extractMovieData(url);
      return res.status(200).json(result);
    }

    res.status(404).json({ error: "No valid movie found", source: decodeURIComponent(url) });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: decodeURIComponent(url)
    });
  }
}
