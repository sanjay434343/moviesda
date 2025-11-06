// api/scraper.js - Simplified with 3 Main APIs
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

function extractQuality(text) {
  const qualityMatch = text.match(/(\d{3,4}p|4K|2K|HD|SD)/i);
  return qualityMatch ? qualityMatch[1].toUpperCase() : 'Unknown';
}

// API 1: Get Year Categories
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

// API 2: Get Movies from Category with Images
async function getMoviesFromCategory(categoryUrl, page = 1) {
  const url = page > 1 ? `${categoryUrl}page/${page}/` : categoryUrl;
  const $ = await fetchPage(url);
  const movies = [];
  
  // Get movies with images
  $('div.f').each((i, el) => {
    const $el = $(el);
    const link = $el.find('a[href*="-tamil-movie/"]');
    const img = $el.find('img');
    
    const text = link.text().trim();
    const href = link.attr('href');
    const imgSrc = img.attr('src');
    
    if (text && href && href.includes('-tamil-movie/')) {
      movies.push({
        id: i + 1,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        image: imgSrc ? (imgSrc.startsWith('http') ? imgSrc : BASE_URL + imgSrc) : null,
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

// Helper: Get movie details
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
    originalMovieUrl: ''
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
  
  const originalLink = $('div.f a[href*="-original-movie/"]').first();
  if (originalLink.length) {
    const href = originalLink.attr('href');
    details.originalMovieUrl = href.startsWith('http') ? href : BASE_URL + href;
  }
  
  return details;
}

// Helper: Get quality options
async function getQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];
  
  $('div.f a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && (href.includes('-hd-movie/') || href.includes('p-movie/') || text.match(/\d{3,4}p/i))) {
      const quality = extractQuality(text);
      options.push({
        quality: quality,
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href
      });
    }
  });
  
  return options;
}

// Helper: Get download info
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

// Helper: Get server links
async function getServerLinks(downloadPageUrl) {
  const $ = await fetchPage(downloadPageUrl);
  const servers = [];
  
  $('.download .dlink a, .songinfo .download .dlink a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (href && text.toLowerCase().includes('download')) {
      servers.push({
        name: text,
        url: href
      });
    }
  });
  
  return servers;
}

// Helper: Get CDN links
async function getActualCDNLinks(serverUrls, currentQuality) {
  const cdnLinks = [];
  
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      const links = [];
      
      $('.download a, .dlink a, #download-link, .btn-download').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        
        if (href && (href.includes('.mp4') || href.includes('.mkv') || href.includes('cdn') || 
                     href.includes('storage') || href.includes('hotshare') || 
                     href.includes('download') || text.toLowerCase().includes('download'))) {
          links.push({
            text: text || 'Direct Download',
            url: href,
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
            quality: extractQuality(urlMatch[1]) !== 'Unknown' ? extractQuality(urlMatch[1]) : currentQuality
          });
        }
      }
      
      cdnLinks.push({
        serverUrl: serverUrl,
        links: links
      });
      
    } catch (error) {
      cdnLinks.push({
        serverUrl: serverUrl,
        links: [],
        error: error.message
      });
    }
  }
  
  return cdnLinks;
}

// API 3: Get Complete Movie Summary with All Qualities
async function getMovieSummary(movieUrl) {
  const steps = {
    step1_movieDetails: null,
    step2_qualityOptions: null,
    step3_allQualitiesData: []
  };
  
  try {
    // Step 1: Get movie details
    const details = await getMovieDetails(movieUrl);
    steps.step1_movieDetails = details;
    
    if (!details.originalMovieUrl) {
      throw new Error('No original movie URL found');
    }
    
    // Step 2: Get all quality options
    const qualities = await getQualityOptions(details.originalMovieUrl);
    steps.step2_qualityOptions = qualities;
    
    if (!qualities || qualities.length === 0) {
      throw new Error('No quality options found');
    }
    
    // Step 3: Get download info and CDN links for each quality
    for (const quality of qualities) {
      try {
        const downloadInfo = await getDownloadInfo(quality.url);
        
        if (downloadInfo.downloadPageUrl) {
          const servers = await getServerLinks(downloadInfo.downloadPageUrl);
          
          let cdnLinks = [];
          if (servers && servers.length > 0) {
            const serverUrls = servers.slice(0, 2).map(s => s.url); // First 2 servers
            const cdnData = await getActualCDNLinks(serverUrls, quality.quality);
            
            cdnData.forEach(server => {
              server.links.forEach(link => {
                cdnLinks.push({
                  serverUrl: server.serverUrl,
                  text: link.text,
                  cdnUrl: link.url,
                  quality: link.quality
                });
              });
            });
          }
          
          steps.step3_allQualitiesData.push({
            quality: quality.quality,
            qualityName: quality.name,
            qualityUrl: quality.url,
            fileSize: downloadInfo.fileSize,
            format: downloadInfo.format,
            fileName: downloadInfo.fileName,
            downloadPageUrl: downloadInfo.downloadPageUrl,
            servers: servers,
            cdnLinks: cdnLinks,
            totalCDNLinks: cdnLinks.length
          });
        }
      } catch (error) {
        steps.step3_allQualitiesData.push({
          quality: quality.quality,
          qualityName: quality.name,
          error: error.message
        });
      }
    }
    
    // Build summary
    const summary = {
      movie: details.title,
      director: details.director,
      starring: details.starring,
      genre: details.genre,
      rating: details.rating,
      language: details.language,
      synopsis: details.synopsis,
      poster: details.poster,
      totalQualities: steps.step3_allQualitiesData.length,
      qualities: steps.step3_allQualitiesData.map(q => ({
        quality: q.quality,
        fileSize: q.fileSize,
        format: q.format,
        totalCDNLinks: q.totalCDNLinks,
        cdnLinks: q.cdnLinks
      }))
    };
    
    return {
      success: true,
      summary,
      rawSteps: steps
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      rawSteps: steps
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

  const { action, categoryUrl, movieUrl, page } = req.query;

  try {
    switch (action) {
      // API 1: Get Year Categories
      case 'getYears':
        const categories = await getYearCategories();
        return res.status(200).json({
          success: true,
          data: categories,
          count: categories.length
        });

      // API 2: Get Movies with Pagination and Images
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
          data: result.movies,
          pagination: result.pagination,
          count: result.movies.length
        });

      // API 3: Get Movie Summary with All Qualities and CDN Links
      case 'getMovieSummary':
        if (!movieUrl) {
          return res.status(400).json({ 
            success: false, 
            error: 'movieUrl parameter is required' 
          });
        }
        const summary = await getMovieSummary(movieUrl);
        return res.status(200).json(summary);

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action parameter',
          availableActions: [
            'getYears - Get year categories list',
            'getMovies - Get movies with images (requires: categoryUrl, optional: page)',
            'getMovieSummary - Get complete movie info with all quality CDN links (requires: movieUrl)'
          ],
          examples: [
            '/api/scraper?action=getYears',
            '/api/scraper?action=getMovies&categoryUrl=https://moviesda14.com/tamil-2024-movies/&page=1',
            '/api/scraper?action=getMovieSummary&movieUrl=https://moviesda14.com/mithra-mandali-tamil-movie/'
          ]
        });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
