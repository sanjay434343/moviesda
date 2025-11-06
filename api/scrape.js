import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://moviesda14.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

async function fetchPage(url: string) {
  try {
    const response = await axios.get(url, { 
      headers: HEADERS, 
      timeout: 15000,
      validateStatus: () => true 
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return cheerio.load(response.data);
  } catch (error: any) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

// Extract quality from filename or URL
function extractQuality(text: string) {
  const qualityMatch = text.match(/(\d{3,4}p|4K|2K|HD|SD)/i);
  return qualityMatch ? qualityMatch[1].toUpperCase() : 'Unknown';
}

// Utility to get a valid poster image (.jpg, .png, .webp only)
function getValidPosterFromPicture($: cheerio.CheerioAPI, selector: string) {
  const validImageRegex = /\.(jpg|jpeg|png|webp)$/i;
  let posterUrl = "";

  const picture = $(selector).find('picture');
  if (picture.length) {
    picture.find('source').each((i, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset && validImageRegex.test(srcset)) {
        posterUrl = srcset;
        return false;
      }
    });
    if (!posterUrl) {
      const imgSrc = picture.find('img').attr('src');
      if (imgSrc && validImageRegex.test(imgSrc)) posterUrl = imgSrc;
    }
  } else {
    const imgSrc = $(selector).find('img').attr('src');
    if (imgSrc && validImageRegex.test(imgSrc)) posterUrl = imgSrc;
  }

  if (posterUrl && !posterUrl.startsWith('http')) posterUrl = BASE_URL + posterUrl;
  return posterUrl || null;
}

// Step 1: Get year categories from homepage (generic matching)
async function getYearCategories() {
  const $ = await fetchPage(BASE_URL);
  const categories: any[] = [];

  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    const yearMatch = text.match(/\b(19|20)\d{2}\b/) || (href && href.match(/\b(19|20)\d{2}\b/));
    if (!href || !yearMatch) return;
    if (/movie/i.test(href) || /movies/i.test(text)) {
      const year = yearMatch[0];
      const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
      categories.push({
        id: categories.length + 1,
        year,
        name: text || `Movies ${year}`,
        url: fullUrl,
        slug: href.replace(/^\/|\/$/g, '')
      });
    }
  });

  const deduped = Object.values(categories.reduce((acc, cat) => {
    acc[cat.url] = cat;
    return acc;
  }, {}));
  return deduped;
}

// Step 2: Get movies from category page
async function getMoviesFromCategory(categoryUrl: string, page: number = 1) {
  const url = page > 1 ? `${categoryUrl}?page=${page}` : categoryUrl;
  const $ = await fetchPage(url);
  const movies: any[] = [];

  // Try for both grid/list (movie) and episodic (web series) - see both "classic" and "web series" styles
  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href || /category|year/i.test(href)) return;

    // For classical grid: Movie pages have /movie/ pattern and exclude web series episode/season links
    if (/movie/i.test(href) && !/web-series|season|epi\d+/i.test(href)) {
      let img = $(el).find('img').attr('src') || '';
      if (img && !img.startsWith('http')) img = BASE_URL + img;
      const isValidImage = /\.(jpg|jpeg|png|webp)$/i.test(img);
      if (!isValidImage) img = '';
      movies.push({
        id: movies.length + 1,
        type: 'movie',
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        slug: href.replace(/^\/|\/$/g, ''),
        poster: img || null
      });
    }

    // For web series/season-episode links. Filter those not matching pure web series/episode pages
    // If a link has e.g. /bigg-boss-season-09-web-series/, treat as main series page (not episode)
    if (/web-series/i.test(href) && !/epi-|day-|mp4/i.test(href)) {
      movies.push({
        id: movies.length + 1,
        type: 'webseries',
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        slug: href.replace(/^\/|\/$/g, ''),
        poster: null
      });
    }
  });

  // Parse pagination for multi-page categories (for both structures)
  let currentPage = page;
  let totalPages = 1;
  const paginationText = $('.pagination, .pager, #totalPages').text() || '';
  const pageMatch = paginationText.match(/Page\s*(\d+)\s*of\s*(\d+)/i);
  if (pageMatch) {
    currentPage = parseInt(pageMatch[1]) || page;
    totalPages = parseInt(pageMatch[2]) || 1;
  } else if ($('#totalPages').length) {
    totalPages = parseInt($('#totalPages').text().replace(/\D/g, '')) || 1;
  }

  return {
    movies,
    pagination: {
      currentPage,
      totalPages,
      hasNext: currentPage < totalPages
    }
  };
}

