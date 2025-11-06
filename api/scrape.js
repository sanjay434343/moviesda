// api/scraper.js - Get Direct MP4 & M3U8 Links for All Qualities
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

// API 2: Get Movies from Category with Poster Images (JPG)
async function getMoviesFromCategory(categoryUrl, page = 1) {
  const url = page > 1 ? `${categoryUrl}page/${page}/` : categoryUrl;
  const $ = await fetchPage(url);
  const movies = [];
  
  // Get movie links first
  const movieLinks = [];
  $('div.f a[href*="-tamil-movie/"]').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    
    if (text && href && href.includes('-tamil-movie/')) {
      movieLinks.push({
        name: text,
        url: href.startsWith('http') ? href : BASE_URL + href,
        slug: href.replace(/^\/|\/$/g, '')
      });
    }
  });
  
  // Fetch poster for each movie from its detail page
  for (const movie of movieLinks) {
    try {
      const moviePage = await fetchPage(movie.url);
      const posterSrc = moviePage('#movie-info img').attr('src') || 
                       moviePage('img[src*=".jpg"], img[src*=".jpeg"], img[src*=".png"]').first().attr('src');
      
      movies.push({
        id: movies.length + 1,
        name: movie.name,
        url: movie.url,
        poster: posterSrc ? (posterSrc.startsWith('http') ? posterSrc : BASE_URL + posterSrc) : null,
        slug: movie.slug
      });
    } catch (error) {
      movies.push({
        id: movies.length + 1,
        name: movie.name,
        url: movie.url,
        poster: null,
        slug: movie.slug
      });
    }
  }
  
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

// Helper: Extract Direct MP4 and M3U8 Links
async function extractDirectLinks(serverUrl, currentQuality) {
  try {
    const $ = await fetchPage(serverUrl);
    const directLinks = [];
    
    // Method 1: Direct download links (MP4, MKV)
    $('a[href*=".mp4"], a[href*=".mkv"], a[href*=".avi"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        directLinks.push({
          type: href.includes('.mp4') ? 'mp4' : (href.includes('.mkv') ? 'mkv' : 'video'),
          url: href,
          quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
        });
      }
    });
    
    // Method 2: M3U8 streaming links
    $('a[href*=".m3u8"], source[src*=".m3u8"]').each((i, el) => {
      const href = $(el).attr('href') || $(el).attr('src');
      if (href) {
        directLinks.push({
          type: 'm3u8',
          url: href,
          quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
        });
      }
    });
    
    // Method 3: CDN links in page content
    $('.download a, .dlink a, #download-link, .btn-download').each((i, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('hotshare') || href.includes('cdn') || href.includes('storage'))) {
        const ext = href.match(/\.(mp4|mkv|m3u8|avi)/i);
        directLinks.push({
          type: ext ? ext[1].toLowerCase() : 'cdn',
          url: href,
          quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
        });
      }
    });
    
    // Method 4: Extract from JavaScript
    $('script').each((i, el) => {
      const scriptContent = $(el).html();
      if (scriptContent) {
        // MP4 links
        const mp4Matches = scriptContent.match(/https?:\/\/[^\s"']+\.mp4/gi);
        if (mp4Matches) {
          mp4Matches.forEach(url => {
            directLinks.push({
              type: 'mp4',
              url: url,
              quality: extractQuality(url) !== 'Unknown' ? extractQuality(url) : currentQuality
            });
          });
        }
        
        // M3U8 links
        const m3u8Matches = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8/gi);
        if (m3u8Matches) {
          m3u8Matches.forEach(url => {
            directLinks.push({
              type: 'm3u8',
              url: url,
              quality: extractQuality(url) !== 'Unknown' ? extractQuality(url) : currentQuality
            });
          });
        }
      }
    });
    
    // Remove duplicates
    const uniqueLinks = [];
    const seen = new Set();
    directLinks.forEach(link => {
      if (!seen.has(link.url)) {
        seen.add(link.url);
        uniqueLinks.push(link);
      }
    });
    
    return uniqueLinks;
    
  } catch (error) {
    return [];
  }
}

// API 3: Get All Quality Direct Links (MP4 & M3U8)
async function getMovieSummary(movieUrl) {
  const steps = {
    step1_movieDetails: null,
    step2_qualityOptions: null,
    step3_allQualitiesDirectLinks: []
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
    
    // Step 3: Get direct links for each quality
    for (const quality of qualities) {
      try {
        const downloadInfo = await getDownloadInfo(quality.url);
        
        if (downloadInfo.downloadPageUrl) {
          const servers = await getServerLinks(downloadInfo.downloadPageUrl);
          
          let allDirectLinks = [];
          if (servers && servers.length > 0) {
            // Extract direct links from all servers
            for (const server of servers) {
              const directLinks = await extractDirectLinks(server.url, quality.quality);
              allDirectLinks = allDirectLinks.concat(directLinks);
            }
          }
          
          // Separate MP4 and M3U8 links
          const mp4Links = allDirectLinks.filter(link => link.type === 'mp4' || link.type === 'mkv' || link.type === 'cdn');
          const m3u8Links = allDirectLinks.filter(link => link.type === 'm3u8');
          
          steps.step3_allQualitiesDirectLinks.push({
            quality: quality.quality,
            qualityName: quality.name,
            fileSize: downloadInfo.fileSize,
            format: downloadInfo.format,
            mp4Links: mp4Links,
            m3u8Links: m3u8Links,
            totalMP4: mp4Links.length,
            totalM3U8: m3u8Links.length
          });
        }
      } catch (error) {
        steps.step3_allQualitiesDirectLinks.push({
          quality: quality.quality,
          qualityName: quality.name,
          error: error.message
        });
      }
    }
    
    // Build summary with direct links
    const allMP4Links = [];
    const allM3U8Links = [];
    
    steps.step3_allQualitiesDirectLinks.forEach(qualityData => {
      if (qualityData.mp4Links) {
        qualityData.mp4Links.forEach(link => {
          allMP4Links.push({
            quality: qualityData.quality,
            type: link.type,
            url: link.url
          });
        });
      }
      if (qualityData.m3u8Links) {
        qualityData.m3u8Links.forEach(link => {
          allM3U8Links.push({
            quality: qualityData.quality,
            type: 'm3u8',
            url: link.url
          });
        });
      }
    });
    
    const summary = {
      movie: details.title,
      director: details.director,
      starring: details.starring,
      genre: details.genre,
      rating: details.rating,
      language: details.language,
      synopsis: details.synopsis,
      poster: details.poster,
      totalQualities: steps.step3_allQualitiesDirectLinks.length,
      totalMP4Links: allMP4Links.length,
      totalM3U8Links: allM3U8Links.length,
      directMP4Links: allMP4Links,
      directM3U8Links: allM3U8Links,
      qualityWiseBreakdown: steps.step3_allQualitiesDirectLinks.map(q => ({
        quality: q.quality,
        fileSize: q.fileSize,
        format: q.format,
        totalMP4: q.totalMP4,
        totalM3U8: q.totalM3U8
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

      // API 2: Get Movies with Poster Images (JPG)
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

      // API 3: Get Movie Summary with ALL Direct MP4 & M3U8 Links
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
            'getMovies - Get movies with poster images (requires: categoryUrl, optional: page)',
            'getMovieSummary - Get ALL direct MP4 & M3U8 links for all qualities (requires: movieUrl)'
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
