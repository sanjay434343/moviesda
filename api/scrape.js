import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ✅ CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, lang, year, search, date, follow = "true" } = req.query;
  const shouldFollow = String(follow).toLowerCase() !== "false";

  const baseURL = "https://moviesda14.com";
  const language = lang || search || "tamil";
  const yearOrDate = year || date || "2025";
  const targetURL = url
    ? decodeURIComponent(url)
    : `${baseURL}/${language}-${yearOrDate}-movies/`;

  // 🧠 Helper: Safe HTML fetcher
  async function fetchHtml(u) {
    const { data } = await axios.get(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://google.com",
      },
      timeout: 15000,
    });
    return data;
  }

  // 🔍 Helper: Extract poster
  function extractPosterFromHtml(html, pageUrl) {
    const $ = cheerio.load(html);
    const candidates = [
      $('meta[property="og:image"]').attr("content"),
      $("img.albumcover").attr("src"),
      $(".movie-info-container img").attr("src"),
      $("img").first().attr("src"),
    ];
    for (const c of candidates) {
      if (c && c.length > 5) {
        if (c.startsWith("http")) return c;
        if (c.startsWith("/")) return `${new URL(pageUrl).origin}${c}`;
      }
    }
    return null;
  }

  // 🔗 Helper: Get final CDN mp4 URL from `movies.downloadpage.site`
  async function getFinalCdnUrl(downloadPageUrl) {
    try {
      const html = await fetchHtml(downloadPageUrl);
      const $ = cheerio.load(html);

      // Direct .mp4 links (used in CDN pages)
      const mp4Links = $("a[href*='.mp4']").map((i, el) => $(el).attr("href")).get();

      if (mp4Links.length > 0) {
        return mp4Links.find((l) => l.endsWith(".mp4")) || mp4Links[0];
      }

      // fallback: search inside <iframe> or meta refresh redirect
      const iframeSrc = $("iframe").attr("src");
      if (iframeSrc && iframeSrc.includes(".mp4")) return iframeSrc;

      const metaRedirect = $('meta[http-equiv="refresh"]').attr("content");
      if (metaRedirect) {
        const match = metaRedirect.match(/url=(.*)/i);
        if (match && match[1]) return match[1];
      }

      // Sometimes direct CDN link is in scripts
      const scriptMatch = html.match(/https?:\/\/[^\s"']+\.mp4/);
      if (scriptMatch) return scriptMatch[0];

      return null;
    } catch (err) {
      return null;
    }
  }

  try {
    // 🌐 1️⃣ Fetch movie list page
    const html = await fetchHtml(targetURL);
    const $ = cheerio.load(html);
    const results = [];

    // Extract movie entries (div.f)
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

    // 🧩 If direct movie page is given, skip list and go inside
    if (results.length === 0 && targetURL.includes("-movie")) {
      const movieHtml = await fetchHtml(targetURL);
      const $$ = cheerio.load(movieHtml);

      const title = $$("title").text().trim();
      const poster =
        $(".albumcover img").attr("src") &&
        `${baseURL}${$(".albumcover img").attr("src")}`;
      const movieDetails = {};
      $$(".details").each((i, el) => {
        const t = $$(el).text().trim();
        if (t.includes("File Size:")) movieDetails.size = t.replace("File Size:", "").trim();
        if (t.includes("Duration:")) movieDetails.duration = t.replace("Duration:", "").trim();
        if (t.includes("Format:")) movieDetails.format = t.replace("Format:", "").trim();
      });

      // Extract "Download Server" links
      const servers = [];
      $$(".download .dlink a").each((i, el) => {
        const name = $$(el).text().trim();
        const href = $$(el).attr("href");
        if (href) servers.push({
          server: name,
          url: href.startsWith("http") ? href : `${baseURL}${href}`,
        });
      });

      // 2️⃣ Fetch each server link → follow → get final .mp4
      const cdnLinks = [];
      for (const s of servers) {
        const cdn = await getFinalCdnUrl(s.url);
        if (cdn) cdnLinks.push({ server: s.server, cdn });
      }

      return res.status(200).json({
        source: targetURL,
        title,
        poster,
        movieDetails,
        servers,
        finalDownloads: cdnLinks,
      });
    }

    // 🎬 3️⃣ Optionally follow each result for nested info
    if (shouldFollow && results.length > 0) {
      for (let i = 0; i < results.length; i++) {
        const m = results[i];
        try {
          const movieHtml = await fetchHtml(m.url);
          const $$ = cheerio.load(movieHtml);

          // Extract download link (first found)
          const dlLink = $$("a[href*='/download/']").first().attr("href");
          if (dlLink) {
            const abs = dlLink.startsWith("http") ? dlLink : `${baseURL}${dlLink}`;
            m.downloadPage = abs;

            // 2️⃣ Fetch that download page to get server links
            const dlHtml = await fetchHtml(abs);
            const $$$ = cheerio.load(dlHtml);
            const serverUrls = $$$(".download .dlink a")
              .map((i, el) => $$$($(el)).attr("href"))
              .get()
              .map((u) => (u.startsWith("http") ? u : `${baseURL}${u}`));

            m.servers = serverUrls;

            // 3️⃣ Now follow each to get final CDN .mp4
            m.final = [];
            for (const su of serverUrls) {
              const cdn = await getFinalCdnUrl(su);
              if (cdn) m.final.push(cdn);
            }
          }
        } catch (err) {
          console.log("Failed for", m.title);
        }
      }
    }

    // ✅ Return clean structured response
    res.status(200).json({
      source: targetURL,
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to scrape page",
      details: err.message,
      source: targetURL,
    });
  }
}