// Step 3: Get movie details (robust for both movie and web series)
async function getMovieDetails(movieUrl: string) {
  const $ = await fetchPage(movieUrl);

  const details: any = {
    title: $('div.line').first().text().trim() || $('title').text().split('|')[0].trim(),
    director: '',
    starring: '',
    genre: '',
    rating: '',
    language: '',
    synopsis: '',
    poster: '',
    qualities: [],
    episodes: []
  };

  // Standard meta-data block (for movie)
  $('#movie-info ul.movie-info li').each((i, el) => {
    const text = $(el).text();
    if (text.includes('Director:')) details.director = $(el).find('span').text().trim();
    if (text.includes('Starring:')) details.starring = $(el).find('span').text().trim();
    if (text.includes('Genres:')) details.genre = $(el).find('span').text().trim();
    if (text.includes('Movie Rating:')) details.rating = $(el).find('span').text().trim();
    if (text.includes('Language:')) details.language = $(el).find('span').text().trim();
  });

  details.synopsis = $('.movie-synopsis').text().replace('Synopsis:', '').trim();
  details.poster = getValidPosterFromPicture($, '#movie-info');

  // Movie quality links (360p, 720p, 1080p, ...). Classic movie structure.
  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    // Movies have 'hd-movie', '/p-hd-movie' or quality in link/text
    if (href && (/hd-movie|p-hd-movie|360p|720p|1080p|4k/i.test(href) || /360p|720p|1080p|4k/i.test(text))) {
      details.qualities.push({
        id: details.qualities.length + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        quality: extractQuality(text + ' ' + href)
      });
    }
  });

  // Webseries/episodes style: get all episodes if present
  $('.f .mv-content, .f .tblimg').each((i, el) => {
    // sometimes direct .f > a for old structure, .f > .mv-content > .left for new
    const main = $(el).closest('.f');
    const episodeName = main.find('.left ul li a, .left ul li strong').first().text().trim() ||
                        main.find('.left ul li strong').first().text().trim();
    const episodeHref = main.find('.left ul li a, .left ul li strong').first().attr('href');
    const fileSize = main.find('.left ul li').filter((j, li) => $(li).text().includes('File Size:')).text().replace('File Size:', '').trim();
    const format = main.find('.left ul li').filter((j, li) => $(li).text().includes('Download Format:')).text().replace('Download Format:', '').trim();
    const imgSrc = main.find('.tblimg img').attr('src');
    details.episodes.push({
      id: details.episodes.length + 1,
      name: episodeName,
      url: episodeHref ? (episodeHref.startsWith('http') ? episodeHref : BASE_URL + episodeHref) : '',
      fileSize: fileSize,
      format: format,
      poster: imgSrc ? (imgSrc.startsWith('http') ? imgSrc : BASE_URL + imgSrc) : null
    });
  });

  return details;
}

// Step 4: Get quality options (360p, 720p, 1080p)
async function getQualityOptions(originalUrl: string) {
  const $ = await fetchPage(originalUrl);
  const options: any[] = [];

  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;
    if (/hd-movie|p-hd-movie|360p|720p|1080p|4k/i.test(href) || /360p|720p|1080p|4k/i.test(text)) {
      options.push({
        id: options.length + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        quality: extractQuality(text + ' ' + href)
      });
    }
  });

  return options;
}

