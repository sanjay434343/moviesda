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

  async function getFinalCdnUrl(pageUrl) {
    try {
      const html = await fetchHtml(pageUrl);

      const mp4Match = html.match(/https?:\/\/[^\s"']+\.mp4/);
      if (mp4Match) return mp4Match[0];

      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1].includes(".mp4")) return iframeMatch[1];

      const metaMatch = html.match(/<meta[^>]+url=([^"'>]+)/i);
      if (metaMatch && metaMatch[1]) return metaMatch[1];

      const cdnMatch = html.match(/https?:\/\/[^\s"']*(cdn|hotshare|dl|uptodl)[^\s"']+\.mp4/i);
      if (cdnMatch) return cdnMatch[0];

      return null;
    } catch {
      return null;
    }
  }

  async function extractDownloadPageData(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      const fileDetails = {
        size: $(".details:contains('File Size')").text().replace("File Size:", "").trim(),
        format: $(".details:contains('Format')").text().replace("Format:", "").trim(),
        duration: $(".details:contains('Duration')").text().replace("Duration:", "").trim(),
        addedOn: $(".details:contains('Added On')").text().replace("Added On:", "").trim(),
        servers: [],
        cdn: [],
      };

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

      for (const server of fileDetails.servers) {
        const cdn = await getFinalCdnUrl(server.url);
        if (cdn) fileDetails.cdn.push(cdn);
      }

      return fileDetails;
    } catch {
      return null;
    }
  }

  async function extractMovieData(movieUrl) {
    const html = await fetchHtml(movieUrl);
    const $ = cheerio.load(html);

    // ✅ Capture poster from main page (not inner pages)
    const poster = $("div.f img").first().attr("src")
      ? `${baseURL}${$("div.f img").first().attr("src")}`
      : null;

    const movieName =
      $("title").text().replace("Full Movie Download", "").trim() || "Unknown Movie";

    const versions = [];

    $("div.f").each((_, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      if (href && title) {
        versions.push({
          title,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
        });
      }
    });

    const qualityMap = {};

    for (const version of versions) {
      try {
        const subHtml = await fetchHtml(version.url);
        const $$ = cheerio.load(subHtml);

        const dlLink = $$("a[href*='/download/']").first().attr("href");
        if (!dlLink) continue;

        const absDL = dlLink.startsWith("http") ? dlLink : `${baseURL}${dlLink}`;
        const dlHtml = await fetchHtml(absDL);
        const $$$ = cheerio.load(dlHtml);

        const servers = $$$(".download .dlink a")
          .map((_, el) => $$$($(el)).attr("href"))
          .get()
          .map((u) => (u.startsWith("http") ? u : `${baseURL}${u}`));

        const fileData = await extractDownloadPageData(servers[0]);
        if (!fileData) continue;

        const quality =
          version.title.match(/1080p/i)
            ? "1080p"
            : version.title.match(/720/i)
            ? "720p"
            : version.title.match(/360/i)
            ? "360p"
            : "unknown";

        qualityMap[quality] = {
          size: fileData.size,
          duration: fileData.duration,
          format: fileData.format,
          addedOn: fileData.addedOn,
          cdn: fileData.cdn[0] || null,
        };
      } catch (err) {
        console.log("⚠️ Error fetching version:", version.title, err.message);
      }
    }

    return {
      movie: movieName,
      image: poster,
      description: `${movieName} Tamil Movie HD Download`,
      results: qualityMap,
    };
  }

  try {
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

    if (links.length === 1 && links[0].url.includes("-original-")) {
      const result = await extractMovieData(links[0].url);
      return res.status(200).json(result);
    }

    if (url.includes("-original-")) {
      const result = await extractMovieData(url);
      return res.status(200).json(result);
    }

    res.status(200).json({
      movie: "Unknown",
      results: {},
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape",
      details: err.message,
    });
  }
}
