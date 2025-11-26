/**
 * @file packages/api/lib/vimeoClient.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Vimeo API client for extracting video IDs from showcases and enabling video playback.
 */

import axios from 'axios';

const VIMEO_API_BASE = process.env.VIMEO_API_BASE_URL || 'https://api.vimeo.com';
const VIMEO_BEARER_TOKEN = process.env.VIMEO_BEARER_TOKEN;

// Parse VIMEO_ALLOWED_DOMAINS as comma-separated list or JSON array
let VIMEO_ALLOWED_DOMAINS: string[] = [];
if (process.env.VIMEO_ALLOWED_DOMAINS) {
  try {
    // Try parsing as JSON array first
    VIMEO_ALLOWED_DOMAINS = JSON.parse(process.env.VIMEO_ALLOWED_DOMAINS);
    if (!Array.isArray(VIMEO_ALLOWED_DOMAINS)) {
      throw new Error('Not an array');
    }
  } catch {
    // If not JSON, treat as comma-separated string
    VIMEO_ALLOWED_DOMAINS = process.env.VIMEO_ALLOWED_DOMAINS
      .split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0);
  }
}

if (!VIMEO_BEARER_TOKEN) {
  console.warn('VIMEO_BEARER_TOKEN environment variable is not set');
}

if (VIMEO_ALLOWED_DOMAINS.length === 0) {
  console.warn('VIMEO_ALLOWED_DOMAINS environment variable is not set or empty');
}

/**
 * Language detection from video name
 */
function detectLanguage(name: string): string {
  if (name.includes('English') || name.includes('Foundations of Compassion Refuge Sept 12 2012')) {
    return 'English';
  } else if (name.includes('Portuguese') || name.includes('Portugese')) {
    return 'Portuguese';
  } else if (name.includes('Spanish')) {
    return 'Spanish';
  } else if (name.includes('Italian') || name.includes('Itailan')) {
    return 'Italian';
  } else if (name.includes('German')) {
    return 'German';
  } else if (name.includes('Czech')) {
    return 'Czech';
  } else if (name.includes('French')) {
    return 'French';
  } else if (name.includes('Chinese') || name.includes('Mandarin') || name.includes('Cantonese')) {
    return 'Chinese';
  }
  // Default to English if unknown
  console.log('ASSUMING ENGLISH: Unknown language:', name);
  return 'English';
}

/**
 * Extract video IDs from a showcase
 * @param showcaseId - The Vimeo showcase ID
 * @param perLanguage - If true, treats showcase as per-language (all videos in one language). 
 *                     If false, treats showcase as multi-language (one video per day with multiple language tracks).
 * @returns Array of video objects with videoId, name, and language
 */
