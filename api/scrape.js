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

  // 🔹 Fetch HTML safely
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

  // 🔹 Extract final CDN .mp4 from deep download page
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

  // 🔹 Extract details from download.moviespage.site
  async function extractDownloadPageData(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      const file = {
        title: $("title").text().trim(),
        img: $(".albumcover img").attr("src"),
        fileName: $(".details:contains('File Name')").text().replace("File Name:", "").trim(),
        size: $(".details:contains('File Size')").text().replace("File Size:", "").trim(),
        videoSize: $(".details:contains('Video Size')").text().replace("Video Size:", "").trim(),
        format: $(".details:contains('Format')").text().replace("Format:", "").trim(),
        duration: $(".details:contains('Duration')").text().replace("Duration:", "").trim(),
        addedOn: $(".details:contains('Added On')").text().replace("Added On:", "").trim(),
        description: $(".Tag font").text().trim() || $("meta[name='description']").attr("content") || null,
        servers: [],
        cdnLinks: []
      };

      if (file.img && file.img.startsWith("/")) {
        file.img = `${baseURL}${file.img}`;
      }

      $(".download .dlink a").each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
          file.servers.push(href.startsWith("http") ? href : `${baseURL}${href}`);
        }
      });

      // Fetch actual .mp4 links from each server
      for (const s of file.servers) {
        const cdn = await getFinalCdnUrl(s);
        if (cdn && !file.cdnLinks.includes(cdn)) {
          file.cdnLinks.push(cdn);
        }
      }

      return file;
    } catch (err) {
      console.log("❌ Error parsing download page:", err.message);
      return null;
    }
  }

  // 🔹 Extract movies, then follow to download pages
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

    const output = [];

    for (let i = 0; i < results.length; i++) {
      const movie = results[i];
      const quality = movie.title.match(/\((.*?)\)/)?.[1] || "Unknown";

      try {
        const subHtml = await fetchHtml(movie.url);
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

        const cdnUrls = [];
        let finalFile = null;

        for (const s of servers) {
          const f = await extractDownloadPageData(s);
          if (f) {
            finalFile = f;
            for (const c of f.cdnLinks) {
              if (!cdnUrls.includes(c)) cdnUrls.push(c);
            }
          }
        }

        if (finalFile) {
          output.push({
            quality,
            size: finalFile.size,
            duration: finalFile.duration,
            format: finalFile.format,
            addedOn: finalFile.addedOn,
            description: finalFile.description,
            cdn: cdnUrls.reduce((obj, link) => {
              if (link.includes("1080")) obj["1080p"] = link;
              else if (link.includes("720")) obj["720p"] = link;
              else if (link.includes("360")) obj["360p"] = link;
              else obj.other = link;
              return obj;
            }, {}),
          });
        }
      } catch (err) {
        console.log("❌ Failed at:", movie.title, err.message);
      }
    }

    const movieTitle = $("title").text().split(" ")[0] || "Movie";
    return { movie: movieTitle, results: output };
  }

  try {
    const pageHtml = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(pageHtml);
    const links = [];

    $("div.f").each((_, el) => {
      const href = $(el).find("a").attr("href");
      if (href) links.push(href.startsWith("http") ? href : `${baseURL}${href}`);
    });

    if (links.length === 1 && links[0].includes("-original-")) {
      const result = await extractMovieData(links[0]);
      return res.status(200).json(result);
    }

    if (url.includes("-original-")) {
      const result = await extractMovieData(url);
      return res.status(200).json(result);
    }

    res.status(200).json({
      error: "No original movie found",
      url: decodeURIComponent(url),
      possibleLinks: links,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
