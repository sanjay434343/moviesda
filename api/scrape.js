import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://moviesda14.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

async function fetchPage(url) {
  try {
    const response = await axios.get(url, { 
      headers: HEADERS, 
      timeout: 15000,
      validateStatus: () => true 
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return cheerio.load(response.data);
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

// Extract quality from filename or URL
function extractQuality(text) {
  const qualityMatch = text.match(/(\d{3,4}p|4K|2K|HD|SD)/i);
  return qualityMatch ? qualityMatch[1].toUpperCase() : 'Unknown';
}

// Utility to get a valid poster image (.jpg, .png, .webp only)
function getValidPosterFromPicture($, selector) {
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
  const categories = [];

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
async function getMoviesFromCategory(categoryUrl, page = 1) {
  const url = page > 1 ? `${categoryUrl}?page=${page}` : categoryUrl;
  const $ = await fetchPage(url);
  const movies = [];

  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href || !/movie/i.test(href) || /category|year/i.test(href)) return;

    let img = $(el).find('img').attr('src') || '';
    if (img && !img.startsWith('http')) img = BASE_URL + img;

    const isValidImage = /\.(jpg|jpeg|png|webp)$/i.test(img);
    if (!isValidImage) img = '';

    movies.push({
      id: movies.length + 1,
      name: text,
      url: href.startsWith('http') ? href : BASE_URL + href,
      slug: href.replace(/^\/|\/$/g, ''),
      poster: img || null
    });
  });

  // Try to parse pagination for older years
  let currentPage = page;
  let totalPages = 1;
  const paginationText = $('.pagination, .pager, #totalPages').text() || '';
  const pageMatch = paginationText.match(/Page\s*(\d+)\s*of\s*(\d+)/i);
  if (pageMatch) {
    currentPage = parseInt(pageMatch[1]) || page;
    totalPages = parseInt(pageMatch[2]) || 1;
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

// Step 3: Get movie details (robust for older pages)
async function getMovieDetails(movieUrl) {
  const $ = await fetchPage(movieUrl);

  const details = {
    title: $('div.line h1').text().trim() || $('title').text().split('|')[0].trim(),
    director: '',
    starring: '',
    genre: '',
    rating: '',
    language: '',
    synopsis: '',
    poster: '',
    qualities: []
  };

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

  // Get original links, compatible to older markup (may not always have 'original-movie')
  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;
    if (/original.*movie/i.test(href) || /original/i.test(text)) {
      details.qualities.push({
        id: details.qualities.length + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
      });
    }
  });

  // Fallback: if not found, try any movie quality page directly
  if (details.qualities.length === 0) {
    $('a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (href && (/hd-movie|p-movie/i.test(href) || /1080p|720p|360p/i.test(text))) {
        details.qualities.push({
          id: details.qualities.length + 1,
          name: text,
          url: href.startsWith('http') ? href : BASE_URL + href
        });
      }
    });
  }

  return details;
}

// Step 4: Get quality options (360p, 720p, 1080p)
async function getQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];

  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;

    if (/hd-movie|p-movie/i.test(href) || /1080p|720p|360p/i.test(text)) {
      options.push({
        id: options.length + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        quality: extractQuality(text)
      });
    }
  });

  return options;
}

