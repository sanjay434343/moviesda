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

      const cdnMatch = html.match(/https?:\/\/[^\s"']*(cdn|hotshare|uptodl|aws)[^\s"']+/i);
      if (cdnMatch) return cdnMatch[0];

      return null;
    } catch {
      return null;
    }
  }

  async function extractDownloadPageData(downloadPageUrl) {
    const html = await fetchHtml(downloadPageUrl);
    const $ = cheerio.load(html);

    const fileDetails = {
      title: $("title").text().trim() || null,
      fileName: $(".details:contains('File Name')").text().replace("File Name:", "").trim() || null,
      size: $(".details:contains('File Size')").text().replace("File Size:", "").trim() || null,
      format: $(".details:contains('Format')").text().replace("Format:", "").trim() || null,
      duration: $(".details:contains('Duration')").text().replace("Duration:", "").trim() || null,
      addedOn: $(".details:contains('Added On')").text().replace("Added On:", "").trim() || null,
      cdn: null,
    };

    // get first server link and go deeper to CDN
    const serverLink = $(".download .dlink a").first().attr("href");
    if (serverLink) {
      const absLink = serverLink.startsWith("http")
        ? serverLink
        : `${baseURL}${serverLink}`;
      fileDetails.cdn = await getFinalCdnUrl(absLink);
    }

    return fileDetails;
  }

  async function extractMovieData(movieUrl) {
    const html = await fetchHtml(movieUrl);
    const $ = cheerio.load(html);
    const results = [];

    $("div.f").each((_, el) => {
      const title = $(el).find("a").text().trim();
      const href = $(el).find("a").attr("href");
      if (href && title) {
        results.push({
          title,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
        });
      }
    });

    const simplified = [];
    for (const movie of results) {
      try {
        const subHtml = await fetchHtml(movie.url);
        const $$ = cheerio.load(subHtml);

        const dlLink = $$("a[href*='/download/']").first().attr("href");
        if (dlLink) {
          const absDL = dlLink.startsWith("http") ? dlLink : `${baseURL}${dlLink}`;
          const data = await extractDownloadPageData(absDL);

          // Simplify output for each quality
          simplified.push({
            quality: movie.title.match(/\((.*?)\)/)?.[1] || movie.title,
            size: data.size,
            duration: data.duration,
            format: data.format,
            addedOn: data.addedOn,
            cdn: data.cdn,
          });
        }
      } catch (err) {
        console.log("❌ Failed:", movie.title);
      }
    }

    return {
      movie: $("title").text().replace("Full Movie Download Moviesda", "").trim(),
      total: simplified.length,
      results: simplified,
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
      movie: $("title").text().trim(),
      total: links.length,
      results: links.map((x) => ({
        quality: x.title,
        cdn: x.url,
      })),
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
