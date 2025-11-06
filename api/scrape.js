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

// Check if URL is a web series
function isWebSeries(url, title = '') {
  return /web-series|webseries|season|episode/i.test(url) || /web-series|webseries|season|episode/i.test(title);
}

// Step 1: Get year categories from homepage
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
    if (!href || !/movie|web-series|webseries/i.test(href) || /category|year/i.test(href)) return;

    let img = $(el).find('img').attr('src') || '';
    if (img && !img.startsWith('http')) img = BASE_URL + img;

    const isValidImage = /\.(jpg|jpeg|png|webp)$/i.test(img);
    if (!isValidImage) img = '';

    movies.push({
      id: movies.length + 1,
      name: text,
      url: href.startsWith('http') ? href : BASE_URL + href,
      slug: href.replace(/^\/|\/$/g, ''),
      poster: img || null,
      type: isWebSeries(href, text) ? 'web-series' : 'movie'
    });
  });

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

// Step 3: Get movie/series details
async function getMovieDetails(movieUrl) {
  const $ = await fetchPage(movieUrl);
  const isSeriesPage = isWebSeries(movieUrl);

  const details = {
    title: $('div.line').first().text().trim() || $('title').text().split('|')[0].trim(),
    type: isSeriesPage ? 'web-series' : 'movie',
    director: '',
    starring: '',
    genre: '',
    rating: '',
    language: '',
    synopsis: '',
    poster: '',
    qualities: [],
    episodes: [] // For web series
  };

  // Extract metadata
  $('#movie-info ul.movie-info li, .movie-info li').each((i, el) => {
    const text = $(el).text();
    if (text.includes('Director:')) details.director = $(el).find('span').text().trim();
    if (text.includes('Starring:')) details.starring = $(el).find('span').text().trim();
    if (text.includes('Genres:')) details.genre = $(el).find('span').text().trim();
    if (text.includes('Movie Rating:')) details.rating = $(el).find('span').text().trim();
    if (text.includes('Language:')) details.language = $(el).find('span').text().trim();
  });

  details.synopsis = $('.movie-synopsis').text().replace('Synopsis:', '').trim();
  details.poster = getValidPosterFromPicture($, '#movie-info');

  if (isSeriesPage) {
    // Parse episodes for web series
    $('.f .mv-content').each((i, el) => {
      const episodeTitle = $(el).find('.left ul li a strong').text().trim();
      const episodeLink = $(el).find('.left ul li a').attr('href');
      const fileSize = $(el).find('.left ul li').filter((i, li) => $(li).text().includes('File Size:')).text().replace('File Size:', '').trim();
      const downloadFormat = $(el).find('.left ul li').filter((i, li) => $(li).text().includes('Download Format:')).text().replace('Download Format:', '').trim();
      const thumbnail = $(el).find('.tblimg img').attr('src');

      if (episodeLink) {
        details.episodes.push({
          id: details.episodes.length + 1,
          title: episodeTitle || `Episode ${details.episodes.length + 1}`,
          url: episodeLink.startsWith('http') ? episodeLink : BASE_URL + episodeLink,
          fileSize: fileSize || 'Unknown',
          format: downloadFormat || 'Mp4',
          thumbnail: thumbnail && thumbnail.startsWith('http') ? thumbnail : (thumbnail ? BASE_URL + thumbnail : null)
        });
      }
    });
  } else {
    // Get quality links for movies
    $('div.f a, .f > a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (!href) return;
      
      // Match quality patterns
      if (/\(.*?(1080p|720p|360p|original|hd).*?\)/i.test(text) || 
          /hd-movie|p-movie|-movie/i.test(href)) {
        const quality = extractQuality(text);
        details.qualities.push({
          id: details.qualities.length + 1,
          name: text,
          url: href.startsWith('http') ? href : BASE_URL + href,
          quality: quality !== 'Unknown' ? quality : 'HD'
        });
      }
    });
  }

  return details;
}