// Step 5: Get download file info
async function getDownloadInfo(qualityUrl) {
  const $ = await fetchPage(qualityUrl);
  const info = {
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

// Step 6: Get server links from download page
async function getServerLinks(downloadPageUrl) {
  const $ = await fetchPage(downloadPageUrl);
  const servers = [];

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
async function getActualCDNLinks(serverUrls, currentQuality = 'Unknown') {
  const cdnLinks = [];
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      const links = [];
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
    } catch (error) {
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

// Complete scraping flow
async function getCompleteMovieLinks(movieUrl, showAllSteps = false) {
  const steps = [];
  try {
    steps.push({ 
      step: 1, status: '⏳ pending', message: 'Fetching movie details...', url: movieUrl 
    });
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;

    if (!details.qualities || details.qualities.length === 0) throw new Error('No quality options found on movie page');

    // Try the first quality/variant link
    const originalUrl = details.qualities[0].url;
    steps.push({ 
      step: 2, status: '⏳ pending', message: 'Fetching quality options (1080p, 720p, 360p)...', url: originalUrl 
    });
    const qualities = await getQualityOptions(originalUrl);
    steps[1].status = '✅ completed';
    steps[1].data = qualities;

    if (!qualities || qualities.length === 0) throw new Error('No quality links found (1080p, 720p, 360p)');

    // Download info for the first found quality
    const qualityUrl = qualities[0].url;
    const currentQuality = qualities[0].quality || '1080P';

    steps.push({ 
      step: 3, status: '⏳ pending', message: `Fetching download info for ${qualities[0].name}...`, url: qualityUrl 
    });
    const downloadInfo = await getDownloadInfo(qualityUrl);
    steps[2].status = '✅ completed';
    steps[2].data = downloadInfo;

    if (!downloadInfo.downloadPageUrl) throw new Error('No download page URL found');

    steps.push({ 
      step: 4, status: '⏳ pending', message: 'Fetching server links...', url: downloadInfo.downloadPageUrl 
    });
    const servers = await getServerLinks(downloadInfo.downloadPageUrl);
    steps[3].status = '✅ completed';
    steps[3].data = servers;

    if (!servers || servers.length === 0) throw new Error('No server links found');

    const serverUrl = servers[0].url;
    steps.push({ 
      step: 5, status: '⏳ pending', message: 'Fetching download links from first server...', url: serverUrl 
    });
    const $ = await fetchPage(serverUrl);
    const downloadLinks = [];
    $('.download .dlink a, .songinfo .download .dlink a, #download-btn').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (href) {
        downloadLinks.push({
          id: downloadLinks.length + 1,
          name: text || `Download Server ${downloadLinks.length + 1}`,
          url: href
        });
      }
    });
    steps[4].status = '✅ completed';
    steps[4].data = { downloadLinks };

    if (!downloadLinks || downloadLinks.length === 0) throw new Error('No download links found on server page');

    steps.push({ 
      step: 6, status: '⏳ pending', message: 'Fetching actual CDN/file URLs from server pages...', count: downloadLinks.length 
    });
    const serverUrls = downloadLinks.map(link => link.url);
    const cdnLinks = await getActualCDNLinks(serverUrls, currentQuality);

    steps[5].status = '✅ completed';
    steps[5].data = cdnLinks;

    const allCDNLinks = [];
    cdnLinks.forEach((server, idx) => {
      server.links.forEach((link, linkIdx) => {
        allCDNLinks.push({
          id: allCDNLinks.length + 1,
          serverName: downloadLinks[idx]?.name || `Server ${idx + 1}`,
          serverUrl: server.serverUrl,
          linkText: link.text,
          cdnUrl: link.url,
          quality: link.quality,
          type: link.type
        });
      });
    });

    if (showAllSteps) {
      return {
        success: true,
        steps,
        summary: {
          movie: details.title,
          director: details.director,
          starring: details.starring,
          genre: details.genre,
          rating: details.rating,
          poster: details.poster,
          fileSize: downloadInfo.fileSize,
          format: downloadInfo.format,
          quality: currentQuality,
          serverLinks: downloadLinks,
          cdnLinks: allCDNLinks,
          totalCDNLinks: allCDNLinks.length
        }
      };
    } else {
      return {
        success: true,
        summary: {
          movie: details.title,
          director: details.director,
          starring: details.starring,
          genre: details.genre,
          rating: details.rating,
          poster: details.poster,
          fileSize: downloadInfo.fileSize,
          format: downloadInfo.format,
          quality: currentQuality,
          cdnLinks: allCDNLinks,
          totalCDNLinks: allCDNLinks.length
        }
      };
    }
  } catch (error) {
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

// Main API Handler (for Next.js or Vercel serverless)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, categoryUrl, movieUrl, originalUrl, qualityUrl, downloadUrl, serverUrl, page, showSteps } = req.query;

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
        if (!movieUrl) return res.status(400).json({ success: false, error: 'movieUrl parameter is required' });
        const details = await getMovieDetails(movieUrl);
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
        const serverUrls = serverUrl.split(',').map(url => url.trim());
        const cdnLinks = await getActualCDNLinks(serverUrls);
        return res.status(200).json({
          success: true,
          action: 'CDN links fetched',
          data: cdnLinks
        });

      case 'getCompleteLinks':
        if (!movieUrl) return res.status(400).json({ success: false, error: 'movieUrl parameter is required' });
        const complete = await getCompleteMovieLinks(movieUrl, showSteps === 'true');
        return res.status(200).json(complete);

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action parameter',
          availableActions: [
            'getYears - Get all year categories',
            'getMovies - Get movies from a category (requires categoryUrl, optional: page)',
            'getMovieDetails - Get movie details (requires movieUrl)',
            'getQualityOptions - Get quality options (requires originalUrl)',
            'getDownloadInfo - Get download info (requires qualityUrl)',
            'getServerLinks - Get server links (requires downloadUrl)',
            'getCDNLinks - Get actual CDN links (requires serverUrl)',
            'getCompleteLinks - Get all links including CDN (requires movieUrl, optional: showSteps=true)'
          ]
        });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
