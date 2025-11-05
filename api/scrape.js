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

  // Fetch HTML safely
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 20000,
    });
    return data;
  }

  // Extract data from final download page
  async function extractDownloadPageData(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      const fileDetails = {
        img:
          $(".albumcover img").attr("src") ||
          $('meta[property="og:image"]').attr("content") ||
          null,
        size: $(".details:contains('File Size')").text().replace("File Size:", "").trim(),
        videoSize: $(".details:contains('Video Size')").text().replace("Video Size:", "").trim(),
        format: $(".details:contains('Format')").text().replace("Format:", "").trim(),
        duration: $(".details:contains('Duration')").text().replace("Duration:", "").trim(),
        addedOn: $(".details:contains('Added On')").text().replace("Added On:", "").trim(),
        cdn: [],
        watchOnline: []
      };

      if (fileDetails.img && fileDetails.img.startsWith("/")) {
        fileDetails.img = `${baseURL}${fileDetails.img}`;
      }

      // Extract direct mp4 CDN links
      $(".download .dlink a").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;

        // Match direct CDN or hotshare links
        if (href.match(/(hotshare|dl\d+|cdn|download)/i)) {
          if (href.endsWith(".mp4") || href.includes(".mp4")) {
            fileDetails.cdn.push(href.trim());
          }
        }

        // Capture watch online links
        if (href.includes("onestream.watch")) {
          fileDetails.watchOnline.push(href.trim());
        }
      });

      // If still missing, try regex on HTML (backup mode)
      const cdnRegex = /https?:\/\/[a-zA-Z0-9./\-_]+(?:hotshare|dl\d+|cdn|moviespage)[^"'\s]+\.mp4/g;
      const found = html.match(cdnRegex);
      if (found && found.length) {
        fileDetails.cdn.push(...found);
      }

      // Deduplicate and sanitize
      fileDetails.cdn = [...new Set(fileDetails.cdn.map(l => l.trim()))];
      fileDetails.watchOnline = [...new Set(fileDetails.watchOnline.map(l => l.trim()))];

      return fileDetails;
    } catch (err) {
      console.log("❌ Error extractDownloadPageData:", err.message);
      return null;
    }
  }

  // Extract full movie data
  async function extractMovieData(movieUrl) {
    const html = await fetchHtml(movieUrl);
    const $ = cheerio.load(html);

    const movieName =
      $("title").text().replace("Full Movie Download", "").trim() || "Unknown Movie";

    let poster =
      $("div.f img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="og:image"]').attr("content") ||
      null;
    if (poster && poster.startsWith("/")) poster = `${baseURL}${poster}`;

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

    const results = {};

    for (const version of versions) {
      try {
        const subHtml = await fetchHtml(version.url);
        const $$ = cheerio.load(subHtml);
        const dlLink = $$("a[href*='/download/']").first().attr("href");
        if (!dlLink) continue;
        const absDL = dlLink.startsWith("http") ? dlLink : `${baseURL}${dlLink}`;
        const fileData = await extractDownloadPageData(absDL);
        if (!fileData) continue;

        const quality =
          version.title.match(/1080p/i)
            ? "1080p"
            : version.title.match(/720/i)
            ? "720p"
            : version.title.match(/360/i)
            ? "360p"
            : "unknown";

        results[quality] = {
          size: fileData.size || "",
          duration: fileData.duration || "",
          format: fileData.format || "",
          addedOn: fileData.addedOn || "",
          videoSize: fileData.videoSize || "",
          cdn: fileData.cdn[0] || null,
          cdnAll: fileData.cdn || [],
          watchOnline: fileData.watchOnline || []
        };
      } catch (err) {
        console.log("⚠️ Failed:", version.title, err.message);
      }
    }

    return {
      movie: movieName,
      image: poster || `${baseURL}/img/dir.gif`,
      description: `${movieName} Tamil Movie HD Download`,
      results,
    };
  }

  try {
    if (url.includes("-original-")) {
      const result = await extractMovieData(url);
      return res.status(200).json(result);
    }

    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);
    const link = $("div.f a[href*='-original-']").attr("href");
    if (link) {
      const abs = link.startsWith("http") ? link : `${baseURL}${link}`;
      const result = await extractMovieData(abs);
      return res.status(200).json(result);
    }

    res.status(200).json({ message: "No movie found" });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape",
      details: err.message,
    });
  }
}