// Step 5: Get download file info (for both structure - movie and episode)
async function getDownloadInfo(qualityUrl: string) {
  const $ = await fetchPage(qualityUrl);
  const info: any = {
    fileName: '',
    fileSize: '',
    format: '',
    duration: '',
    resolution: '',
    downloadPageUrl: ''
  };

  $('.mv-content .left ul li').each((i, el) => {
    const text = $(el).text();
    if (text.includes('File Size:')) info.fileSize = text.replace('File Size:', '').trim();
    if (text.includes('Download Format:')) info.format = text.replace('Download Format:', '').trim();
  });

  const downloadLink = $('.mv-content .left ul li a').attr('href');
  if (downloadLink) {
    info.downloadPageUrl = downloadLink.startsWith('http') ? downloadLink : BASE_URL + downloadLink;
  }
  info.fileName = $('.mv-content .left ul li strong').text().trim();
  return info;
}

// New: Webseries episode fast path (for episode download link)
async function getDownloadInfoForEpisode(episodeUrl: string) {
  const $ = await fetchPage(episodeUrl);
  const info: any = {
    fileName: '',
    fileSize: '',
    format: '',
    duration: '',
    resolution: '',
    downloadPageUrl: ''
  };

  $('.down, .download,  .download-btn').find('a').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if(href && /download/i.test(text) && !info.downloadPageUrl){
      info.downloadPageUrl = href.startsWith('http') ? href : BASE_URL + href;
    }
  });
  return info;
}

// Step 6: Get server links from download page
async function getServerLinks(downloadPageUrl: string) {
  const $ = await fetchPage(downloadPageUrl);
  const servers: any[] = [];

  $('.download .dlink a, .songinfo .download .dlink a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (href && text.toLowerCase().includes('download')) {
      servers.push({
        id: servers.length + 1,
        name: text,
        type: 'download',
        url: href
      });
    }
  });

  return servers;
}

// Step 7: Get actual CDN links from server pages
async function getActualCDNLinks(serverUrls: string[], currentQuality = 'Unknown') {
  const cdnLinks: any[] = [];
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      const links: any[] = [];
      $('.download a, .dlink a, #download-link, .btn-download').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && (
          href.includes('.mp4') || href.includes('.mkv') || href.includes('cdn') ||
          href.includes('storage') || href.includes('hotshare') || href.includes('download') ||
          text.toLowerCase().includes('download')
        )) {
          links.push({
            text: text || 'Direct Download',
            url: href,
            type: 'cdn',
            quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
          });
        }
      });
      $('script').each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent) {
          const urlMatches = scriptContent.match(/https?:\/\/[^\s"']+\.(mp4|mkv|avi)/gi);
          if (urlMatches) {
            urlMatches.forEach(url => {
              links.push({
                text: 'CDN Link',
                url: url,
                type: 'cdn',
                quality: extractQuality(url) !== 'Unknown' ? extractQuality(url) : currentQuality
              });
            });
          }
        }
      });
      const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
      if (metaRefresh) {
        const urlMatch = metaRefresh.match(/url=(.+)/i);
        if (urlMatch && urlMatch[1]) {
          links.push({
            text: 'Redirect Link',
            url: urlMatch[1],
            type: 'redirect',
            quality: extractQuality(urlMatch[1]) !== 'Unknown' ? extractQuality(urlMatch[1]) : currentQuality
          });
        }
      }
      cdnLinks.push({
        serverUrl: serverUrl,
        links: links,
        found: links.length
      });
    } catch (error: any) {
      cdnLinks.push({
        serverUrl: serverUrl,
        links: [],
        found: 0,
        error: error.message
      });
    }
  }
  return cdnLinks;
}

