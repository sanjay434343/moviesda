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

// Step 3: Get movie details with better detection
async function getMovieDetails(movieUrl) {
  const $ = await fetchPage(movieUrl);

  const details = {
    title: $('div.line h1').text().trim() || $('div.line').first().text().trim() || $('title').text().split('|')[0].trim(),
    director: '',
    starring: '',
    genre: '',
    rating: '',
    language: '',
    synopsis: '',
    poster: '',
    contentType: 'movie', // 'movie' or 'webseries'
    qualities: [],
    episodes: []
  };

  // Get movie info
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

  // Check if it's a web series or movie with episodes
  const isWebSeries = movieUrl.includes('web-series') || $('div.f .mv-content').length > 0;
  
  if (isWebSeries) {
    details.contentType = 'webseries';
    
    // Extract episodes
    $('div.f .mv-content').each((i, el) => {
      const episodeName = $(el).find('.left ul li a strong').text().trim();
      const episodeUrl = $(el).find('.left ul li a').attr('href');
      const fileSize = $(el).find('.left ul li').filter((i, li) => $(li).text().includes('File Size:')).text().replace('File Size:', '').trim();
      const format = $(el).find('.left ul li').filter((i, li) => $(li).text().includes('Download Format:')).text().replace('Download Format:', '').trim();
      const thumbnail = $(el).find('.tblimg img').attr('src');
      
      if (episodeUrl) {
        details.episodes.push({
          id: details.episodes.length + 1,
          name: episodeName,
          url: episodeUrl.startsWith('http') ? episodeUrl : BASE_URL + episodeUrl,
          fileSize: fileSize,
          format: format,
          thumbnail: thumbnail && thumbnail.startsWith('http') ? thumbnail : (thumbnail ? BASE_URL + thumbnail : null)
        });
      }
    });
  }

  // Get quality links for regular movies
  $('div.f a, a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;
    
    // Look for original movie links or quality links
    if (/original.*movie/i.test(href) || 
        /original/i.test(text) || 
        /hd-movie|p-movie/i.test(href) || 
        /1080p|720p|360p/i.test(text)) {
      
      const isDuplicate = details.qualities.some(q => q.url === (href.startsWith('http') ? href : BASE_URL + href));
      if (!isDuplicate) {
        details.qualities.push({
          id: details.qualities.length + 1,
          name: text,
          url: href.startsWith('http') ? href : BASE_URL + href,
          quality: extractQuality(text)
        });
      }
    }
  });

  return details;
}

