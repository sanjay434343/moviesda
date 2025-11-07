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

function extractQuality(text) {
  const qualityMatch = text.match(/(\d{3,4}p|4K|2K|HD|SD)/i);
  return qualityMatch ? qualityMatch[1].toUpperCase() : 'Unknown';
}

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

// Enhanced metadata extraction for both old and new structures
function extractMetadata($) {
  const metadata = {
    title: '',
    director: '',
    starring: '',
    genre: '',
    rating: '',
    language: '',
    synopsis: '',
    releaseDate: '',
    duration: ''
  };

  // Extract title from multiple possible locations
  metadata.title = $('div.line').first().text().trim() || 
                   $('.movie-title, h1.entry-title').first().text().trim() ||
                   $('title').text().split('|')[0].trim();

  // 2025 structure: #movie-info ul.movie-info li
  $('#movie-info ul.movie-info li, .movie-info li').each((i, el) => {
    const text = $(el).text();
    const spanText = $(el).find('span').text().trim();
    
    if (text.includes('Director:')) metadata.director = spanText;
    if (text.includes('Starring:')) metadata.starring = spanText;
    if (text.includes('Genres:') || text.includes('Genre:')) metadata.genre = spanText;
    if (text.includes('Movie Rating:') || text.includes('Rating:')) metadata.rating = spanText;
    if (text.includes('Language:')) metadata.language = spanText;
    if (text.includes('Release Date:')) metadata.releaseDate = spanText;
    if (text.includes('Duration:')) metadata.duration = spanText;
  });

  // Old structure: Check alternative selectors
  if (!metadata.director) {
    metadata.director = $('.director, .movie-director, [itemprop="director"]').text().trim();
  }
  if (!metadata.starring) {
    metadata.starring = $('.cast, .actors, [itemprop="actor"]').text().trim();
  }
  if (!metadata.genre) {
    const genres = [];
    $('.genre, .genres a, [rel="tag"]').each((i, el) => {
      const g = $(el).text().trim();
      if (g && !genres.includes(g)) genres.push(g);
    });
    metadata.genre = genres.join(', ');
  }
  if (!metadata.rating) {
    metadata.rating = $('.rating, .imdb-rating, [itemprop="ratingValue"]').text().trim();
  }
  if (!metadata.language) {
    metadata.language = $('.language, .movie-language').text().trim();
  }

  // Synopsis extraction
  metadata.synopsis = $('.movie-synopsis, .synopsis, .description, .plot, [itemprop="description"]')
    .first()
    .text()
    .replace(/Synopsis:|Description:|Plot:/gi, '')
    .trim();

  // Poster extraction
  const poster = getValidPosterFromPicture($, '#movie-info') ||
                 getValidPosterFromPicture($, '.movie-poster') ||
                 getValidPosterFromPicture($, '.poster') ||
                 $('.movie-poster img, .poster img, [itemprop="image"]').attr('src');

  return { ...metadata, poster: poster || null };
}

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
      poster: img || null,
      type: href.includes('web-series') ? 'series' : 'movie'
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

async function getMovieDetails(movieUrl) {
  const $ = await fetchPage(movieUrl);
  const metadata = extractMetadata($);

  const details = {
    ...metadata,
    qualities: [],
    type: movieUrl.includes('web-series') ? 'series' : 'movie',
    episodes: []
  };

  // Check if it's a web series with episodes
  if (details.type === 'series') {
    $('div.f').each((i, el) => {
      const episodeLink = $(el).find('.mv-content .left ul li a').first();
      const episodeName = episodeLink.find('strong').text().trim() || episodeLink.text().trim();
      const episodeUrl = episodeLink.attr('href');
      const fileSize = $(el).find('.left ul li:contains("File Size:")').text().replace('File Size:', '').trim();
      const thumbnail = $(el).find('.tblimg img').attr('src');

      if (episodeUrl) {
        details.episodes.push({
          id: details.episodes.length + 1,
          name: episodeName,
          url: episodeUrl.startsWith('http') ? episodeUrl : BASE_URL + episodeUrl,
          fileSize: fileSize || 'N/A',
          thumbnail: thumbnail && thumbnail.startsWith('http') ? thumbnail : (thumbnail ? BASE_URL + thumbnail : null)
        });
      }
    });
  } else {
    // For movies, get quality links
    $('div.f a, .download-links a, .quality-links a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (!href) return;
      
      if (/\d{3,4}p|hd.*movie/i.test(text) || /\d{3,4}p|hd.*movie/i.test(href)) {
        const quality = extractQuality(text);
        details.qualities.push({
          id: details.qualities.length + 1,
          name: text,
          url: href.startsWith('http') ? href : BASE_URL + href,
          quality: quality
        });
      }
    });
  }

  return details;
}

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

  $('.mv-content .left ul li, .download-info li').each((i, el) => {
    const text = $(el).text();
    if (text.includes('File Size:')) info.fileSize = text.replace('File Size:', '').trim();
    if (text.includes('Download Format:')) info.format = text.replace('Download Format:', '').trim();
  });

  const downloadLink = $('.mv-content .left ul li a, .download-link a').attr('href');
  if (downloadLink) {
    info.downloadPageUrl = downloadLink.startsWith('http') ? downloadLink : BASE_URL + downloadLink;
  }
  info.fileName = $('.mv-content .left ul li strong, .file-name').text().trim();
  return info;
}

