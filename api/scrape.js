// api/scraper.js - Complete Vercel Serverless Function with Step 6
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
    
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return cheerio.load(response.data);
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

// Step 1: Get year categories from homepage
async function getYearCategories() {
  const $ = await fetchPage(BASE_URL);
  const categories = [];
  
  $('div.f a[href*="tamil-"][href*="movies/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && /\d{4}/.test(href)) {
      const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
      categories.push({
        id: i + 1,
        name: text,
        url: fullUrl,
        slug: href.replace(/^\/|\/$/g, '')
      });
    }
  });
  
  return categories;
}

// Step 2: Get movies from category page
async function getMoviesFromCategory(categoryUrl, page = 1) {
  const url = page > 1 ? `${categoryUrl}?page=${page}` : categoryUrl;
  const $ = await fetchPage(url);
  const movies = [];
  
  $('div.f a[href*="-tamil-movie/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (text && href && href.includes('-tamil-movie/')) {
      movies.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        slug: href.replace(/^\/|\/$/g, '')
      });
    }
  });
  
  const totalPages = parseInt($('#totalPages').text()) || 1;
  const currentPage = parseInt($('#currentPage').text()) || 1;
  
  return {
    movies,
    pagination: {
      currentPage,
      totalPages,
      hasNext: currentPage < totalPages
    }
  };
}

// Step 3: Get movie details
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
  
  const posterSrc = $('#movie-info img').attr('src');
  if (posterSrc) {
    details.poster = posterSrc.startsWith('http') ? posterSrc : BASE_URL + posterSrc;
  }
  
  // Get original movie link
  $('div.f a[href*="-original-movie/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href) {
      details.qualities.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
      });
    }
  });
  
  return details;
}

// Step 4: Get quality options (360p, 720p, 1080p)
async function getQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];
  
  $('div.f a[href*="-hd-movie/"], div.f a[href*="p-movie/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && (text.includes('1080p') || text.includes('720p') || text.includes('360p'))) {
      options.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
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
  
  // Extract file info from mv-content
  $('.mv-content .left ul li').each((i, el) => {
    const text = $(el).text();
    if (text.includes('File Size:')) info.fileSize = text.replace('File Size:', '').trim();
    if (text.includes('Download Format:')) info.format = text.replace('Download Format:', '').trim();
  });
  
  // Get download page link
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
  
  // Get download server links
  $('.download .dlink a, .songinfo .download .dlink a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && text.toLowerCase().includes('download')) {
      servers.push({
        id: i + 1,
        name: text,
        type: 'download',
        url: href
      });
    }
  });
  
  return servers;
}

