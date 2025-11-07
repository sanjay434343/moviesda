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

// Utility to get a valid poster image
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

// Get year categories
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

// Get movies from category page
async function getMoviesFromCategory(categoryUrl, page = 1) {
  const url = page > 1 ? `${categoryUrl}?page=${page}` : categoryUrl;
  const $ = await fetchPage(url);
  const movies = [];

  $('a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href || !/movie|web-series/i.test(href) || /category|year/i.test(href)) return;

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

// Enhanced: Get movie details with better quality detection
async function getMovieDetails(movieUrl) {
  const $ = await fetchPage(movieUrl);

  const title = $('div.line').first().text().trim() || $('title').text().split('|')[0].trim();
  
  const details = {
    title: title,
    director: '',
    starring: '',
    genre: '',
    rating: '',
    language: '',
    synopsis: '',
    poster: '',
    qualities: [],
    type: 'movie'
  };

  // Extract metadata
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

  // Check if it's a web series (has episodes)
  const hasEpisodes = $('.mv-content').length > 0;
  if (hasEpisodes) {
    details.type = 'webseries';
    $('.mv-content').each((i, el) => {
      const episodeTitle = $(el).find('.left ul li a strong').text().trim();
      const episodeUrl = $(el).find('.left ul li a').attr('href');
      const fileSize = $(el).find('.left ul li:contains("File Size")').text().replace('File Size:', '').trim();
      const thumbnail = $(el).find('.tblimg img').attr('src');
      
      if (episodeUrl) {
        details.qualities.push({
          id: details.qualities.length + 1,
          name: episodeTitle,
          url: episodeUrl.startsWith('http') ? episodeUrl : BASE_URL + episodeUrl,
          fileSize: fileSize,
          thumbnail: thumbnail && thumbnail.startsWith('http') ? thumbnail : (thumbnail ? BASE_URL + thumbnail : null),
          type: 'episode',
          quality: extractQuality(episodeTitle)
        });
      }
    });
  } else {
    // Extract quality links - improved to catch all variations
    $('div.f').each((i, el) => {
      const link = $(el).find('a');
      const text = link.text().trim();
      const href = link.attr('href');
      
      if (href && (
        /1080p|720p|360p|480p|original/i.test(text) || 
        /1080p|720p|360p|480p|original/i.test(href) ||
        /hd-movie|p-movie/i.test(href)
      )) {
        const quality = extractQuality(text);
        details.qualities.push({
          id: details.qualities.length + 1,
          name: text,
          url: href.startsWith('http') ? href : BASE_URL + href,
          quality: quality,
          type: 'quality'
        });
      }
    });

    // Fallback: Check all links
    if (details.qualities.length === 0) {
      $('a').each((i, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr('href');
        if (href && (
          /hd-movie|p-movie/i.test(href) || 
          /1080p|720p|360p|480p/i.test(text) ||
          /original.*movie/i.test(href)
        )) {
          const quality = extractQuality(text);
          details.qualities.push({
            id: details.qualities.length + 1,
            name: text,
            url: href.startsWith('http') ? href : BASE_URL + href,
            quality: quality,
            type: 'quality'
          });
        }
      });
    }
  }

  return details;
}

// Get download file info
async function getDownloadInfo(qualityUrl) {
  const $ = await fetchPage(qualityUrl);
  const info = {
    fileName: '',
    fileSize: '',
    format: '',
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

// Get server links from download page
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

// Get actual CDN links from server pages
async function getActualCDNLinks(serverUrls, currentQuality = 'Unknown') {
  const cdnLinks = [];
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      const links = [];
      
      // Extract download links
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

// NEW: Get complete links for ALL qualities
async function getAllQualitiesLinks(movieUrl, showAllSteps = false) {
  const steps = [];
  try {
    steps.push({ 
      step: 1, status: '⏳ pending', message: 'Fetching movie details...', url: movieUrl 
    });
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;

    if (!details.qualities || details.qualities.length === 0) {
      throw new Error('No quality options found on movie page');
    }

    const allQualitiesData = [];

    // Process each quality
    for (const qualityOption of details.qualities) {
      const qualityData = {
        quality: qualityOption.quality || extractQuality(qualityOption.name),
        qualityName: qualityOption.name,
        qualityUrl: qualityOption.url,
        fileSize: qualityOption.fileSize || '',
        format: '',
        cdnLinks: []
      };

      try {
        // Get download info for this quality
        const downloadInfo = await getDownloadInfo(qualityOption.url);
        qualityData.fileSize = downloadInfo.fileSize || qualityData.fileSize;
        qualityData.format = downloadInfo.format;

        if (downloadInfo.downloadPageUrl) {
          // Get server links
          const servers = await getServerLinks(downloadInfo.downloadPageUrl);
          
          if (servers && servers.length > 0) {
            // Get CDN links from all servers
            const serverUrls = servers.map(s => s.url);
            const cdnResults = await getActualCDNLinks(serverUrls, qualityData.quality);
            
            // Flatten CDN links
            cdnResults.forEach((server, idx) => {
              server.links.forEach((link) => {
                qualityData.cdnLinks.push({
                  id: qualityData.cdnLinks.length + 1,
                  serverName: servers[idx]?.name || `Server ${idx + 1}`,
                  serverUrl: server.serverUrl,
                  linkText: link.text,
                  cdnUrl: link.url,
                  quality: link.quality,
                  type: link.type
                });
              });
            });
          }
        }
      } catch (error) {
        qualityData.error = error.message;
      }

      allQualitiesData.push(qualityData);
    }

    // Build summary
    const summary = {
      movie: details.title,
      director: details.director,
      starring: details.starring,
      genre: details.genre,
      rating: details.rating,
      language: details.language,
      poster: details.poster,
      type: details.type,
      qualities: allQualitiesData,
      totalQualities: allQualitiesData.length,
      totalCDNLinks: allQualitiesData.reduce((sum, q) => sum + q.cdnLinks.length, 0)
    };

    if (showAllSteps) {
      return {
        success: true,
        steps,
        summary
      };
    } else {
      return {
        success: true,
        summary
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

// Original single quality function (backward compatibility)
async function getCompleteMovieLinks(movieUrl, showAllSteps = false) {
  const steps = [];
  try {
    steps.push({ 
      step: 1, status: '⏳ pending', message: 'Fetching movie details...', url: movieUrl 
    });
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;

    if (!details.qualities || details.qualities.length === 0) throw new Error('No quality options found');

    const qualityUrl = details.qualities[0].url;
    const currentQuality = details.qualities[0].quality || extractQuality(details.qualities[0].name);

    steps.push({ 
      step: 2, status: '⏳ pending', message: `Fetching download info for ${details.qualities[0].name}...`, url: qualityUrl 
    });
    const downloadInfo = await getDownloadInfo(qualityUrl);
    steps[1].status = '✅ completed';
    steps[1].data = downloadInfo;

    if (!downloadInfo.downloadPageUrl) throw new Error('No download page URL found');

    steps.push({ 
      step: 3, status: '⏳ pending', message: 'Fetching server links...', url: downloadInfo.downloadPageUrl 
    });
    const servers = await getServerLinks(downloadInfo.downloadPageUrl);
    steps[2].status = '✅ completed';
    steps[2].data = servers;

    if (!servers || servers.length === 0) throw new Error('No server links found');

    steps.push({ 
      step: 4, status: '⏳ pending', message: 'Fetching CDN links...', count: servers.length 
    });
    const serverUrls = servers.map(s => s.url);
    const cdnResults = await getActualCDNLinks(serverUrls, currentQuality);
    steps[3].status = '✅ completed';
    steps[3].data = cdnResults;

    const allCDNLinks = [];
    cdnResults.forEach((server, idx) => {
      server.links.forEach((link) => {
        allCDNLinks.push({
          id: allCDNLinks.length + 1,
          serverName: servers[idx]?.name || `Server ${idx + 1}`,
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

// Main API Handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, categoryUrl, movieUrl, qualityUrl, downloadUrl, serverUrl, page, showSteps, allQualities } = req.query;

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
        if (!serverUrl) return res.status(400).json({ success: false, error: 'serverUrl parameter is required' });
        const serverUrls = serverUrl.split(',').map(url => url.trim());
        const cdnLinks = await getActualCDNLinks(serverUrls);
        return res.status(200).json({
          success: true,
          action: 'CDN links fetched',
          data: cdnLinks
        });

      case 'getCompleteLinks':
        if (!movieUrl) return res.status(400).json({ success: false, error: 'movieUrl parameter is required' });
        
        // Default to ALL qualities unless specifically disabled
        if (allQualities === 'false') {
          const complete = await getCompleteMovieLinks(movieUrl, showSteps === 'true');
          return res.status(200).json(complete);
        } else {
          // Default behavior: get ALL qualities
          const allQualitiesResult = await getAllQualitiesLinks(movieUrl, showSteps === 'true');
          return res.status(200).json(allQualitiesResult);
        }

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action parameter',
          availableActions: [
            'getYears - Get all year categories',
            'getMovies - Get movies from a category (requires categoryUrl, optional: page)',
            'getMovieDetails - Get movie details (requires movieUrl)',
            'getDownloadInfo - Get download info (requires qualityUrl)',
            'getServerLinks - Get server links (requires downloadUrl)',
            'getCDNLinks - Get actual CDN links (requires serverUrl)',
            'getCompleteLinks - Get ALL quality links with CDN (requires movieUrl, optional: showSteps=true, allQualities=false for single quality)'
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