// Multi-quality scraping for movie: scrape all main quality links
async function getMultipleQualitiesMovieLinks(movieUrl: string, showAllSteps: boolean = false) {
  const steps: any[] = [];
  try {
    steps.push({ 
      step: 1, status: '⏳ pending', message: 'Fetching movie details...', url: movieUrl 
    });
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;

    if (!details.qualities || details.qualities.length === 0) throw new Error('No quality options found on movie page');

    // For each found quality of movie (360p, 720p, 1080p), try scraping chain.
    const qualities = details.qualities;
    let allCDNLinks: any[] = [];
    let summaryLinks: any[] = [];
    for (const q of qualities) {
      // Step 2: get all quality page info
      steps.push({ step: 2, status: '⏳ pending', message: `Fetching download info for ${q.name}...`, url: q.url });
      const downloadInfo = await getDownloadInfo(q.url);
      steps.at(-1).status = '✅ completed';
      steps.at(-1).data = downloadInfo;

      if (!downloadInfo.downloadPageUrl) continue;

      // Step 3: Get server links
      steps.push({ step: 3, status: '⏳ pending', message: 'Fetching server links...', url: downloadInfo.downloadPageUrl });
      const servers = await getServerLinks(downloadInfo.downloadPageUrl);
      steps.at(-1).status = '✅ completed';
      steps.at(-1).data = servers;

      if (!servers || servers.length === 0) continue;

      // Step 4: get actual CDN/file
      const serverUrls = servers.map(s => s.url);
      steps.push({ step: 4, status: '⏳ pending', message: `Fetching actual CDN/file URLs for ${q.name}...`, count: serverUrls.length });
      const cdnLinks = await getActualCDNLinks(serverUrls, q.quality);
      steps.at(-1).status = '✅ completed';
      steps.at(-1).data = cdnLinks;

      // Collate all CDN links
      cdnLinks.forEach((server, idx) => {
        server.links.forEach((link: any, linkIdx: number) => {
          allCDNLinks.push({
            quality: q.quality,
            serverUrl: server.serverUrl,
            cdnUrl: link.url,
            linkText: link.text,
            format: downloadInfo.format,
            fileSize: downloadInfo.fileSize
          });
          // For summary, per-quality path: max 3 per quality
          if (!summaryLinks.find(s => s.cdnUrl == link.url && s.quality == q.quality) && summaryLinks.filter(s => s.quality == q.quality).length < 3) {
            summaryLinks.push({
              quality: q.quality,
              format: downloadInfo.format,
              fileSize: downloadInfo.fileSize,
              cdnUrl: link.url,
              linkText: link.text
            });
          }
        });
      });
    }

    const summaryByQuality: {[k: string]: any[]} = {};
    summaryLinks.forEach(l => {
      summaryByQuality[l.quality] = summaryByQuality[l.quality] || [];
      summaryByQuality[l.quality].push(l);
    });

    return {
      success: true,
      steps: showAllSteps ? steps : undefined,
      summary: {
        movie: details.title,
        poster: details.poster,
        genre: details.genre,
        director: details.director,
        starring: details.starring,
        rating: details.rating,
        qualities: details.qualities.map((q: any) => q.quality),
        summaryLinks: summaryByQuality
      }
    };
  } catch (error: any) {
    if (steps.length > 0) {
      steps[steps.length - 1].status = '❌ failed';
      steps[steps.length - 1].error = error.message;
    }
    return {
      success: false,
      error: error.message,
      steps: showAllSteps ? steps : undefined
    };
  }
}

// Webseries scraper: List all episode files on listing
async function getWebSeriesAllEpisodes(seriesPageUrl: string) {
  const details = await getMovieDetails(seriesPageUrl);
  // details.episodes[] already filled
  return {
    success: true,
    summary: {
      series: details.title,
      poster: details.poster,
      summaryEpisodes: details.episodes
    }
  };
}