// Step 7: NEW - Get actual CDN links from server pages
async function getActualCDNLinks(serverUrls) {
  const cdnLinks = [];
  
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      
      // Look for direct download links on the server page
      const links = [];
      
      // Method 1: Check for direct download buttons/links
      $('.download a, .dlink a, #download-link, .btn-download').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        
        if (href && (
          href.includes('.mp4') || 
          href.includes('.mkv') ||
          href.includes('cdn') ||
          href.includes('storage') ||
          text.toLowerCase().includes('download')
        )) {
          links.push({
            text: text || 'Direct Download',
            url: href,
            type: 'cdn'
          });
        }
      });
      
      // Method 2: Check for embedded links in scripts or meta tags
      $('script').each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent) {
          // Look for direct file URLs in JavaScript
          const urlMatches = scriptContent.match(/https?:\/\/[^\s"']+\.(mp4|mkv|avi)/gi);
          if (urlMatches) {
            urlMatches.forEach(url => {
              links.push({
                text: 'CDN Link',
                url: url,
                type: 'cdn'
              });
            });
          }
        }
      });
      
      // Method 3: Check for meta refresh or redirect
      const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
      if (metaRefresh) {
        const urlMatch = metaRefresh.match(/url=(.+)/i);
        if (urlMatch && urlMatch[1]) {
          links.push({
            text: 'Redirect Link',
            url: urlMatch[1],
            type: 'redirect'
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

// Complete scraping flow with Step 6
async function getCompleteMovieLinks(movieUrl) {
  const steps = [];
  
  try {
    // Step 1: Movie Details
    steps.push({ 
      step: 1, 
      status: '⏳ pending', 
      message: 'Fetching movie details...', 
      url: movieUrl 
    });
    
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;
    
    if (!details.qualities || details.qualities.length === 0) {
      throw new Error('No quality options found on movie page');
    }
    
    // Step 2: Quality Options
    const originalUrl = details.qualities[0].url;
    steps.push({ 
      step: 2, 
      status: '⏳ pending', 
      message: 'Fetching quality options (1080p, 720p, 360p)...', 
      url: originalUrl 
    });
    
    const qualities = await getQualityOptions(originalUrl);
    steps[1].status = '✅ completed';
    steps[1].data = qualities;
    
    if (!qualities || qualities.length === 0) {
      throw new Error('No quality links found (1080p, 720p, 360p)');
    }
    
    // Step 3: Download Info
    const qualityUrl = qualities[0].url;
    steps.push({ 
      step: 3, 
      status: '⏳ pending', 
      message: `Fetching download info for ${qualities[0].name}...`, 
      url: qualityUrl 
    });
    
    const downloadInfo = await getDownloadInfo(qualityUrl);
    steps[2].status = '✅ completed';
    steps[2].data = downloadInfo;
    
    if (!downloadInfo.downloadPageUrl) {
      throw new Error('No download page URL found');
    }
    
    // Step 4: Server Links
    steps.push({ 
      step: 4, 
      status: '⏳ pending', 
      message: 'Fetching server links...', 
      url: downloadInfo.downloadPageUrl 
    });
    
    const servers = await getServerLinks(downloadInfo.downloadPageUrl);
    steps[3].status = '✅ completed';
    steps[3].data = servers;
    
    if (!servers || servers.length === 0) {
      throw new Error('No server links found');
    }
    
    // Step 5: Get Download Links from First Server
    const serverUrl = servers[0].url;
    steps.push({ 
      step: 5, 
      status: '⏳ pending', 
      message: 'Fetching download links from first server...', 
      url: serverUrl 
    });
    
    const $ = await fetchPage(serverUrl);
    const downloadLinks = [];
    
    $('.download .dlink a, .songinfo .download .dlink a, #download-btn').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      
      if (href) {
        downloadLinks.push({
          id: i + 1,
          name: text || `Download Server ${i + 1}`,
          url: href
        });
      }
    });
    
    steps[4].status = '✅ completed';
    steps[4].data = { downloadLinks };
    
    if (!downloadLinks || downloadLinks.length === 0) {
      throw new Error('No download links found on server page');
    }
    
    // Step 6: NEW - Get Actual CDN Links from Server Pages
    steps.push({ 
      step: 6, 
      status: '⏳ pending', 
      message: 'Fetching actual CDN/file URLs from server pages...', 
      count: downloadLinks.length 
    });
    
    const serverUrls = downloadLinks.map(link => link.url);
    const cdnLinks = await getActualCDNLinks(serverUrls);
    
    steps[5].status = '✅ completed';
    steps[5].data = cdnLinks;
    
    // Flatten all CDN links
    const allCDNLinks = [];
    cdnLinks.forEach((server, idx) => {
      server.links.forEach((link, linkIdx) => {
        allCDNLinks.push({
          id: allCDNLinks.length + 1,
          serverName: downloadLinks[idx]?.name || `Server ${idx + 1}`,
          serverUrl: server.serverUrl,
          linkText: link.text,
          cdnUrl: link.url,
          type: link.type
        });
      });
    });
    
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
        serverLinks: downloadLinks,
        cdnLinks: allCDNLinks,
        totalCDNLinks: allCDNLinks.length
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
      steps
    };
  }
}

// Main API Handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, categoryUrl, movieUrl, originalUrl, qualityUrl, downloadUrl, serverUrl, page } = req.query;

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
        if (!categoryUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'categoryUrl parameter is required' 
          });
        }
        const result = await getMoviesFromCategory(categoryUrl, parseInt(page) || 1);
        return res.status(200).json({
          success: true,
          action: 'Movies fetched',
          data: result.movies,
          pagination: result.pagination,
          count: result.movies.length
        });

      case 'getMovieDetails':
        if (!movieUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'movieUrl parameter is required' 
          });
        }
        const details = await getMovieDetails(movieUrl);
        return res.status(200).json({
          success: true,
          action: 'Movie details fetched',
          data: details
        });

      case 'getQualityOptions':
        if (!originalUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'originalUrl parameter is required' 
          });
        }
        const qualities = await getQualityOptions(originalUrl);
        return res.status(200).json({
          success: true,
          action: 'Quality options fetched',
          data: qualities
        });

      case 'getDownloadInfo':
        if (!qualityUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'qualityUrl parameter is required' 
          });
        }
        const downloadInfo = await getDownloadInfo(qualityUrl);
        return res.status(200).json({
          success: true,
          action: 'Download info fetched',
          data: downloadInfo
        });

      case 'getServerLinks':
        if (!downloadUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'downloadUrl parameter is required' 
          });
        }
        const servers = await getServerLinks(downloadUrl);
        return res.status(200).json({
          success: true,
          action: 'Server links fetched',
          data: servers
        });

      case 'getCDNLinks':
        if (!serverUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'serverUrl parameter is required (comma-separated for multiple)' 
          });
        }
        const serverUrls = serverUrl.split(',').map(url => url.trim());
        const cdnLinks = await getActualCDNLinks(serverUrls);
        return res.status(200).json({
          success: true,
          action: 'CDN links fetched',
          data: cdnLinks
        });

      case 'getCompleteLinks':
        if (!movieUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'movieUrl parameter is required' 
          });
        }
        const complete = await getCompleteMovieLinks(movieUrl);
        return res.status(200).json(complete);

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action parameter',
          availableActions: [
            'getYears - Get all year categories',
            'getMovies - Get movies from a category (requires categoryUrl)',
            'getMovieDetails - Get movie details (requires movieUrl)',
            'getQualityOptions - Get quality options (requires originalUrl)',
            'getDownloadInfo - Get download info (requires qualityUrl)',
            'getServerLinks - Get server links (requires downloadUrl)',
            'getCDNLinks - Get actual CDN links (requires serverUrl)',
            'getCompleteLinks - Get all links including CDN (requires movieUrl)'
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
