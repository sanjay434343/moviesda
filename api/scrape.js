// api/scraper.js - Main API endpoint for Vercel
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://moviesda14.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

// Helper function to make requests
async function fetchPage(url) {
  try {
    const response = await axios.get(url, { 
      headers: HEADERS, 
      timeout: 15000,
      validateStatus: () => true 
    });
    return cheerio.load(response.data);
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

// Step 1: Get all year categories
async function getCategories() {
  const $ = await fetchPage(BASE_URL);
  const categories = [];
  
  $('div.f a[href*="tamil-"][href*="movies/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    // Filter for year-based categories
    if (/\d{4}/.test(href)) {
      categories.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
      });
    }
  });
  
  return categories;
}

// Step 2: Get movies from a category
async function getMoviesFromCategory(categoryUrl) {
  const $ = await fetchPage(categoryUrl);
  const movies = [];
  
  $('div.f a[href$="-tamil-movie/"], div.f a[href*="-tamil-"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (text && href && href.includes('-tamil-')) {
      movies.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
      });
    }
  });
  
  return movies;
}

// Step 3: Get movie details and quality options
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
  
  // Extract movie info
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
  
  // Get quality options
  $('div.f a[href*="original-"], div.f a[href*="-hd-"], div.f a[href*="-movie/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && !href.includes('-tamil-movie/')) {
      details.qualities.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
      });
    }
  });
  
  return details;
}

// Step 4: Get quality options from original page
async function getQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];
  
  $('div.f a').each((i, el) => {
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
    downloadPageUrl: ''
  };
  
  // Extract file info from the table
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
  
  $('.download .dlink a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href) {
      servers.push({
        id: i + 1,
        name: text,
        url: href
      });
    }
  });
  
  return servers;
}

// Step 7: Get final download links
async function getFinalLinks(serverUrl) {
  const $ = await fetchPage(serverUrl);
  const links = {
    download: [],
    watch: []
  };
  
  // Extract download links
  $('.download .dlink a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && text.toLowerCase().includes('download')) {
      links.download.push({
        id: i + 1,
        name: text,
        url: href
      });
    } else if (href && text.toLowerCase().includes('watch')) {
      links.watch.push({
        id: i + 1,
        name: text,
        url: href
      });
    }
  });
  
  return links;
}

// Main API Handler
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, url, categoryUrl, movieUrl, originalUrl, qualityUrl, downloadUrl, serverUrl } = req.query;

  try {
    switch (action) {
      case 'getCategories':
        const categories = await getCategories();
        return res.status(200).json({
          success: true,
          step: 1,
          action: 'Categories fetched',
          data: categories
        });

      case 'getMovies':
        if (!categoryUrl) {
          return res.status(400).json({ success: false, error: 'categoryUrl is required' });
        }
        const movies = await getMoviesFromCategory(categoryUrl);
        return res.status(200).json({
          success: true,
          step: 2,
          action: 'Movies fetched',
          data: movies
        });

      case 'getMovieDetails':
        if (!movieUrl) {
          return res.status(400).json({ success: false, error: 'movieUrl is required' });
        }
        const details = await getMovieDetails(movieUrl);
        return res.status(200).json({
          success: true,
          step: 3,
          action: 'Movie details fetched',
          data: details
        });

      case 'getQualityOptions':
        if (!originalUrl) {
          return res.status(400).json({ success: false, error: 'originalUrl is required' });
        }
        const qualities = await getQualityOptions(originalUrl);
        return res.status(200).json({
          success: true,
          step: 4,
          action: 'Quality options fetched',
          data: qualities
        });

      case 'getDownloadInfo':
        if (!qualityUrl) {
          return res.status(400).json({ success: false, error: 'qualityUrl is required' });
        }
        const downloadInfo = await getDownloadInfo(qualityUrl);
        return res.status(200).json({
          success: true,
          step: 5,
          action: 'Download info fetched',
          data: downloadInfo
        });

      case 'getServerLinks':
        if (!downloadUrl) {
          return res.status(400).json({ success: false, error: 'downloadUrl is required' });
        }
        const servers = await getServerLinks(downloadUrl);
        return res.status(200).json({
          success: true,
          step: 6,
          action: 'Server links fetched',
          data: servers
        });

      case 'getFinalLinks':
        if (!serverUrl) {
          return res.status(400).json({ success: false, error: 'serverUrl is required' });
        }
        const finalLinks = await getFinalLinks(serverUrl);
        return res.status(200).json({
          success: true,
          step: 7,
          action: 'Final download links fetched',
          data: finalLinks
        });

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
          availableActions: [
            'getCategories',
            'getMovies',
            'getMovieDetails',
            'getQualityOptions',
            'getDownloadInfo',
            'getServerLinks',
            'getFinalLinks'
          ]
        });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// For local testing
if (require.main === module) {
  const http = require('http');
  const url = require('url');
  
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    req.query = parsedUrl.query;
    module.exports(req, res);
  });
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('\nExample API calls:');
    console.log(`- GET /api/scraper?action=getCategories`);
    console.log(`- GET /api/scraper?action=getMovies&categoryUrl=https://moviesda14.com/tamil-2025-movies/`);
  });
}
