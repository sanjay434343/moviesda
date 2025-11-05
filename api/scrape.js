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
    return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";
  const targetURL = decodeURIComponent(url);

  // 🧠 Helper: Fetch HTML safely
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://google.com",
      },
      timeout: 20000,
    });
    return data;
  }

  // 🎬 Helper: Extract final .mp4 from CDN or redirect page
  async function getFinalCdnUrl(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      // Case 1: Direct <a href="*.mp4">
      const mp4Links = $("a[href*='.mp4']")
        .map((i, el) => $(el).attr("href"))
        .get();
      if (mp4Links.length > 0)
        return mp4Links.find((l) => l.endsWith(".mp4")) || mp4Links[0];

      // Case 2: inside iframe
      const iframeSrc = $("iframe").attr("src");
      if (iframeSrc?.includes(".mp4")) return iframeSrc;

      // Case 3: meta redirect
      const metaRedirect = $('meta[http-equiv="refresh"]').attr("content");
      if (metaRedirect) {
        const match = metaRedirect.match(/url=(.*)/i);
        if (match && match[1]) return match[1];
      }

      // Case 4: in scripts
      const scriptMatch = html.match(/https?:\/\/[^\s"']+\.mp4/);
      if (scriptMatch) return scriptMatch[0];

      return null;
    } catch {
      return null;
    }
  }

  try {
    // 1️⃣ Fetch movie page
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);

    const title = $("title").text().trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $("p").first().text().trim() ||
      null;
    const poster =
      $(".albumcover img").attr("src") &&
      `${baseURL}${$(".albumcover img").attr("src")}`;

    const movieDetails = {};
    $(".details").each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes("File Name:"))
        movieDetails.name = text.replace("File Name:", "").trim();
      if (text.includes("File Size:"))
        movieDetails.size = text.replace("File Size:", "").trim();
      if (text.includes("Duration:"))
        movieDetails.duration = text.replace("Duration:", "").trim();
      if (text.includes("Video Resolution:"))
        movieDetails.resolution = text
          .replace("Video Resolution:", "")
          .trim();
      if (text.includes("Download Format:"))
        movieDetails.format = text.replace("Download Format:", "").trim();
      if (text.includes("Added On:"))
        movieDetails.addedOn = text.replace("Added On:", "").trim();
    });

    // 2️⃣ Extract link to the download page (/download/...)
    const dlLink = $("a[href*='/download/']").first().attr("href");
    if (!dlLink)
      return res.status(404).json({ error: "No download link found" });

    const downloadPage = dlLink.startsWith("http")
      ? dlLink
      : `${baseURL}${dlLink}`;

    // 3️⃣ Fetch download page → extract server links
    const dlHtml = await fetchHtml(downloadPage);
    const $$ = cheerio.load(dlHtml);
    const servers = [];
    $$(".download .dlink a").each((i, el) => {
      const name = $$(el).text().trim();
      const href = $$(el).attr("href");
      if (href)
        servers.push({
          server: name,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
        });
    });

    // 4️⃣ Follow each server link → get CDN .mp4 URLs
    const finalDownloads = [];
    for (const s of servers) {
      const cdn = await getFinalCdnUrl(s.url);
      if (cdn) finalDownloads.push({ server: s.server, cdn });
    }

    // ✅ Final structured response
    res.status(200).json({
      source: targetURL,
      metadata: {
        title,
        description,
        poster,
      },
      movieDetails,
      downloadPage,
      servers,
      finalDownloads,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: url,
    });
  }
}