// Step 4: Get ALL quality options from the page (360p, 720p, 1080p, etc.)
async function getAllQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];

  // Find all quality links
  $('div.f a, .f > a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;

    // Match quality patterns more broadly
    if (/\(.*?(1080p|720p|360p|480p|2160p|4k|hd).*?\)/i.test(text) || 
        /hd-movie|p-movie|-movie/i.test(href) ||
        /1080p|720p|360p|480p/i.test(text)) {
      const quality = extractQuality(text);
      options.push({
        id: options.length + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        quality: quality !== 'Unknown' ? quality : 'HD'
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
    if (text.includes('Duration:')) info.duration = text.replace('Duration:', '').trim();
    if (text.includes('Resolution:')) info.resolution = text.replace('Resolution:', '').trim();
  });

  const downloadLink = $('.mv-content .left ul li a, .download-btn, #download-link').attr('href');
  if (downloadLink) {
    info.downloadPageUrl = downloadLink.startsWith('http') ? downloadLink : BASE_URL + downloadLink;
  }
  info.fileName = $('.mv-content .left ul li strong, .mv-content strong').first().text().trim();
  
  return info;
}

// Step 6: Get server links from download page
async function getServerLinks(downloadPageUrl) {
  const $ = await fetchPage(downloadPageUrl);
  const servers = [];

  $('.download .dlink a, .songinfo .download .dlink a, .download-links a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (href && /download|server/i.test(text)) {
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
      
      // Find download links
      $('.download a, .dlink a, #download-link, .btn-download, .download-btn').each((i, el) => {
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
      
      // Extract from scripts
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
      
      // Check meta refresh
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

// Complete scraping flow for ALL qualities
async function getCompleteMovieLinks(movieUrl, showAllSteps = false) {
  const steps = [];
  try {
    steps.push({ 
      step: 1, status: '⏳ pending', message: 'Fetching movie/series details...', url: movieUrl 
    });
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;

    const allQualitiesData = [];

    // Handle web series differently
    if (details.type === 'web-series') {
      steps.push({ 
        step: 2, status: '⏳ pending', message: `Fetching download info for ${details.episodes.length} episodes...` 
      });

      for (const episode of details.episodes) {
        try {
          const servers = await getServerLinks(episode.url);
          const episodeData = {
            episode: episode.title,
            fileSize: episode.fileSize,
            format: episode.format,
            thumbnail: episode.thumbnail,
            servers: []
          };

          if (servers && servers.length > 0) {
            const serverUrls = servers.map(s => s.url);
            const cdnLinks = await getActualCDNLinks(serverUrls, 'HD');
            
            cdnLinks.forEach((server, idx) => {
              episodeData.servers.push({
                serverName: servers[idx]?.name || `Server ${idx + 1}`,
                links: server.links
              });
            });
          }

          allQualitiesData.push(episodeData);
        } catch (err) {
          console.error(`Error processing episode ${episode.title}:`, err);
        }
      }

      steps[1].status = '✅ completed';
      steps[1].data = { episodes: allQualitiesData };

      return {
        success: true,
        steps: showAllSteps ? steps : undefined,
        summary: {
          title: details.title,
          type: 'web-series',
          director: details.director,
          starring: details.starring,
          genre: details.genre,
          rating: details.rating,
          poster: details.poster,
          totalEpisodes: details.episodes.length,
          episodes: allQualitiesData
        }
      };
    }

    // Handle movies with multiple qualities
    if (!details.qualities || details.qualities.length === 0) {
      throw new Error('No quality options found on movie page');
    }

    const originalUrl = details.qualities[0].url;
    steps.push({ 
      step: 2, status: '⏳ pending', message: 'Fetching ALL quality options...', url: originalUrl 
    });
    const allQualities = await getAllQualityOptions(originalUrl);
    steps[1].status = '✅ completed';
    steps[1].data = allQualities;

    if (!allQualities || allQualities.length === 0) {
      throw new Error('No quality links found');
    }

    // Process each quality
    steps.push({ 
      step: 3, status: '⏳ pending', message: `Processing ${allQualities.length} quality options...` 
    });

    for (const quality of allQualities) {
      try {
        const downloadInfo = await getDownloadInfo(quality.url);
        const qualityData = {
          quality: quality.quality,
          name: quality.name,
          fileSize: downloadInfo.fileSize,
          format: downloadInfo.format,
          fileName: downloadInfo.fileName,
          servers: []
        };

        if (downloadInfo.downloadPageUrl) {
          const servers = await getServerLinks(downloadInfo.downloadPageUrl);
          
          if (servers && servers.length > 0) {
            const serverUrls = servers.map(s => s.url);
            const cdnLinks = await getActualCDNLinks(serverUrls, quality.quality);
            
            cdnLinks.forEach((server, idx) => {
              qualityData.servers.push({
                serverName: servers[idx]?.name || `Server ${idx + 1}`,
                links: server.links
              });
            });
          }
        }

        allQualitiesData.push(qualityData);
      } catch (err) {
        console.error(`Error processing quality ${quality.quality}:`, err);
      }
    }

    steps[2].status = '✅ completed';
    steps[2].data = { qualities: allQualitiesData };

    return {
      success: true,
      steps: showAllSteps ? steps : undefined,
      summary: {
        title: details.title,
        type: 'movie',
        director: details.director,
        starring: details.starring,
        genre: details.genre,
        rating: details.rating,
        language: details.language,
        poster: details.poster,
        synopsis: details.synopsis,
        totalQualities: allQualitiesData.length,
        qualities: allQualitiesData
      }
    };

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

// Main API Handler
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
          action: 'Movie/Series details fetched',
          data: details
        });

      case 'getAllQualities':
        if (!originalUrl) return res.status(400).json({ success: false, error: 'originalUrl parameter is required' });
        const qualities = await getAllQualityOptions(originalUrl);
        return res.status(200).json({
          success: true,
          action: 'All quality options fetched',
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
            'getMovieDetails - Get movie/series details (requires movieUrl)',
            'getAllQualities - Get ALL quality options (requires originalUrl)',
            'getDownloadInfo - Get download info (requires qualityUrl)',
            'getServerLinks - Get server links (requires downloadUrl)',
            'getCDNLinks - Get actual CDN links (requires serverUrl)',
            'getCompleteLinks - Get ALL qualities with CDN links (requires movieUrl, optional: showSteps=true)'
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