// Main API Handler (for Next.js or Vercel serverless)
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, categoryUrl, movieUrl, seriesUrl, originalUrl, qualityUrl, downloadUrl, serverUrl, page, showSteps } = req.query;

  try {
    switch (action) {
      case 'getYears':
        const categories = await getYearCategories();
        return res.status(200).json({
          success: true,
          action: 'Year categories fetched',
          data: categories,
          count: categories.length
        });

      case 'getMovies':
        if (!categoryUrl) return res.status(400).json({ success: false, error: 'categoryUrl parameter is required' });
        const result = await getMoviesFromCategory(categoryUrl, parseInt(page) || 1);
        return res.status(200).json({
          success: true,
          action: 'Movies fetched',
          data: result.movies,
          pagination: result.pagination,
          count: result.movies.length
        });

      case 'getMovieDetails':
        if (!movieUrl && !seriesUrl) return res.status(400).json({ success: false, error: 'movieUrl (or seriesUrl) parameter is required' });
        const details = await getMovieDetails(movieUrl || seriesUrl!);
        return res.status(200).json({
          success: true,
          action: 'Movie details fetched',
          data: details
        });

      case 'getQualityOptions':
        if (!originalUrl) return res.status(400).json({ success: false, error: 'originalUrl parameter is required' });
        const qualities = await getQualityOptions(originalUrl);
        return res.status(200).json({
          success: true,
          action: 'Quality options fetched',
          data: qualities
        });

      case 'getDownloadInfo':
        if (!qualityUrl) return res.status(400).json({ success: false, error: 'qualityUrl parameter is required' });
        const downloadInfo = await getDownloadInfo(qualityUrl);
        return res.status(200).json({
          success: true,
          action: 'Download info fetched',
          data: downloadInfo
        });

      case 'getServerLinks':
        if (!downloadUrl) return res.status(400).json({ success: false, error: 'downloadUrl parameter is required' });
        const servers = await getServerLinks(downloadUrl);
        return res.status(200).json({
          success: true,
          action: 'Server links fetched',
          data: servers
        });

      case 'getCDNLinks':
        if (!serverUrl) return res.status(400).json({ success: false, error: 'serverUrl parameter is required (comma-separated for multiple)' });
        const serverUrls = serverUrl.split(',').map((url: string) => url.trim());
        const cdnLinks = await getActualCDNLinks(serverUrls);
        return res.status(200).json({
          success: true,
          action: 'CDN links fetched',
          data: cdnLinks
        });

      case 'getCompleteLinks':
        if (!movieUrl) return res.status(400).json({ success: false, error: 'movieUrl parameter is required' });
        // Movie scraper: all quality paths, grab all qualities, max 3 per quality for summary
        const complete = await getMultipleQualitiesMovieLinks(movieUrl, showSteps === 'true' || showSteps === true);
        return res.status(200).json(complete);

      case 'getWebSeriesEpisodes':
        if (!seriesUrl) return res.status(400).json({ success: false, error: 'seriesUrl parameter is required' });
        // Webseries: only list all episode basic info. Episode downloader will be separate step.
        const webseries = await getWebSeriesAllEpisodes(seriesUrl);
        return res.status(200).json(webseries);

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action parameter',
          availableActions: [
            'getYears - Get all year categories',
            'getMovies - Get movies/web series from a category (requires categoryUrl, optional: page)',
            'getMovieDetails - Get movie/webseries details (requires movieUrl or seriesUrl)',
            'getQualityOptions - Get quality options (requires originalUrl)',
            'getDownloadInfo - Get download info (requires qualityUrl)',
            'getServerLinks - Get server links (requires downloadUrl)',
            'getCDNLinks - Get actual CDN links (requires serverUrl)',
            'getCompleteLinks - Get all movie links incl. all qualities (requires movieUrl, optional: showSteps=true)',
            'getWebSeriesEpisodes - List all webseries episodes (requires seriesUrl)'
          ]
        });
    }
  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
