import axios from "axios";
import * as cheerio from "cheerio";

function getAbsoluteUrl(baseURL, url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `${baseURL}${url}`;
  return `${baseURL}/${url}`;
}

// NEW: Fetch Wikipedia extract for a movie
async function fetchWikiExtract(movieName) {
  try {
    // Step 1: Search Wikipedia for the movie
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(movieName)}&format=json&origin=*`;
    const searchResp = await axios.get(searchUrl, { timeout: 10000 });
    
    if (searchResp.status === 200 && searchResp.data?.query?.search?.length > 0) {
      const topTitle = searchResp.data.query.search[0].title;
      
      // Step 2: Get summary from the top result
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`;
      const summaryResp = await axios.get(summaryUrl, { timeout: 10000 });
      
      if (summaryResp.status === 200 && summaryResp.data?.extract) {
        return {
          extract: summaryResp.data.extract,
          title: summaryResp.data.title,
          url: summaryResp.data.content_urls?.desktop?.page || null,
          thumbnail: summaryResp.data.thumbnail?.source || null
        };
      }
    }
  } catch (error) {
    console.error('Wikipedia fetch error:', error.message);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, wiki, includeWiki } = req.query;
  
  if (!url)
    return res.status(400).json({ error: "Missing ?url parameter" });

  // Check if Wikipedia should be included (default: true - always fetch Wikipedia)
  // Can be disabled with ?wiki=false or ?includeWiki=false
  const shouldIncludeWiki = wiki !== 'false' && includeWiki !== 'false';

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

        const movieData = { 
          title, 
          url: href, 
          img: poster 
        };

        // Fetch Wikipedia data if enabled
        if (shouldIncludeWiki) {
          const wikiData = await fetchWikiExtract(title);
          if (wikiData) {
            movieData.wikipedia = wikiData;
          }
        }

        return movieData;
      }).get()
    ).then(resArr => resArr.filter(Boolean));

    res.status(200).json({
      source: decodeURIComponent(url),
      total: movies.length,
      pagination,
      wikipediaEnabled: shouldIncludeWiki,
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
