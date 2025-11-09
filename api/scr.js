// Add this helper function to your API or use it in your frontend

/**
 * Smart wrapper that automatically handles season selectors
 * @param {string} movieUrl - The movie/series URL
 * @param {boolean} showRaw - Whether to show raw debug data
 * @param {number} seasonIndex - Optional: Auto-select season by index (0-based)
 * @param {string} baseApiUrl - Your API base URL
 * @returns {Promise<Object>} Complete results with all episodes/qualities
 */
async function getCompleteLinksWithSeasonHandling(movieUrl, showRaw = false, seasonIndex = null, baseApiUrl = '/api/scr') {
  const apiUrl = `${baseApiUrl}?action=getCompleteLinks&movieUrl=${encodeURIComponent(movieUrl)}${showRaw ? '&raw=true' : ''}`;
  
  try {
    // Step 1: Initial fetch
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    if (!data.success) {
      return data;
    }
    
    // If it's a season selector, automatically fetch the first season (or specified season)
    if (data.contentType === 'webseries-selector') {
      const seasons = data.summary.seasons;
      
      if (!seasons || seasons.length === 0) {
        return {
          success: false,
          error: 'No seasons found in selector',
          originalData: data
        };
      }
      
      // Determine which season to fetch
      let selectedSeason;
      if (seasonIndex !== null && seasonIndex >= 0 && seasonIndex < seasons.length) {
        selectedSeason = seasons[seasonIndex];
      } else {
        selectedSeason = seasons[0]; // Default to first season
      }
      
      // Step 2: Fetch the selected season
      const seasonUrl = `${baseApiUrl}?action=getCompleteLinks&movieUrl=${encodeURIComponent(selectedSeason.url)}${showRaw ? '&raw=true' : ''}`;
      const seasonResponse = await fetch(seasonUrl);
      const seasonData = await seasonResponse.json();
      
      // Enhance response with season info
      return {
        ...seasonData,
        seasonInfo: {
          totalSeasonsAvailable: seasons.length,
          selectedSeason: selectedSeason,
          allSeasons: seasons
        }
      };
    }
    
    // If it's not a selector, return as-is
    return data;
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// USAGE EXAMPLES
// ============================================

// Example 1: Auto-fetch first season
async function example1() {
  const result = await getCompleteLinksWithSeasonHandling(
    'https://moviesda14.com/heart-beat-2025-tamil-movie/'
  );
  
  console.log('Content Type:', result.contentType);
  console.log('Total Episodes:', result.summary?.total);
  console.log('First Episode:', result.summary?.items[0]);
  
  // Access MP4 links
  if (result.success && result.summary?.items) {
    result.summary.items.forEach(item => {
      console.log(`\n${item.qualityName} (${item.fileSize}):`);
      item.cdnLinks.forEach(link => {
        console.log(`  - ${link.linkText}: ${link.cdnUrl}`);
      });
    });
  }
}

// Example 2: Regular movie (no season handling needed)
async function example2() {
  const result = await getCompleteLinksWithSeasonHandling(
    'https://moviesda14.com/kiss-original-movie/'
  );
  
  console.log('Qualities available:', result.summary?.items.map(i => i.quality));
}

// Example 3: Select specific season (if multiple seasons exist)
async function example3() {
  // Fetch season index 1 (second season)
  const result = await getCompleteLinksWithSeasonHandling(
    'https://moviesda14.com/some-series-with-multiple-seasons/',
    false, // showRaw
    1      // seasonIndex (0-based)
  );
  
  console.log('Selected Season:', result.seasonInfo?.selectedSeason.name);
  console.log('Episodes:', result.summary?.items.length);
}

// Example 4: Show all available seasons first, then let user choose
async function example4() {
  const initial = await getCompleteLinksWithSeasonHandling(
    'https://moviesda14.com/heart-beat-2025-tamil-movie/'
  );
  
  // Check if multiple seasons
  if (initial.seasonInfo && initial.seasonInfo.totalSeasonsAvailable > 1) {
    console.log('Available Seasons:');
    initial.seasonInfo.allSeasons.forEach((season, idx) => {
      console.log(`${idx}: ${season.name}`);
    });
    
    // Now you can let user select and call again with specific seasonIndex
    // const userChoice = 1; // User selected season 1
    // const result = await getCompleteLinksWithSeasonHandling(url, false, userChoice);
  }
  
  return initial;
}

// ============================================
// RESPONSE STRUCTURE
// ============================================

/*
For Web Series with Episodes:
{
  "success": true,
  "contentType": "webseries",
  "summary": {
    "title": "Heart Beat (Season 02)",
    "total": 16,
    "items": [
      {
        "quality": "Episode",
        "qualityName": "Moviesda.Mobi - Heart Beat 2025 Season 02 (Epi 97).mp4",
        "fileSize": "203.26 MB",
        "format": "Mp4",
        "fileName": "Moviesda.Mobi - Heart Beat 2025 Season 02 (Epi 97).mp4",
        "totalServers": 2,
        "totalCDNLinks": 4,
        "cdnLinks": [
          {
            "id": 1,
            "serverName": "Download Server 1",
            "serverUrl": "https://movies.downloadpage.site/download/file/93715",
            "linkText": "Download Server 1 - Final MP4",
            "cdnUrl": "https://big3.uptoweb.link/Moviesda.Mobi_-_Heart_Beat_2025_Season_02__Epi_97_.mp4",
            "quality": "Episode",
            "type": "final-mp4"
          },
          {
            "id": 2,
            "serverName": "Download Server 1",
            "serverUrl": "https://movies.downloadpage.site/download/file/93715",
            "linkText": "Download Server 1 - CDN",
            "cdnUrl": "https://big3.uptoweb.link/Moviesda.Mobi_-_Heart_Beat_2025_Season_02__Epi_97_.mp4",
            "quality": "Episode",
            "type": "cdn-link"
          }
        ]
      },
      // ... more episodes
    ]
  },
  "seasonInfo": {
    "totalSeasonsAvailable": 1,
    "selectedSeason": {
      "id": 1,
      "name": "Heart Beat (Season 02)",
      "url": "https://moviesda14.com/heart-beat-season-02-web-series/"
    },
    "allSeasons": [...]
  }
}

For Regular Movies:
{
  "success": true,
  "contentType": "movie",
  "summary": {
    "title": "Kiss (Original)",
    "director": "...",
    "starring": "...",
    "total": 3,
    "items": [
      {
        "quality": "1080P",
        "qualityName": "Kiss (1080p HD)",
        "fileSize": "1.2 GB",
        "format": "Mp4",
        "totalCDNLinks": 4,
        "cdnLinks": [...]
      },
      {
        "quality": "720P",
        "qualityName": "Kiss (720p HD)",
        "fileSize": "800 MB",
        "cdnLinks": [...]
      },
      {
        "quality": "360P",
        "qualityName": "Kiss (360p HD)",
        "fileSize": "400 MB",
        "cdnLinks": [...]
      }
    ]
  }
}
*/

// ============================================
// EXPORT FOR USE IN YOUR APP
// ============================================

export { getCompleteLinksWithSeasonHandling };

// Or if using CommonJS:
// module.exports = { getCompleteLinksWithSeasonHandling };
