import axios from "axios";
import * as cheerio from "cheerio";

function getAbsoluteUrl(baseURL, url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${baseURL}${url}`;
  return `${baseURL}/${url}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url)
    return res.status(400).json({ error: "Missing ?url parameter" });

  const baseURL = "https://moviesda14.com";

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

  async function getPosterImage(movieUrl) {
    try {
      const html = await fetchHtml(movieUrl);
      const $ = cheerio.load(html);

      let img =
        $('meta[property="og:image"]').attr("content") ||
        $('meta[name="og:image"]').attr("content") ||
        $(".albumcover img").attr("src") ||
        $(".poster img").attr("src") ||
        $("img[src*='/uploads/']").first().attr("src");

      if (!img) return null;
      if (img.startsWith("/")) img = `${baseURL}${img}`;
      if (!img.match(/\.(jpg|jpeg|png|webp)$/i)) return null;
      return img;
    } catch {
      return null;
    }
  }

  try {
    const html = await fetchHtml(decodeURIComponent(url));
    const $ = cheerio.load(html);

    // Extract simple pagination info
    const current = parseInt($("#currentPage").text().trim()) ||
      parseInt($(".pagination a.active").first().text().trim()) || 1;
    const total = parseInt($("#totalPages").text().trim()) ||
      // fallback: last .pagination link number
      (function() {
        let last = null;
        $(".pagination a").each(function () {
          const t = $(this).text().trim();
          if (/^\d+$/.test(t)) last = parseInt(t);
        });
        return last;
      })();

    const nextPage = $(".pagination a.next").attr("href");
    const prevPage = $(".pagination a.prev").attr("href");

    // Pagination for only required fields
    const pagination = {
      current,
      total,
      next: nextPage ? getAbsoluteUrl(baseURL, nextPage) : null,
      prev: prevPage ? getAbsoluteUrl(baseURL, prevPage) : null,
    };

    const items = $("div.f");
    const movies = await Promise.all(
      items.map(async (i, el) => {
        const title = $(el).find("a").text().trim();
        let href = $(el).find("a").attr("href");
        if (!href || !title) return null;
        href = getAbsoluteUrl(baseURL, href);

        let poster = await getPosterImage(href);
        if (!(poster && poster.match(/\.(jpg|jpeg|png|webp)$/i))) {
          poster = `${baseURL}/img/dir.gif`;
        }
        return { title, url: href, img: poster };
      }).get()
    ).then(resArr => resArr.filter(Boolean));

    res.status(200).json({
      source: decodeURIComponent(url),
      total: movies.length,
      pagination,
      results: movies,
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({
      error: "Failed to scrape movie list",
      details: err.message,
      source: decodeURIComponent(url),
    });
  }
}