export async function getShowcaseVideos(
  showcaseId: string,
  perLanguage: boolean = false
): Promise<Array<{ videoId: string; name: string; language: string; index?: number }>> {
  if (!VIMEO_BEARER_TOKEN) {
    throw new Error('VIMEO_BEARER_TOKEN environment variable is not set');
  }

  const url = `${VIMEO_API_BASE}/me/albums/${showcaseId}/videos`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${VIMEO_BEARER_TOKEN}`,
  };

  try {
    const response = await axios.get(url, { headers });

    const result = response.data;

    if (!result.data || result.data.length === 0) {
      throw new Error('Showcase has no videos');
    }

    const resultList: Array<{ videoId: string; name: string; language: string; index?: number }> = [];

    if (perLanguage) {
      // Per-language mode: all videos in showcase are the same language
      // We need to determine the language from the first video or parameter
      // For now, we'll extract from the first video name
      let language = 'English'; // default
      if (result.data.length > 0) {
        language = detectLanguage(result.data[0].name);
      }

      // All videos get the same language
      // Index starts from the end and decrements (matching Python script behavior)
      // Last video in showcase = index 0, first video = highest index
      let index = result.data.length - 1;
      for (const entry of result.data) {
        const videoId = entry.uri.replace('/videos/', '');
        resultList.push({
          videoId,
          name: entry.name,
          language,
          index: index--,
        });
      }
    } else {
      // Multi-language mode: one video per day, multiple language tracks
      // Each video name contains language info
      for (const entry of result.data) {
        const videoId = entry.uri.replace('/videos/', '');
        const language = detectLanguage(entry.name);
        resultList.push({
          videoId,
          name: entry.name,
          language,
        });
      }
    }

    return resultList;
  } catch (error: any) {
    console.error('Error fetching showcase videos:', error);
    if (error.response) {
      throw new Error(`Vimeo API error: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to fetch showcase videos: ${error.message}`);
  }
}

/**
 * Extract video IDs from showcase and return as embeddedVideoList format
 * @param showcaseId - The Vimeo showcase ID
 * @param perLanguage - If true, treats showcase as per-language
 * @returns For per-language: Array of {index, language, videoId}. For multi-language: Object { language: videoId, ... }
 */
export async function extractShowcaseToVideoList(
  showcaseId: string,
  perLanguage: boolean = false
): Promise<Record<string, string> | Array<{ index: number; language: string; videoId: string }>> {
  const videos = await getShowcaseVideos(showcaseId, perLanguage);

  if (perLanguage) {
    // Per-language mode: return array of videos with indices
    // Frontend will place each video at embeddedVideoList[video.index][language] = videoId
    return videos
      .filter(v => v.index !== undefined)
      .map(v => ({
        index: v.index!,
        language: v.language,
        videoId: v.videoId,
      }));
  } else {
    // Multi-language mode: each video is a different language for the same day
    const result: Record<string, string> = {};
    for (const video of videos) {
      result[video.language] = video.videoId;
    }
    return result;
  }
}

/**
 * Enable video playback by setting playbar and privacy settings
 * @param videoId - The Vimeo video ID
 */
export async function enableVideoPlayback(videoId: string): Promise<void> {
  if (!VIMEO_BEARER_TOKEN) {
    throw new Error('VIMEO_BEARER_TOKEN environment variable is not set');
  }

  if (VIMEO_ALLOWED_DOMAINS.length === 0) {
    throw new Error('VIMEO_ALLOWED_DOMAINS environment variable is not set or empty');
  }

  const url = `${VIMEO_API_BASE}/videos/${videoId}`;

  // First, set the playbar and embed settings
  const payload = {
    embed: {
      playbar: true, // Enable playbar (includes shuttle/scrub control)
      volume: true,
      buttons: {
        watchlater: false,
        share: false,
        embed: false,
        hd: false,
        fullscreen: true,
        scaling: true,
        like: false,
      },
      logos: {
        vimeo: false,
      },
      title: {
        name: 'hide',
        owner: 'hide',
        portrait: 'hide',
      },
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${VIMEO_BEARER_TOKEN}`,
  };

  try {
    // Set embed settings
    await axios.patch(url, payload, { headers });

    // Set allowed domains - enable all domains in the list
    for (const domain of VIMEO_ALLOWED_DOMAINS) {
      const domainUrl = `${VIMEO_API_BASE}/videos/${videoId}/privacy/domains/${encodeURIComponent(domain)}`;
      try {
        await axios.put(domainUrl, {}, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${VIMEO_BEARER_TOKEN}`,
          },
        });
      } catch (error: any) {
        // Log but don't fail if one domain fails - continue with others
        console.warn(`Failed to enable domain ${domain} for video ${videoId}:`, error.response?.status, error.response?.statusText);
        // If it's not a 404 or similar, we might want to throw
        if (error.response && error.response.status >= 500) {
          throw error;
        }
      }
    }
  } catch (error: any) {
    console.error('Error enabling video playback:', error);
    if (error.response) {
      throw new Error(`Vimeo API error: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to enable video playback: ${error.message}`);
  }
}