// Step 4: Get quality options (360p, 720p, 1080p) from original page
async function getQualityOptions(originalUrl) {
  const $ = await fetchPage(originalUrl);
  const options = [];

  $('div.f a, a').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    if (!href) return;

    if (/hd-movie|p-movie/i.test(href) || /1080p|720p|360p/i.test(text)) {
      const isDuplicate = options.some(o => o.url === (href.startsWith('http') ? href : BASE_URL + href));
      if (!isDuplicate) {
        options.push({
          id: options.length + 1,
          name: text,
          url: href.startsWith('http') ? href : BASE_URL + href,
          quality: extractQuality(text)
        });
      }
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

// Step 7: Get actual MP4/CDN links from server pages (goes deeper into download pages)
async function getActualCDNLinks(serverUrls, currentQuality = 'Unknown') {
  const cdnLinks = [];
  
  for (const serverUrl of serverUrls) {
    try {
      const $ = await fetchPage(serverUrl);
      const links = [];
      const intermediateLinkPages = [];
      
      // First, collect all potential download page links
      $('.download a, .dlink a, #download-link, .btn-download').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        
        if (href) {
          // Check if it's a direct MP4/MKV link
          if (href.includes('.mp4') || href.includes('.mkv') || href.includes('.avi')) {
            links.push({
              text: text || 'Direct Download',
              url: href,
              type: 'direct',
              quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
            });
          }
          // Check if it's an intermediate download page (hotshare, cdn, storage, etc.)
          else if (
            href.includes('hotshare') || 
            href.includes('cdn') || 
            href.includes('storage') || 
            href.includes('download') ||
            href.includes('moviespage.site') ||
            text.toLowerCase().includes('download')
          ) {
            intermediateLinkPages.push({
              url: href,
              text: text || 'Download Link'
            });
          }
        }
      });
      
      // Check scripts for direct MP4 links
      $('script').each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent) {
          const urlMatches = scriptContent.match(/https?:\/\/[^\s"']+\.(mp4|mkv|avi)/gi);
          if (urlMatches) {
            urlMatches.forEach(url => {
              links.push({
                text: 'Script CDN Link',
                url: url,
                type: 'script',
                quality: extractQuality(url) !== 'Unknown' ? extractQuality(url) : currentQuality
              });
            });
          }
        }
      });
      
      // Check meta refresh redirects
      const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
      if (metaRefresh) {
        const urlMatch = metaRefresh.match(/url=(.+)/i);
        if (urlMatch && urlMatch[1]) {
          const redirectUrl = urlMatch[1];
          if (redirectUrl.includes('.mp4') || redirectUrl.includes('.mkv')) {
            links.push({
              text: 'Meta Redirect',
              url: redirectUrl,
              type: 'redirect',
              quality: extractQuality(redirectUrl) !== 'Unknown' ? extractQuality(redirectUrl) : currentQuality
            });
          } else {
            intermediateLinkPages.push({
              url: redirectUrl,
              text: 'Meta Redirect Page'
            });
          }
        }
      }
      
      // NOW: Go deeper into intermediate pages to find actual MP4 links
      for (const intermediatePage of intermediateLinkPages) {
        try {
          const $inner = await fetchPage(intermediatePage.url);
          
          // Look for direct download links in the inner page
          $inner('a').each((i, el) => {
            const href = $inner(el).attr('href');
            const text = $inner(el).text().trim();
            
            if (href && (href.includes('.mp4') || href.includes('.mkv') || href.includes('.avi') || 
                         href.includes('hotshare.link') || href.includes('s0') || 
                         text.toLowerCase().includes('download'))) {
              
              // Check if this is a hotshare-style CDN link
              if (href.includes('hotshare') || /s\d+\./.test(href)) {
                links.push({
                  text: intermediatePage.text + ' - ' + (text || 'CDN Link'),
                  url: href,
                  type: 'cdn',
                  intermediateUrl: intermediatePage.url,
                  quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
                });
              } else if (href.includes('.mp4') || href.includes('.mkv')) {
                links.push({
                  text: intermediatePage.text + ' - Direct',
                  url: href,
                  type: 'direct',
                  intermediateUrl: intermediatePage.url,
                  quality: extractQuality(href) !== 'Unknown' ? extractQuality(href) : currentQuality
                });
              }
            }
          });
          
          // Check scripts in inner page
          $inner('script').each((i, el) => {
            const scriptContent = $inner(el).html();
            if (scriptContent) {
              // Look for direct MP4/MKV URLs
              const urlMatches = scriptContent.match(/https?:\/\/[^\s"']+\.(mp4|mkv|avi)/gi);
              if (urlMatches) {
                urlMatches.forEach(url => {
                  links.push({
                    text: intermediatePage.text + ' - Script',
                    url: url,
                    type: 'script',
                    intermediateUrl: intermediatePage.url,
                    quality: extractQuality(url) !== 'Unknown' ? extractQuality(url) : currentQuality
                  });
                });
              }
              
              // Look for hotshare-style links in scripts
              const hotshareMatches = scriptContent.match(/https?:\/\/s\d+\.hotshare\.link\/[^\s"']+/gi);
              if (hotshareMatches) {
                hotshareMatches.forEach(url => {
                  links.push({
                    text: intermediatePage.text + ' - Hotshare CDN',
                    url: url,
                    type: 'cdn',
                    intermediateUrl: intermediatePage.url,
                    quality: extractQuality(url) !== 'Unknown' ? extractQuality(url) : currentQuality
                  });
                });
              }
            }
          });
          
          // Check meta refresh in inner page
          const innerMetaRefresh = $inner('meta[http-equiv="refresh"]').attr('content');
          if (innerMetaRefresh) {
            const urlMatch = innerMetaRefresh.match(/url=(.+)/i);
            if (urlMatch && urlMatch[1]) {
              links.push({
                text: intermediatePage.text + ' - Meta Redirect',
                url: urlMatch[1],
                type: 'redirect',
                intermediateUrl: intermediatePage.url,
                quality: extractQuality(urlMatch[1]) !== 'Unknown' ? extractQuality(urlMatch[1]) : currentQuality
              });
            }
          }
          
        } catch (innerError) {
          // If we can't fetch the intermediate page, just skip it
          console.error(`Failed to fetch intermediate page ${intermediatePage.url}:`, innerError.message);
        }
      }
      
      cdnLinks.push({
        serverUrl: serverUrl,
        links: links,
        found: links.length,
        intermediatePages: intermediateLinkPages.length
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

// NEW: Process all qualities
async function processAllQualities(qualities, steps, showRaw) {
  const allQualitiesData = [];
  
  for (let i = 0; i < qualities.length; i++) {
    const quality = qualities[i];
    const qualityData = {
      qualityName: quality.name,
      quality: quality.quality,
      qualityUrl: quality.url,
      downloadInfo: null,
      servers: [],
      cdnLinks: [],
      rawSteps: []
    };
    
    try {
      // Step: Get download info for this quality
      const stepIndex = steps.length;
      if (showRaw) {
        qualityData.rawSteps.push({
          step: 'getDownloadInfo',
          url: quality.url,
          status: '⏳ pending'
        });
      }
      
      const downloadInfo = await getDownloadInfo(quality.url);
      qualityData.downloadInfo = downloadInfo;
      
      if (showRaw) {
        qualityData.rawSteps[qualityData.rawSteps.length - 1].status = '✅ completed';
        qualityData.rawSteps[qualityData.rawSteps.length - 1].data = downloadInfo;
      }
      
      if (!downloadInfo.downloadPageUrl) {
        if (showRaw) {
          qualityData.rawSteps.push({
            step: 'error',
            message: 'No download page URL found',
            status: '❌ failed'
          });
        }
        allQualitiesData.push(qualityData);
        continue;
      }
      
      // Step: Get server links
      if (showRaw) {
        qualityData.rawSteps.push({
          step: 'getServerLinks',
          url: downloadInfo.downloadPageUrl,
          status: '⏳ pending'
        });
      }
      
      const servers = await getServerLinks(downloadInfo.downloadPageUrl);
      qualityData.servers = servers;
      
      if (showRaw) {
        qualityData.rawSteps[qualityData.rawSteps.length - 1].status = '✅ completed';
        qualityData.rawSteps[qualityData.rawSteps.length - 1].data = servers;
      }
      
      if (!servers || servers.length === 0) {
        if (showRaw) {
          qualityData.rawSteps.push({
            step: 'error',
            message: 'No server links found',
            status: '❌ failed'
          });
        }
        allQualitiesData.push(qualityData);
        continue;
      }
      
      // Step: Get CDN links from all servers
      if (showRaw) {
        qualityData.rawSteps.push({
          step: 'getCDNLinks',
          serverCount: servers.length,
          status: '⏳ pending'
        });
      }
      
      const serverUrls = servers.map(s => s.url);
      const cdnLinks = await getActualCDNLinks(serverUrls, quality.quality);
      qualityData.cdnLinks = cdnLinks;
      
      if (showRaw) {
        qualityData.rawSteps[qualityData.rawSteps.length - 1].status = '✅ completed';
        qualityData.rawSteps[qualityData.rawSteps.length - 1].data = cdnLinks;
      }
      
    } catch (error) {
      if (showRaw) {
        qualityData.rawSteps.push({
          step: 'error',
          message: error.message,
          status: '❌ failed'
        });
      }
      qualityData.error = error.message;
    }
    
    allQualitiesData.push(qualityData);
  }
  
  return allQualitiesData;
}

// Complete scraping flow with ALL qualities support
async function getCompleteMovieLinks(movieUrl, showRaw = false) {
  const steps = [];
  
  try {
    // Step 1: Get movie details
    steps.push({ 
      step: 1, 
      status: '⏳ pending', 
      message: 'Fetching movie details...', 
      url: movieUrl 
    });
    
    const details = await getMovieDetails(movieUrl);
    steps[0].status = '✅ completed';
    steps[0].data = details;

    // Handle web series differently
    if (details.contentType === 'webseries') {
      if (showRaw) {
        return {
          success: true,
          contentType: 'webseries',
          steps,
          summary: {
            title: details.title,
            poster: details.poster,
            totalEpisodes: details.episodes.length,
            episodes: details.episodes
          }
        };
      } else {
        return {
          success: true,
          contentType: 'webseries',
          summary: {
            title: details.title,
            poster: details.poster,
            totalEpisodes: details.episodes.length,
            episodes: details.episodes
          }
        };
      }
    }

    // Handle regular movies
    if (!details.qualities || details.qualities.length === 0) {
      throw new Error('No quality options found on movie page');
    }

    // Step 2: Check if we need to get quality options from original page
    let allQualities = details.qualities;
    
    // If we have an "original" link, fetch all quality options from it
    const originalLink = details.qualities.find(q => /original/i.test(q.name) || /original/i.test(q.url));
    if (originalLink) {
      steps.push({ 
        step: 2, 
        status: '⏳ pending', 
        message: 'Fetching all quality options (1080p, 720p, 360p)...', 
        url: originalLink.url 
      });
      
      const qualityOptions = await getQualityOptions(originalLink.url);
      if (qualityOptions.length > 0) {
        allQualities = qualityOptions;
      }
      
      steps[1].status = '✅ completed';
      steps[1].data = qualityOptions;
    }

    // Step 3: Process ALL qualities
    steps.push({ 
      step: 3, 
      status: '⏳ pending', 
      message: `Processing all ${allQualities.length} quality options...`, 
      count: allQualities.length 
    });
    
    const allQualitiesData = await processAllQualities(allQualities, steps, showRaw);
    
    steps[steps.length - 1].status = '✅ completed';
    steps[steps.length - 1].data = { processedQualities: allQualitiesData.length };

    // Build final output
    const qualitiesSummary = allQualitiesData.map(qData => {
      const allCDNLinks = [];
      
      qData.cdnLinks.forEach((server, idx) => {
        server.links.forEach(link => {
          allCDNLinks.push({
            id: allCDNLinks.length + 1,
            serverName: qData.servers[idx]?.name || `Server ${idx + 1}`,
            serverUrl: server.serverUrl,
            linkText: link.text,
            cdnUrl: link.url,
            quality: link.quality,
            type: link.type
          });
        });
      });

      return {
        quality: qData.quality,
        qualityName: qData.qualityName,
        fileSize: qData.downloadInfo?.fileSize || 'N/A',
        format: qData.downloadInfo?.format || 'Mp4',
        fileName: qData.downloadInfo?.fileName || '',
        totalServers: qData.servers.length,
        totalCDNLinks: allCDNLinks.length,
        cdnLinks: allCDNLinks,
        ...(showRaw && { rawData: qData })
      };
    });

    if (showRaw) {
      return {
        success: true,
        contentType: 'movie',
        steps,
        summary: {
          movie: details.title,
          director: details.director,
          starring: details.starring,
          genre: details.genre,
          rating: details.rating,
          poster: details.poster,
          totalQualities: qualitiesSummary.length,
          qualities: qualitiesSummary
        }
      };
    } else {
      return {
        success: true,
        contentType: 'movie',
        summary: {
          movie: details.title,
          director: details.director,
          starring: details.starring,
          genre: details.genre,
          rating: details.rating,
          poster: details.poster,
          totalQualities: qualitiesSummary.length,
          qualities: qualitiesSummary
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
      steps: showRaw ? steps : undefined
    };
  }
}

// Main API Handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { 
    action, 
    categoryUrl, 
    movieUrl, 
    originalUrl, 
    qualityUrl, 
    downloadUrl, 
    serverUrl, 
    page, 
    showSteps,
    raw 
  } = req.query;

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
        const showRawData = raw === 'true' || showSteps === 'true';
        const complete = await getCompleteMovieLinks(movieUrl, showRawData);
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
            'getCompleteLinks - Get ALL quality links including CDN (requires movieUrl, optional: raw=true for detailed steps)'
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