async function getServerLinks(downloadPageUrl) {
  const $ = await fetchPage(downloadPageUrl);
  const servers = [];

  $('.download .dlink a, .songinfo .download .dlink a, .server-links a').each((i, el) => {
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

// Remove duplicate MP4 links
function deduplicateMP4Links(links) {
  const seen = new Map();
  
  links.forEach(link => {
    const key = link.mp4Url;
    if (!seen.has(key)) {
      seen.set(key, link);
    }
  });
  
  return Array.from(seen.values()).map((link, index) => ({
    ...link,
    id: index + 1
  }));
}

async function getMP4LinkFromDownloadPage(downloadPageUrl, currentQuality = 'Unknown') {
  try {
    const $ = await fetchPage(downloadPageUrl);
    const mp4Links = [];
    
    // Method 1: Direct MP4 links in href attributes
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && (href.endsWith('.mp4') || href.endsWith('.mkv') || href.includes('hotshare') && href.includes('.mp4'))) {
        mp4Links.push({
          text: $(el).text().trim() || 'Direct MP4',
          url: href,
          type: 'direct',
          quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
        });
      }
    });
    
    // Method 2: MP4 links in scripts
    $('script').each((i, el) => {
      const scriptContent = $(el).html();
      if (scriptContent) {
        const urlMatches = scriptContent.match(/https?:\/\/[^\s"'<>]+\.(mp4|mkv|avi)/gi);
        if (urlMatches) {
          urlMatches.forEach(url => {
            const cleanUrl = url.replace(/[\\'"]/g, '');
            if (!mp4Links.some(link => link.url === cleanUrl)) {
              mp4Links.push({
                text: 'CDN Link',
                url: cleanUrl,
                type: 'script',
                quality: extractQuality(cleanUrl) !== 'Unknown' ? extractQuality(cleanUrl) : currentQuality
              });
            }
          });
        }
      }
    });
    
    // Method 3: Meta refresh redirect
    const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
    if (metaRefresh) {
      const urlMatch = metaRefresh.match(/url=(.+)/i);
      if (urlMatch && urlMatch[1]) {
        const redirectUrl = urlMatch[1].trim();
        if (redirectUrl.endsWith('.mp4') || redirectUrl.endsWith('.mkv')) {
          mp4Links.push({
            text: 'Redirect MP4',
            url: redirectUrl,
            type: 'redirect',
            quality: extractQuality(redirectUrl) !== 'Unknown' ? extractQuality(redirectUrl) : currentQuality
          });
        }
      }
    }
    
    // Method 4: Check for download buttons
    $('button, .download-btn, #download-link').each((i, el) => {
      const onclick = $(el).attr('onclick');
      const dataUrl = $(el).attr('data-url') || $(el).attr('data-link');
      
      if (onclick) {
        const urlMatch = onclick.match(/https?:\/\/[^\s"']+\.(mp4|mkv)/i);
        if (urlMatch) {
          mp4Links.push({
            text: 'Button Link',
            url: urlMatch[0],
            type: 'onclick',
            quality: extractQuality(urlMatch[0]) !== 'Unknown' ? extractQuality(urlMatch[0]) : currentQuality
          });
        }
      }
      
      if (dataUrl && (dataUrl.endsWith('.mp4') || dataUrl.endsWith('.mkv'))) {
        mp4Links.push({
          text: 'Data Link',
          url: dataUrl,
          type: 'data-attribute',
          quality: extractQuality(dataUrl) !== 'Unknown' ? extractQuality(dataUrl) : currentQuality
        });
      }
    });
    
    return mp4Links;
  } catch (error) {
    return [];
  }
}

async function getActualCDNLinks(serverUrls, currentQuality = 'Unknown') {
  const cdnLinks = [];
  
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      const intermediateLinks = [];
      
      $('.download a, .dlink a, #download-link, .btn-download').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && text.toLowerCase().includes('download')) {
          intermediateLinks.push({
            text: text,
            url: href
          });
        }
      });
      
      const mp4Links = [];
      for (const intermediateLink of intermediateLinks) {
        const mp4Results = await getMP4LinkFromDownloadPage(intermediateLink.url, currentQuality);
        mp4Results.forEach(mp4 => {
          mp4Links.push({
            intermediateServer: intermediateLink.text,
            intermediateUrl: intermediateLink.url,
            ...mp4
          });
        });
      }
      
      cdnLinks.push({
        serverUrl: serverUrl,
        links: mp4Links,
        found: mp4Links.length
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

async function getAllQualitiesWithLinks(movieUrl) {
  const details = await getMovieDetails(movieUrl);
  const allQualityData = [];

  if (details.type === 'series') {
    for (const episode of details.episodes) {
      try {
        const servers = await getServerLinks(episode.url);
        const serverUrls = servers.map(s => s.url);
        const cdnLinks = await getActualCDNLinks(serverUrls, 'HD');
        
        const episodeCDNLinks = [];
        cdnLinks.forEach((server, idx) => {
          server.links.forEach(link => {
            episodeCDNLinks.push({
              id: episodeCDNLinks.length + 1,
              serverName: link.intermediateServer || servers[idx]?.name || `Server ${idx + 1}`,
              serverUrl: server.serverUrl,
              intermediateUrl: link.intermediateUrl || server.serverUrl,
              linkText: link.text,
              mp4Url: link.url,
              quality: link.quality,
              type: link.type
            });
          });
        });

        // Deduplicate MP4 links
        const uniqueLinks = deduplicateMP4Links(episodeCDNLinks);

        allQualityData.push({
          episode: episode.name,
          fileSize: episode.fileSize,
          thumbnail: episode.thumbnail,
          cdnLinks: uniqueLinks,
          totalLinks: uniqueLinks.length
        });
      } catch (error) {
        allQualityData.push({
          episode: episode.name,
          error: error.message,
          cdnLinks: [],
          totalLinks: 0
        });
      }
    }

    return {
      success: true,
      type: 'series',
      title: details.title,
      director: details.director,
      starring: details.starring,
      genre: details.genre,
      rating: details.rating,
      language: details.language,
      synopsis: details.synopsis,
      poster: details.poster,
      totalEpisodes: details.episodes.length,
      episodes: allQualityData
    };
  } else {
    for (const quality of details.qualities) {
      try {
        const downloadInfo = await getDownloadInfo(quality.url);
        const servers = await getServerLinks(downloadInfo.downloadPageUrl);
        const serverUrls = servers.map(s => s.url);
        const cdnLinks = await getActualCDNLinks(serverUrls, quality.quality);
        
        const qualityCDNLinks = [];
        cdnLinks.forEach((server, idx) => {
          server.links.forEach(link => {
            qualityCDNLinks.push({
              id: qualityCDNLinks.length + 1,
              serverName: link.intermediateServer || servers[idx]?.name || `Server ${idx + 1}`,
              serverUrl: server.serverUrl,
              intermediateUrl: link.intermediateUrl || server.serverUrl,
              linkText: link.text,
              mp4Url: link.url,
              quality: link.quality,
              type: link.type
            });
          });
        });

        // Deduplicate MP4 links
        const uniqueLinks = deduplicateMP4Links(qualityCDNLinks);

        allQualityData.push({
          quality: quality.quality,
          qualityName: quality.name,
          fileSize: downloadInfo.fileSize,
          format: downloadInfo.format,
          cdnLinks: uniqueLinks,
          totalLinks: uniqueLinks.length
        });
      } catch (error) {
        allQualityData.push({
          quality: quality.quality,
          qualityName: quality.name,
          error: error.message,
          cdnLinks: [],
          totalLinks: 0
        });
      }
    }

    return {
      success: true,
      type: 'movie',
      title: details.title,
      director: details.director,
      starring: details.starring,
      genre: details.genre,
      rating: details.rating,
      language: details.language,
      synopsis: details.synopsis,
      releaseDate: details.releaseDate,
      duration: details.duration,
      poster: details.poster,
      totalQualities: details.qualities.length,
      qualities: allQualityData
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

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

      case 'getAllQualities':
        if (!movieUrl) return res.status(400).json({ success: false, error: 'movieUrl parameter is required' });
        const allQualities = await getAllQualitiesWithLinks(movieUrl);
        return res.status(200).json(allQualities);

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action parameter',
          availableActions: [
            'getYears - Get all year categories',
            'getMovies - Get movies from a category (requires categoryUrl, optional: page)',
            'getMovieDetails - Get movie details with full metadata (requires movieUrl)',
            'getAllQualities - Get ALL qualities with unique CDN links (requires movieUrl)'
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
