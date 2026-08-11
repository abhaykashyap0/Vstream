const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const Song    = require('../models/Song');
const Playlist = require('../models/Playlist');
router.get('/debug-spotify', async (req, res) => {
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  res.json({
    hasClientId:     !!clientId,
    hasClientSecret: !!clientSecret,
    clientIdStart:   clientId?.slice(0, 6) || 'MISSING',
    secretStart:     clientSecret?.slice(0, 6) || 'MISSING'
  });
});

// ── Auth middleware ───────────────────────────────────────────────────
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('[Import] Auth header:', authHeader ? authHeader.slice(0, 30) + '...' : 'MISSING');
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Login required — no token found' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (err) {
    console.error('[Import] Auth error:', err.message);
    res.status(401).json({ message: `Invalid token: ${err.message}` });
  }
};

// ── JioSaavn instances ────────────────────────────────────────────────
const JIOSAAVN_BASE = process.env.JIOSAAVN_API_BASE
  || 'https://jiosaavn-api-privatecvc2.vercel.app/api';

// ── Format seconds to mm:ss ───────────────────────────────────────────
const formatSeconds = (s) => {
  const total = parseInt(s) || 0;
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
};

// ── Get Spotify access token (Client Credentials — no user login) ─────
let spotifyToken    = null;
let spotifyTokenExp = 0;


const getSpotifyToken = async () => {
  if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

  console.log('[Spotify] Getting token with clientId:', clientId.slice(0, 8) + '...');

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization:  `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    spotifyToken    = res.data.access_token;
    spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
    console.log('[Spotify] ✅ Token obtained');
    return spotifyToken;
  } catch (err) {
    // Log exact Spotify error
    console.error('[Spotify] Token error status:', err.response?.status);
    console.error('[Spotify] Token error body:', JSON.stringify(err.response?.data));
    throw new Error(`Spotify auth failed: ${JSON.stringify(err.response?.data)}`);
  }
};
async function fetchSpotifyPlaylist(playlistId, token) {
  console.log('[Spotify] Fetching playlist:', playlistId);
  const metaRes = await axios.get(
    `https://api.spotify.com/v1/playlists/${playlistId}`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
  );
  console.log('[Spotify] Playlist name:', metaRes.data.name);
  return metaRes.data;
}

// const getSpotifyToken = async () => {
//   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

//   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
//   const res   = await axios.post(
//     'https://accounts.spotify.com/api/token',
//     'grant_type=client_credentials',
//     { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
//   );

//   spotifyToken    = res.data.access_token;
//   spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
//   return spotifyToken;
// };

// ── Extract playlist ID from various URL formats ──────────────────────
const extractSpotifyId = (url) => {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
};

const extractYouTubePlaylistId = (url) => {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

const extractJioSaavnId = (url) => {
  // Handles both:
  //   https://www.jiosaavn.com/featured/<name>/<token>
  //   https://www.jiosaavn.com/s/playlist/<hash>/<name>/<token>
  // The real token is always the LAST path segment, not a fixed position.
  try {
    const clean = url.split('?')[0].replace(/\/+$/, '');
    const parts = clean.split('/').filter(Boolean);
    const last  = parts[parts.length - 1];
    return last && /^[a-zA-Z0-9_-]+$/.test(last) ? last : null;
  } catch {
    return null;
  }
};

const decodeHtmlEntities = (str) => String(str || '')
  .replace(/&amp;/g, '&')
  .replace(/&#039;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');

// ── Search JioSaavn for a track ───────────────────────────────────────
const searchJioSaavnTrack = async (title, artist) => {
  try {
    const query = `${title} ${artist}`.trim();
    const res   = await axios.get(`${JIOSAAVN_BASE}/search/songs`, {
      params:  { query, limit: 5 },
      timeout: 6000
    });

    const results = res.data?.data?.results || [];
    if (!results.length) return null;

    // Score results
    const q       = title.toLowerCase();
    const a       = artist.toLowerCase();
    const scored  = results.map(item => {
      const t   = (item.name || '').toLowerCase();
      const ar  = item.artists?.primary?.map(x => x.name).join(' ').toLowerCase() || '';
      let score = 0;
      if (t === q)           score += 80;
      else if (t.includes(q)) score += 40;
      if (ar.includes(a))    score += 30;
      if (item.hasLyrics)    score += 10;
      const plays = item.playCount || 0;
      if (plays > 10_000_000) score += 20;
      else if (plays > 1_000_000) score += 10;
      // penalize instrumental
      if ((item.language || '').toLowerCase() === 'instrumental') score -= 60;
      return { item, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score < 30) return null; // too low confidence

    const item         = best.item;
    const downloadUrls = item.downloadUrl || [];
    const streamUrl    = downloadUrls[downloadUrls.length - 1]?.url || downloadUrls[0]?.url;
    if (!streamUrl) return null;

    const images    = item.image || [];
    const imageUrl  = images[images.length - 1]?.url || images[0]?.url || '';
    const artistStr = item.artists?.primary?.map(a => a.name).join(', ') || artist;

    return {
      source:      'jiosaavn',
      jiosaavn_id: item.id,
      title:       item.name,
      artist:      artistStr,
      image_url:   imageUrl,
      duration:    formatSeconds(item.duration),
      stream_url:  streamUrl,
      language:    item.language || '',
      play_count:  item.playCount || 0
    };
  } catch {
    return null;
  }
};

// ── Search YouTube for a track ────────────────────────────────────────
const searchYouTubeTrack = async (title, artist) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;
    const res    = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        key: apiKey, part: 'snippet',
        q: `${title} ${artist} official audio`,
        type: 'video', videoCategoryId: '10', maxResults: 1
      },
      timeout: 6000
    });

    const item = res.data.items?.[0];
    if (!item) return null;

    return {
      source:     'youtube',
      youtube_id: item.id.videoId,
      title:      item.snippet.title,
      artist:     item.snippet.channelTitle,
      image_url:  item.snippet.thumbnails?.medium?.url || '',
      duration:   '0:00'
    };
  } catch {
    return null;
  }
};

// ── Match a track: JioSaavn first, YouTube fallback ───────────────────
const matchTrack = async (title, artist) => {
  const jiosaavn = await searchJioSaavnTrack(title, artist);
  if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn' };

  const youtube = await searchYouTubeTrack(title, artist);
  if (youtube) return { ...youtube, matchSource: 'youtube' };

  return null;
};

// ══════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════

// ── POST /api/import/preview ──────────────────────────────────────────
// Step 1: Fetch playlist from source + match tracks
// Returns preview without creating playlist yet
router.post('/preview', requireAuth, async (req, res) => {
  const { url, source } = req.body; // source: 'spotify' | 'youtube' | 'jiosaavn'

  if (!url || !source) {
    return res.status(400).json({ message: 'URL and source required' });
  }

  try {
    let playlistName = 'Imported Playlist';
    let tracks       = []; // [{ title, artist, image, duration }]

    // ── SPOTIFY ──────────────────────────────────────────────────────
    if (source === 'spotify') {
      const playlistId = extractSpotifyId(url);
      if (!playlistId) return res.status(400).json({ message: 'Invalid Spotify playlist URL' });

      const token = await getSpotifyToken();

      // Fetch playlist metadata
      const metaRes = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
      );
      playlistName = metaRes.data.name;

      // Fetch all tracks (handle pagination)
      let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,duration_ms,album(images)))`;
      while (nextUrl) {
        const tracksRes = await axios.get(nextUrl, {
          headers: { Authorization: `Bearer ${token}` }, timeout: 8000
        });
        const items = tracksRes.data.items || [];
        items.forEach(({ track }) => {
          if (!track || track.is_local) return;
          tracks.push({
            title:    track.name,
            artist:   track.artists?.map(a => a.name).join(', ') || '',
            image:    track.album?.images?.[0]?.url || '',
            duration: formatSeconds(Math.floor((track.duration_ms || 0) / 1000))
          });
        });
        nextUrl = tracksRes.data.next;
        if (tracks.length >= 200) break; // cap at 200 songs
      }
    }

    // ── YOUTUBE ───────────────────────────────────────────────────────
    else if (source === 'youtube') {
      const playlistId = extractYouTubePlaylistId(url);
      if (!playlistId) return res.status(400).json({ message: 'Invalid YouTube playlist URL' });

      const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;

      // Fetch playlist metadata
      const metaRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
        params: { key: apiKey, part: 'snippet', id: playlistId },
        timeout: 8000
      });
      playlistName = metaRes.data.items?.[0]?.snippet?.title || 'YouTube Playlist';

      // Fetch all videos (handle pagination)
      let pageToken = '';
      do {
        const params = { key: apiKey, part: 'snippet', playlistId, maxResults: 50 };
        if (pageToken) params.pageToken = pageToken;
        const videosRes = await axios.get(
          'https://www.googleapis.com/youtube/v3/playlistItems',
          { params, timeout: 8000 }
        );
        (videosRes.data.items || []).forEach(item => {
          const snippet = item.snippet;
          if (!snippet?.resourceId?.videoId) return;
          // Clean YouTube title (remove "- Official Video" etc)
          const rawTitle = snippet.title || '';
          const cleanTitle = rawTitle
            .replace(/\(.*?official.*?\)/gi, '')
            .replace(/\[.*?official.*?\]/gi, '')
            .replace(/- official.*/gi, '')
            .replace(/| official.*/gi, '')
            .replace(/\(.*?audio.*?\)/gi, '')
            .replace(/\(.*?lyric.*?\)/gi, '')
            .trim();
          tracks.push({
            title:      cleanTitle || rawTitle,
            artist:     snippet.videoOwnerChannelTitle?.replace(/ - Topic$/i, '') || '',
            image:      snippet.thumbnails?.medium?.url || '',
            duration:   '0:00',
            youtube_id: snippet.resourceId.videoId
          });
        });
        pageToken = videosRes.data.nextPageToken || '';
        if (tracks.length >= 200) break;
      } while (pageToken);
    }

    // ── JIOSAAVN ──────────────────────────────────────────────────────
    else if (source === 'jiosaavn') {
      const playlistId = extractJioSaavnId(url);
      if (!playlistId) return res.status(400).json({ message: 'Invalid JioSaavn playlist URL.\nTry: https://www.jiosaavn.com/featured/playlist-name/id' });

      let res2;
      try {
        res2 = await axios.get('https://www.jiosaavn.com/api.php', {
          params: {
            __call:          'webapi.get',
            token:           playlistId,
            type:            'playlist',
            p:               1,
            n:               200,
            includeMetaTags: 0,
            api_version:     4,
            _format:         'json',
            _marker:         0,
            ctx:             'web6dot0'
          },
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
      } catch (jiosaavnErr) {
        console.error('[Import] JioSaavn API error:', jiosaavnErr.message);
        return res.status(502).json({ message: 'Could not reach JioSaavn. Please try again shortly.' });
      }

      const data = res2.data;
      if (!data || !Array.isArray(data.list)) {
        return res.status(404).json({ message: 'Playlist not found on JioSaavn. Double check the URL, or make sure the playlist is public.' });
      }

      playlistName = decodeHtmlEntities(data.title) || 'JioSaavn Playlist';

      data.list.forEach(item => {
        if (!item) return; // skip malformed entries instead of crashing

        const primaryArtists = item.more_info?.artistMap?.primary_artists || [];
        const artistNames = primaryArtists.length
          ? primaryArtists.map(a => decodeHtmlEntities(a.name)).join(', ')
          : decodeHtmlEntities((item.subtitle || '').split(' - ')[0]);

        const image = (item.image || '').replace(/50x50|150x150/, '500x500');

        tracks.push({
          title:    decodeHtmlEntities(item.title) || 'Unknown',
          artist:   artistNames,
          image,
          duration: formatSeconds(item.more_info?.duration || 0)
        });
      });
    }

    else {
      return res.status(400).json({ message: 'Invalid source. Use: spotify, youtube, jiosaavn' });
    }

    if (tracks.length === 0) {
      return res.status(404).json({ message: 'No tracks found in this playlist' });
    }

    // ── Match all tracks concurrently (batches of 5) ──────────────────
    console.log(`[Import] Matching ${tracks.length} tracks from ${source}...`);
    const matched   = [];
    const unmatched = [];
    const batchSize = 5;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch   = tracks.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (track) => {
          // For YouTube tracks that already have a videoId — use directly
          if (source === 'youtube' && track.youtube_id) {
            // Still try JioSaavn first for better quality
            const jiosaavn = await searchJioSaavnTrack(track.title, track.artist);
            if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn', originalTitle: track.title };
            return {
              source:        'youtube',
              youtube_id:    track.youtube_id,
              title:         track.title,
              artist:        track.artist,
              image_url:     track.image,
              duration:      track.duration,
              matchSource:   'youtube',
              originalTitle: track.title
            };
          }
          // For JioSaavn source — tracks are already matched
          if (source === 'jiosaavn') {
            return {
              ...track,
              matchSource:   'jiosaavn_direct',
              originalTitle: track.title
            };
          }
          const result = await matchTrack(track.title, track.artist);
          return result
            ? { ...result, originalTitle: track.title, originalArtist: track.artist }
            : null;
        })
      );

      results.forEach((result, idx) => {
        const track = batch[idx];
        if (result) matched.push(result);
        else unmatched.push({ title: track.title, artist: track.artist });
      });

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < tracks.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`[Import] Matched: ${matched.length}/${tracks.length}`);

    res.json({
      playlistName,
      source,
      total:     tracks.length,
      matched:   matched.length,
      unmatched: unmatched.length,
      songs:     matched,
      notFound:  unmatched
    });

  } catch (err) {
    console.error('[Import] Error:', err.message);
    console.error('[Import] Error status:', err.response?.status);
    console.error('[Import] Error body:', JSON.stringify(err.response?.data));
    if (err.response?.status === 404) {
      return res.status(404).json({ message: 'Playlist not found. Make sure it is public.' });
    }
    if (err.response?.status === 401) {
      return res.status(401).json({ message: 'Spotify credentials invalid. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.' });
    }
    if (err.response?.status === 403) {
      const detail = typeof err.response?.data === 'string'
        ? err.response.data
        : (err.response?.data?.error?.message || null);
      return res.status(403).json({
        message: 'Spotify blocked this request (403). Either the playlist is still private/restricted, the app owner account lacks Premium, or it is a Spotify-owned editorial playlist which third-party apps cannot read.',
        spotifyDetail: detail
      });
    }
    res.status(500).json({ message: err.message || 'Import failed' });
  }
});

// ── POST /api/import/create ───────────────────────────────────────────
// Step 2: User confirmed preview → create the actual playlist
router.post('/create', requireAuth, async (req, res) => {
  const { playlistName, songs } = req.body;

  if (!playlistName || !songs?.length) {
    return res.status(400).json({ message: 'Playlist name and songs required' });
  }

  try {
    // Upsert all songs in DB (background)
    const savedSongs = await Promise.all(
      songs.map(async (song) => {
        try {
          const keyField = song.jiosaavn_id ? 'jiosaavn_id' : 'youtube_id';
          const keyValue = song.jiosaavn_id || song.youtube_id;
          if (!keyValue) return null;
          return await Song.findOneAndUpdate(
            { [keyField]: keyValue },
            { $set: song },
            { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
          );
        } catch {
          return null;
        }
      })
    );

    const validSongs = savedSongs.filter(Boolean);

    // Create playlist
    const playlist = new Playlist({
      title:  playlistName,
      owner:  req.user._id,
      songs:  validSongs.map(s => s._id)
    });
    await playlist.save();

    res.json({
      message:    `Playlist "${playlistName}" created with ${validSongs.length} songs ✅`,
      playlistId: playlist._id,
      songCount:  validSongs.length
    });
  } catch (err) {
    console.error('[Import] Create error:', err.message);
    res.status(500).json({ message: 'Failed to create playlist' });
  }
});

module.exports = router;







// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const jwt     = require('jsonwebtoken');
// const User    = require('../models/User');
// const Song    = require('../models/Song');
// const Playlist = require('../models/Playlist');
// router.get('/debug-spotify', async (req, res) => {
//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   res.json({
//     hasClientId:     !!clientId,
//     hasClientSecret: !!clientSecret,
//     clientIdStart:   clientId?.slice(0, 6) || 'MISSING',
//     secretStart:     clientSecret?.slice(0, 6) || 'MISSING'
//   });
// });

// // ── Auth middleware ───────────────────────────────────────────────────
// const requireAuth = async (req, res, next) => {
//   try {
//     const authHeader = req.headers.authorization;
//     console.log('[Import] Auth header:', authHeader ? authHeader.slice(0, 30) + '...' : 'MISSING');
//     const token = authHeader?.split(' ')[1];
//     if (!token) return res.status(401).json({ message: 'Login required — no token found' });
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = await User.findById(decoded.id).select('-password');
//     if (!req.user) return res.status(401).json({ message: 'User not found' });
//     next();
//   } catch (err) {
//     console.error('[Import] Auth error:', err.message);
//     res.status(401).json({ message: `Invalid token: ${err.message}` });
//   }
// };

// // ── JioSaavn instances ────────────────────────────────────────────────
// const JIOSAAVN_BASE = process.env.JIOSAAVN_API_BASE
//   || 'https://jiosaavn-api-privatecvc2.vercel.app/api';

// // ── Format seconds to mm:ss ───────────────────────────────────────────
// const formatSeconds = (s) => {
//   const total = parseInt(s) || 0;
//   return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
// };

// // ── Get Spotify access token (Client Credentials — no user login) ─────
// let spotifyToken    = null;
// let spotifyTokenExp = 0;


// const getSpotifyToken = async () => {
//   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

//   console.log('[Spotify] Getting token with clientId:', clientId.slice(0, 8) + '...');

//   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

//   try {
//     const res = await axios.post(
//       'https://accounts.spotify.com/api/token',
//       'grant_type=client_credentials',
//       {
//         headers: {
//           Authorization:  `Basic ${creds}`,
//           'Content-Type': 'application/x-www-form-urlencoded'
//         }
//       }
//     );
//     spotifyToken    = res.data.access_token;
//     spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
//     console.log('[Spotify] ✅ Token obtained');
//     return spotifyToken;
//   } catch (err) {
//     // Log exact Spotify error
//     console.error('[Spotify] Token error status:', err.response?.status);
//     console.error('[Spotify] Token error body:', JSON.stringify(err.response?.data));
//     throw new Error(`Spotify auth failed: ${JSON.stringify(err.response?.data)}`);
//   }
// };
// async function fetchSpotifyPlaylist(playlistId, token) {
//   console.log('[Spotify] Fetching playlist:', playlistId);
//   const metaRes = await axios.get(
//     `https://api.spotify.com/v1/playlists/${playlistId}`,
//     { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
//   );
//   console.log('[Spotify] Playlist name:', metaRes.data.name);
//   return metaRes.data;
// }

// // const getSpotifyToken = async () => {
// //   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

// //   const clientId     = process.env.SPOTIFY_CLIENT_ID;
// //   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
// //   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

// //   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
// //   const res   = await axios.post(
// //     'https://accounts.spotify.com/api/token',
// //     'grant_type=client_credentials',
// //     { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
// //   );

// //   spotifyToken    = res.data.access_token;
// //   spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
// //   return spotifyToken;
// // };

// // ── Extract playlist ID from various URL formats ──────────────────────
// const extractSpotifyId = (url) => {
//   const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
//   return match ? match[1] : null;
// };

// const extractYouTubePlaylistId = (url) => {
//   const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
//   return match ? match[1] : null;
// };

// const extractJioSaavnId = (url) => {
//   // Handles both:
//   //   https://www.jiosaavn.com/featured/<name>/<token>
//   //   https://www.jiosaavn.com/s/playlist/<hash>/<name>/<token>
//   // The real token is always the LAST path segment, not a fixed position.
//   try {
//     const clean = url.split('?')[0].replace(/\/+$/, '');
//     const parts = clean.split('/').filter(Boolean);
//     const last  = parts[parts.length - 1];
//     return last && /^[a-zA-Z0-9_-]+$/.test(last) ? last : null;
//   } catch {
//     return null;
//   }
// };

// const decodeHtmlEntities = (str) => String(str || '')
//   .replace(/&amp;/g, '&')
//   .replace(/&#039;/g, "'")
//   .replace(/&quot;/g, '"')
//   .replace(/&lt;/g, '<')
//   .replace(/&gt;/g, '>');

// // ── Search JioSaavn for a track ───────────────────────────────────────
// const searchJioSaavnTrack = async (title, artist) => {
//   try {
//     const query = `${title} ${artist}`.trim();
//     const res   = await axios.get(`${JIOSAAVN_BASE}/search/songs`, {
//       params:  { query, limit: 5 },
//       timeout: 6000
//     });

//     const results = res.data?.data?.results || [];
//     if (!results.length) return null;

//     // Score results
//     const q       = title.toLowerCase();
//     const a       = artist.toLowerCase();
//     const scored  = results.map(item => {
//       const t   = (item.name || '').toLowerCase();
//       const ar  = item.artists?.primary?.map(x => x.name).join(' ').toLowerCase() || '';
//       let score = 0;
//       if (t === q)           score += 80;
//       else if (t.includes(q)) score += 40;
//       if (ar.includes(a))    score += 30;
//       if (item.hasLyrics)    score += 10;
//       const plays = item.playCount || 0;
//       if (plays > 10_000_000) score += 20;
//       else if (plays > 1_000_000) score += 10;
//       // penalize instrumental
//       if ((item.language || '').toLowerCase() === 'instrumental') score -= 60;
//       return { item, score };
//     }).sort((a, b) => b.score - a.score);

//     const best = scored[0];
//     if (best.score < 30) return null; // too low confidence

//     const item         = best.item;
//     const downloadUrls = item.downloadUrl || [];
//     const streamUrl    = downloadUrls[downloadUrls.length - 1]?.url || downloadUrls[0]?.url;
//     if (!streamUrl) return null;

//     const images    = item.image || [];
//     const imageUrl  = images[images.length - 1]?.url || images[0]?.url || '';
//     const artistStr = item.artists?.primary?.map(a => a.name).join(', ') || artist;

//     return {
//       source:      'jiosaavn',
//       jiosaavn_id: item.id,
//       title:       item.name,
//       artist:      artistStr,
//       image_url:   imageUrl,
//       duration:    formatSeconds(item.duration),
//       stream_url:  streamUrl,
//       language:    item.language || '',
//       play_count:  item.playCount || 0
//     };
//   } catch {
//     return null;
//   }
// };

// // ── Search YouTube for a track ────────────────────────────────────────
// const searchYouTubeTrack = async (title, artist) => {
//   try {
//     const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;
//     const res    = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//       params: {
//         key: apiKey, part: 'snippet',
//         q: `${title} ${artist} official audio`,
//         type: 'video', videoCategoryId: '10', maxResults: 1
//       },
//       timeout: 6000
//     });

//     const item = res.data.items?.[0];
//     if (!item) return null;

//     return {
//       source:     'youtube',
//       youtube_id: item.id.videoId,
//       title:      item.snippet.title,
//       artist:     item.snippet.channelTitle,
//       image_url:  item.snippet.thumbnails?.medium?.url || '',
//       duration:   '0:00'
//     };
//   } catch {
//     return null;
//   }
// };

// // ── Match a track: JioSaavn first, YouTube fallback ───────────────────
// const matchTrack = async (title, artist) => {
//   const jiosaavn = await searchJioSaavnTrack(title, artist);
//   if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn' };

//   const youtube = await searchYouTubeTrack(title, artist);
//   if (youtube) return { ...youtube, matchSource: 'youtube' };

//   return null;
// };

// // ══════════════════════════════════════════════════════════════════════
// // ROUTES
// // ══════════════════════════════════════════════════════════════════════

// // ── POST /api/import/preview ──────────────────────────────────────────
// // Step 1: Fetch playlist from source + match tracks
// // Returns preview without creating playlist yet
// router.post('/preview', requireAuth, async (req, res) => {
//   const { url, source } = req.body; // source: 'spotify' | 'youtube' | 'jiosaavn'

//   if (!url || !source) {
//     return res.status(400).json({ message: 'URL and source required' });
//   }

//   try {
//     let playlistName = 'Imported Playlist';
//     let tracks       = []; // [{ title, artist, image, duration }]

//     // ── SPOTIFY ──────────────────────────────────────────────────────
//     if (source === 'spotify') {
//       const playlistId = extractSpotifyId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid Spotify playlist URL' });

//       const token = await getSpotifyToken();

//       // Fetch playlist metadata
//       const metaRes = await axios.get(
//         `https://api.spotify.com/v1/playlists/${playlistId}`,
//         { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
//       );
//       playlistName = metaRes.data.name;

//       // Fetch all tracks (handle pagination)
//       let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,duration_ms,album(images)))`;
//       while (nextUrl) {
//         const tracksRes = await axios.get(nextUrl, {
//           headers: { Authorization: `Bearer ${token}` }, timeout: 8000
//         });
//         const items = tracksRes.data.items || [];
//         items.forEach(({ track }) => {
//           if (!track || track.is_local) return;
//           tracks.push({
//             title:    track.name,
//             artist:   track.artists?.map(a => a.name).join(', ') || '',
//             image:    track.album?.images?.[0]?.url || '',
//             duration: formatSeconds(Math.floor((track.duration_ms || 0) / 1000))
//           });
//         });
//         nextUrl = tracksRes.data.next;
//         if (tracks.length >= 200) break; // cap at 200 songs
//       }
//     }

//     // ── YOUTUBE ───────────────────────────────────────────────────────
//     else if (source === 'youtube') {
//       const playlistId = extractYouTubePlaylistId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid YouTube playlist URL' });

//       const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;

//       // Fetch playlist metadata
//       const metaRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
//         params: { key: apiKey, part: 'snippet', id: playlistId },
//         timeout: 8000
//       });
//       playlistName = metaRes.data.items?.[0]?.snippet?.title || 'YouTube Playlist';

//       // Fetch all videos (handle pagination)
//       let pageToken = '';
//       do {
//         const params = { key: apiKey, part: 'snippet', playlistId, maxResults: 50 };
//         if (pageToken) params.pageToken = pageToken;
//         const videosRes = await axios.get(
//           'https://www.googleapis.com/youtube/v3/playlistItems',
//           { params, timeout: 8000 }
//         );
//         (videosRes.data.items || []).forEach(item => {
//           const snippet = item.snippet;
//           if (!snippet?.resourceId?.videoId) return;
//           // Clean YouTube title (remove "- Official Video" etc)
//           const rawTitle = snippet.title || '';
//           const cleanTitle = rawTitle
//             .replace(/\(.*?official.*?\)/gi, '')
//             .replace(/\[.*?official.*?\]/gi, '')
//             .replace(/- official.*/gi, '')
//             .replace(/| official.*/gi, '')
//             .replace(/\(.*?audio.*?\)/gi, '')
//             .replace(/\(.*?lyric.*?\)/gi, '')
//             .trim();
//           tracks.push({
//             title:      cleanTitle || rawTitle,
//             artist:     snippet.videoOwnerChannelTitle?.replace(/ - Topic$/i, '') || '',
//             image:      snippet.thumbnails?.medium?.url || '',
//             duration:   '0:00',
//             youtube_id: snippet.resourceId.videoId
//           });
//         });
//         pageToken = videosRes.data.nextPageToken || '';
//         if (tracks.length >= 200) break;
//       } while (pageToken);
//     }

//     // ── JIOSAAVN ──────────────────────────────────────────────────────
//     else if (source === 'jiosaavn') {
//       const playlistId = extractJioSaavnId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid JioSaavn playlist URL.\nTry: https://www.jiosaavn.com/featured/playlist-name/id' });

//       let res2;
//       try {
//         res2 = await axios.get('https://www.jiosaavn.com/api.php', {
//           params: {
//             __call:          'webapi.get',
//             token:           playlistId,
//             type:            'playlist',
//             p:               1,
//             n:               200,
//             includeMetaTags: 0,
//             api_version:     4,
//             _format:         'json',
//             _marker:         0,
//             ctx:             'web6dot0'
//           },
//           timeout: 8000,
//           headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
//         });
//       } catch (jiosaavnErr) {
//         console.error('[Import] JioSaavn API error:', jiosaavnErr.message);
//         return res.status(502).json({ message: 'Could not reach JioSaavn. Please try again shortly.' });
//       }

//       const data = res2.data;
//       if (!data || !Array.isArray(data.list)) {
//         return res.status(404).json({ message: 'Playlist not found on JioSaavn. Double check the URL, or make sure the playlist is public.' });
//       }

//       playlistName = decodeHtmlEntities(data.title) || 'JioSaavn Playlist';

//       data.list.forEach(item => {
//         if (!item) return; // skip malformed entries instead of crashing

//         const primaryArtists = item.more_info?.artistMap?.primary_artists || [];
//         const artistNames = primaryArtists.length
//           ? primaryArtists.map(a => decodeHtmlEntities(a.name)).join(', ')
//           : decodeHtmlEntities((item.subtitle || '').split(' - ')[0]);

//         const image = (item.image || '').replace(/50x50|150x150/, '500x500');

//         tracks.push({
//           title:    decodeHtmlEntities(item.title) || 'Unknown',
//           artist:   artistNames,
//           image,
//           duration: formatSeconds(item.more_info?.duration || 0)
//         });
//       });
//     }

//     else {
//       return res.status(400).json({ message: 'Invalid source. Use: spotify, youtube, jiosaavn' });
//     }

//     if (tracks.length === 0) {
//       return res.status(404).json({ message: 'No tracks found in this playlist' });
//     }

//     // ── Match all tracks concurrently (batches of 5) ──────────────────
//     console.log(`[Import] Matching ${tracks.length} tracks from ${source}...`);
//     const matched   = [];
//     const unmatched = [];
//     const batchSize = 5;

//     for (let i = 0; i < tracks.length; i += batchSize) {
//       const batch   = tracks.slice(i, i + batchSize);
//       const results = await Promise.all(
//         batch.map(async (track) => {
//           // For YouTube tracks that already have a videoId — use directly
//           if (source === 'youtube' && track.youtube_id) {
//             // Still try JioSaavn first for better quality
//             const jiosaavn = await searchJioSaavnTrack(track.title, track.artist);
//             if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn', originalTitle: track.title };
//             return {
//               source:        'youtube',
//               youtube_id:    track.youtube_id,
//               title:         track.title,
//               artist:        track.artist,
//               image_url:     track.image,
//               duration:      track.duration,
//               matchSource:   'youtube',
//               originalTitle: track.title
//             };
//           }
//           // For JioSaavn source — tracks are already matched
//           if (source === 'jiosaavn') {
//             return {
//               ...track,
//               matchSource:   'jiosaavn_direct',
//               originalTitle: track.title
//             };
//           }
//           const result = await matchTrack(track.title, track.artist);
//           return result
//             ? { ...result, originalTitle: track.title, originalArtist: track.artist }
//             : null;
//         })
//       );

//       results.forEach((result, idx) => {
//         const track = batch[idx];
//         if (result) matched.push(result);
//         else unmatched.push({ title: track.title, artist: track.artist });
//       });

//       // Small delay between batches to avoid rate limiting
//       if (i + batchSize < tracks.length) {
//         await new Promise(r => setTimeout(r, 300));
//       }
//     }

//     console.log(`[Import] Matched: ${matched.length}/${tracks.length}`);

//     res.json({
//       playlistName,
//       source,
//       total:     tracks.length,
//       matched:   matched.length,
//       unmatched: unmatched.length,
//       songs:     matched,
//       notFound:  unmatched
//     });

//   } catch (err) {
//     console.error('[Import] Error:', err.message);
//     console.error('[Import] Error status:', err.response?.status);
//     console.error('[Import] Error body:', JSON.stringify(err.response?.data));
//     if (err.response?.status === 404) {
//       return res.status(404).json({ message: 'Playlist not found. Make sure it is public.' });
//     }
//     if (err.response?.status === 401) {
//       return res.status(401).json({ message: 'Spotify credentials invalid. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.' });
//     }
//     if (err.response?.status === 403) {
//       const detail = typeof err.response?.data === 'string'
//         ? err.response.data
//         : (err.response?.data?.error?.message || null);
//       return res.status(403).json({
//         message: 'Spotify blocked this request (403). Either the playlist is still private/restricted, the app owner account lacks Premium, or it is a Spotify-owned editorial playlist which third-party apps cannot read.',
//         spotifyDetail: detail
//       });
//     }
//     res.status(500).json({ message: err.message || 'Import failed' });
//   }
// });

// // ── POST /api/import/create ───────────────────────────────────────────
// // Step 2: User confirmed preview → create the actual playlist
// router.post('/create', requireAuth, async (req, res) => {
//   const { playlistName, songs } = req.body;

//   if (!playlistName || !songs?.length) {
//     return res.status(400).json({ message: 'Playlist name and songs required' });
//   }

//   try {
//     // Upsert all songs in DB (background)
//     const savedSongs = await Promise.all(
//       songs.map(async (song) => {
//         try {
//           const keyField = song.jiosaavn_id ? 'jiosaavn_id' : 'youtube_id';
//           const keyValue = song.jiosaavn_id || song.youtube_id;
//           if (!keyValue) return null;
//           return await Song.findOneAndUpdate(
//             { [keyField]: keyValue },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           );
//         } catch {
//           return null;
//         }
//       })
//     );

//     const validSongs = savedSongs.filter(Boolean);

//     // Create playlist
//     const playlist = new Playlist({
//       name:    playlistName,
//       user:    req.user._id,
//       songs:   validSongs.map(s => s._id),
//       isPublic: false
//     });
//     await playlist.save();

//     res.json({
//       message:    `Playlist "${playlistName}" created with ${validSongs.length} songs ✅`,
//       playlistId: playlist._id,
//       songCount:  validSongs.length
//     });
//   } catch (err) {
//     console.error('[Import] Create error:', err.message);
//     res.status(500).json({ message: 'Failed to create playlist' });
//   }
// });

// module.exports = router;






// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const jwt     = require('jsonwebtoken');
// const User    = require('../models/User');
// const Song    = require('../models/Song');
// const Playlist = require('../models/Playlist');
// router.get('/debug-spotify', async (req, res) => {
//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   res.json({
//     hasClientId:     !!clientId,
//     hasClientSecret: !!clientSecret,
//     clientIdStart:   clientId?.slice(0, 6) || 'MISSING',
//     secretStart:     clientSecret?.slice(0, 6) || 'MISSING'
//   });
// });

// // ── Auth middleware ───────────────────────────────────────────────────
// const requireAuth = async (req, res, next) => {
//   try {
//     const authHeader = req.headers.authorization;
//     console.log('[Import] Auth header:', authHeader ? authHeader.slice(0, 30) + '...' : 'MISSING');
//     const token = authHeader?.split(' ')[1];
//     if (!token) return res.status(401).json({ message: 'Login required — no token found' });
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = await User.findById(decoded.id).select('-password');
//     if (!req.user) return res.status(401).json({ message: 'User not found' });
//     next();
//   } catch (err) {
//     console.error('[Import] Auth error:', err.message);
//     res.status(401).json({ message: `Invalid token: ${err.message}` });
//   }
// };

// // ── JioSaavn instances ────────────────────────────────────────────────
// const JIOSAAVN_BASE = process.env.JIOSAAVN_API_BASE
//   || 'https://jiosaavn-api-privatecvc2.vercel.app/api';

// // ── Format seconds to mm:ss ───────────────────────────────────────────
// const formatSeconds = (s) => {
//   const total = parseInt(s) || 0;
//   return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
// };

// // ── Get Spotify access token (Client Credentials — no user login) ─────
// let spotifyToken    = null;
// let spotifyTokenExp = 0;


// const getSpotifyToken = async () => {
//   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

//   console.log('[Spotify] Getting token with clientId:', clientId.slice(0, 8) + '...');

//   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

//   try {
//     const res = await axios.post(
//       'https://accounts.spotify.com/api/token',
//       'grant_type=client_credentials',
//       {
//         headers: {
//           Authorization:  `Basic ${creds}`,
//           'Content-Type': 'application/x-www-form-urlencoded'
//         }
//       }
//     );
//     spotifyToken    = res.data.access_token;
//     spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
//     console.log('[Spotify] ✅ Token obtained');
//     return spotifyToken;
//   } catch (err) {
//     // Log exact Spotify error
//     console.error('[Spotify] Token error status:', err.response?.status);
//     console.error('[Spotify] Token error body:', JSON.stringify(err.response?.data));
//     throw new Error(`Spotify auth failed: ${JSON.stringify(err.response?.data)}`);
//   }
// };
// async function fetchSpotifyPlaylist(playlistId, token) {
//   console.log('[Spotify] Fetching playlist:', playlistId);
//   const metaRes = await axios.get(
//     `https://api.spotify.com/v1/playlists/${playlistId}`,
//     { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
//   );
//   console.log('[Spotify] Playlist name:', metaRes.data.name);
//   return metaRes.data;
// }

// // const getSpotifyToken = async () => {
// //   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

// //   const clientId     = process.env.SPOTIFY_CLIENT_ID;
// //   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
// //   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

// //   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
// //   const res   = await axios.post(
// //     'https://accounts.spotify.com/api/token',
// //     'grant_type=client_credentials',
// //     { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
// //   );

// //   spotifyToken    = res.data.access_token;
// //   spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
// //   return spotifyToken;
// // };

// // ── Extract playlist ID from various URL formats ──────────────────────
// const extractSpotifyId = (url) => {
//   const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
//   return match ? match[1] : null;
// };

// const extractYouTubePlaylistId = (url) => {
//   const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
//   return match ? match[1] : null;
// };

// // const extractJioSaavnId = (url) => {
// //   // https://www.jiosaavn.com/featured/xxx/yyy or /s/playlist/xxx
// //   const match = url.match(/(?:featured|playlist)\/[^/]+\/([a-zA-Z0-9_-]+)/);
// //   return match ? match[1] : null;
// // };
// const extractJioSaavnId = (url) => {
//   // Format 1: jiosaavn.com/featured/name/ID
//   const match1 = url.match(/(?:featured|playlist)\/[^/]+\/([a-zA-Z0-9_-]+)/);
//   if (match1) return match1[1];

//   // Format 2: saavn.com/s/playlist/hash/name/ID
//   const match2 = url.match(/\/playlist\/[^/]+\/[^/]+\/([a-zA-Z0-9_+=/-]+)/);
//   if (match2) return match2[1];

//   // Format 3: last segment
//   const parts = url.split('/').filter(Boolean);
//   return parts[parts.length - 1] || null;
// };

// // ── Search JioSaavn for a track ───────────────────────────────────────
// const searchJioSaavnTrack = async (title, artist) => {
//   try {
//     const query = `${title} ${artist}`.trim();
//     const res   = await axios.get(`${JIOSAAVN_BASE}/search/songs`, {
//       params:  { query, limit: 5 },
//       timeout: 6000
//     });

//     const results = res.data?.data?.results || [];
//     if (!results.length) return null;

//     // Score results
//     const q       = title.toLowerCase();
//     const a       = artist.toLowerCase();
//     const scored  = results.map(item => {
//       const t   = (item.name || '').toLowerCase();
//       const ar  = item.artists?.primary?.map(x => x.name).join(' ').toLowerCase() || '';
//       let score = 0;
//       if (t === q)           score += 80;
//       else if (t.includes(q)) score += 40;
//       if (ar.includes(a))    score += 30;
//       if (item.hasLyrics)    score += 10;
//       const plays = item.playCount || 0;
//       if (plays > 10_000_000) score += 20;
//       else if (plays > 1_000_000) score += 10;
//       // penalize instrumental
//       if ((item.language || '').toLowerCase() === 'instrumental') score -= 60;
//       return { item, score };
//     }).sort((a, b) => b.score - a.score);

//     const best = scored[0];
//     if (best.score < 30) return null; // too low confidence

//     const item         = best.item;
//     const downloadUrls = item.downloadUrl || [];
//     const streamUrl    = downloadUrls[downloadUrls.length - 1]?.url || downloadUrls[0]?.url;
//     if (!streamUrl) return null;

//     const images    = item.image || [];
//     const imageUrl  = images[images.length - 1]?.url || images[0]?.url || '';
//     const artistStr = item.artists?.primary?.map(a => a.name).join(', ') || artist;

//     return {
//       source:      'jiosaavn',
//       jiosaavn_id: item.id,
//       title:       item.name,
//       artist:      artistStr,
//       image_url:   imageUrl,
//       duration:    formatSeconds(item.duration),
//       stream_url:  streamUrl,
//       language:    item.language || '',
//       play_count:  item.playCount || 0
//     };
//   } catch {
//     return null;
//   }
// };

// // ── Search YouTube for a track ────────────────────────────────────────
// const searchYouTubeTrack = async (title, artist) => {
//   try {
//     const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;
//     const res    = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//       params: {
//         key: apiKey, part: 'snippet',
//         q: `${title} ${artist} official audio`,
//         type: 'video', videoCategoryId: '10', maxResults: 1
//       },
//       timeout: 6000
//     });

//     const item = res.data.items?.[0];
//     if (!item) return null;

//     return {
//       source:     'youtube',
//       youtube_id: item.id.videoId,
//       title:      item.snippet.title,
//       artist:     item.snippet.channelTitle,
//       image_url:  item.snippet.thumbnails?.medium?.url || '',
//       duration:   '0:00'
//     };
//   } catch {
//     return null;
//   }
// };

// // ── Match a track: JioSaavn first, YouTube fallback ───────────────────
// const matchTrack = async (title, artist) => {
//   const jiosaavn = await searchJioSaavnTrack(title, artist);
//   if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn' };

//   const youtube = await searchYouTubeTrack(title, artist);
//   if (youtube) return { ...youtube, matchSource: 'youtube' };

//   return null;
// };

// // ══════════════════════════════════════════════════════════════════════
// // ROUTES
// // ══════════════════════════════════════════════════════════════════════

// // ── POST /api/import/preview ──────────────────────────────────────────
// // Step 1: Fetch playlist from source + match tracks
// // Returns preview without creating playlist yet
// router.post('/preview', requireAuth, async (req, res) => {
//   const { url, source } = req.body; // source: 'spotify' | 'youtube' | 'jiosaavn'

//   if (!url || !source) {
//     return res.status(400).json({ message: 'URL and source required' });
//   }

//   try {
//     let playlistName = 'Imported Playlist';
//     let tracks       = []; // [{ title, artist, image, duration }]

//     // ── SPOTIFY ──────────────────────────────────────────────────────
//     if (source === 'spotify') {
//       const playlistId = extractSpotifyId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid Spotify playlist URL' });

//       const token = await getSpotifyToken();

//       // Fetch playlist metadata
//       const metaRes = await axios.get(
//         `https://api.spotify.com/v1/playlists/${playlistId}`,
//         { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
//       );
//       playlistName = metaRes.data.name;

//       // Fetch all tracks (handle pagination)
//       let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,duration_ms,album(images)))`;
//       while (nextUrl) {
//         const tracksRes = await axios.get(nextUrl, {
//           headers: { Authorization: `Bearer ${token}` }, timeout: 8000
//         });
//         const items = tracksRes.data.items || [];
//         items.forEach(({ track }) => {
//           if (!track || track.is_local) return;
//           tracks.push({
//             title:    track.name,
//             artist:   track.artists?.map(a => a.name).join(', ') || '',
//             image:    track.album?.images?.[0]?.url || '',
//             duration: formatSeconds(Math.floor((track.duration_ms || 0) / 1000))
//           });
//         });
//         nextUrl = tracksRes.data.next;
//         if (tracks.length >= 200) break; // cap at 200 songs
//       }
//     }

//     // ── YOUTUBE ───────────────────────────────────────────────────────
//     else if (source === 'youtube') {
//       const playlistId = extractYouTubePlaylistId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid YouTube playlist URL' });

//       const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;

//       // Fetch playlist metadata
//       const metaRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
//         params: { key: apiKey, part: 'snippet', id: playlistId },
//         timeout: 8000
//       });
//       playlistName = metaRes.data.items?.[0]?.snippet?.title || 'YouTube Playlist';

//       // Fetch all videos (handle pagination)
//       let pageToken = '';
//       do {
//         const params = { key: apiKey, part: 'snippet', playlistId, maxResults: 50 };
//         if (pageToken) params.pageToken = pageToken;
//         const videosRes = await axios.get(
//           'https://www.googleapis.com/youtube/v3/playlistItems',
//           { params, timeout: 8000 }
//         );
//         (videosRes.data.items || []).forEach(item => {
//           const snippet = item.snippet;
//           if (!snippet?.resourceId?.videoId) return;
//           // Clean YouTube title (remove "- Official Video" etc)
//           const rawTitle = snippet.title || '';
//           const cleanTitle = rawTitle
//             .replace(/\(.*?official.*?\)/gi, '')
//             .replace(/\[.*?official.*?\]/gi, '')
//             .replace(/- official.*/gi, '')
//             .replace(/| official.*/gi, '')
//             .replace(/\(.*?audio.*?\)/gi, '')
//             .replace(/\(.*?lyric.*?\)/gi, '')
//             .trim();
//           tracks.push({
//             title:      cleanTitle || rawTitle,
//             artist:     snippet.videoOwnerChannelTitle?.replace(/ - Topic$/i, '') || '',
//             image:      snippet.thumbnails?.medium?.url || '',
//             duration:   '0:00',
//             youtube_id: snippet.resourceId.videoId
//           });
//         });
//         pageToken = videosRes.data.nextPageToken || '';
//         if (tracks.length >= 200) break;
//       } while (pageToken);
//     }

//     // ── JIOSAAVN ──────────────────────────────────────────────────────
//     else if (source === 'jiosaavn') {
//       const playlistId = extractJioSaavnId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid JioSaavn playlist URL.\nTry: https://www.jiosaavn.com/featured/playlist-name/id' });

//       const res2 = await axios.get(`${JIOSAAVN_BASE}/playlists`, {
//         params: { id: playlistId }, timeout: 8000
//       });

//       const data = res2.data?.data;
//       if (!data) return res.status(404).json({ message: 'Playlist not found on JioSaavn' });

//       playlistName = data.name || 'JioSaavn Playlist';
//       const songs  = data.songs || [];
//       songs.forEach(item => {
//   if (!item) return;
//   const images  = item.image || [];
//   // Handle both formats: artists as array or as object
//   let artistStr = '';
//   if (Array.isArray(item.artists)) {
//     artistStr = item.artists.map(a => a.name || a).join(', ');
//   } else if (item.artists?.primary) {
//     artistStr = item.artists.primary.map(a => a.name).join(', ');
//   } else if (item.artists?.all) {
//     artistStr = item.artists.all.map(a => a.name).join(', ');
//   } else if (typeof item.artists === 'string') {
//     artistStr = item.artists;
//   } else {
//     artistStr = item.subtitle || item.artist || 'Unknown Artist';
//   }

//   tracks.push({
//     title:    item.name || item.title || 'Unknown',
//     artist:   artistStr,
//     image:    images[images.length - 1]?.url || images[0]?.url || item.image || '',
//     duration: formatSeconds(item.duration)
//   });
// });
//       // songs.forEach(item => {
//       //   const images    = item.image || [];
//       //   const artists   = item.artists?.primary?.map(a => a.name).join(', ')
//       //     || item.artists?.all?.map(a => a.name).join(', ') || '';
//       //   tracks.push({
//       //     title:    item.name,
//       //     artist:   artists,
//       //     image:    images[images.length - 1]?.url || images[0]?.url || '',
//       //     duration: formatSeconds(item.duration)
//       //   });
//       // });
//     }

//     else {
//       return res.status(400).json({ message: 'Invalid source. Use: spotify, youtube, jiosaavn' });
//     }

//     if (tracks.length === 0) {
//       return res.status(404).json({ message: 'No tracks found in this playlist' });
//     }

//     // ── Match all tracks concurrently (batches of 5) ──────────────────
//     console.log(`[Import] Matching ${tracks.length} tracks from ${source}...`);
//     const matched   = [];
//     const unmatched = [];
//     const batchSize = 5;

//     for (let i = 0; i < tracks.length; i += batchSize) {
//       const batch   = tracks.slice(i, i + batchSize);
//       const results = await Promise.all(
//         batch.map(async (track) => {
//           // For YouTube tracks that already have a videoId — use directly
//           if (source === 'youtube' && track.youtube_id) {
//             // Still try JioSaavn first for better quality
//             const jiosaavn = await searchJioSaavnTrack(track.title, track.artist);
//             if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn', originalTitle: track.title };
//             return {
//               source:        'youtube',
//               youtube_id:    track.youtube_id,
//               title:         track.title,
//               artist:        track.artist,
//               image_url:     track.image,
//               duration:      track.duration,
//               matchSource:   'youtube',
//               originalTitle: track.title
//             };
//           }
//           // For JioSaavn source — tracks are already matched
//           if (source === 'jiosaavn') {
//             return {
//               ...track,
//               matchSource:   'jiosaavn_direct',
//               originalTitle: track.title
//             };
//           }
//           const result = await matchTrack(track.title, track.artist);
//           return result
//             ? { ...result, originalTitle: track.title, originalArtist: track.artist }
//             : null;
//         })
//       );

//       results.forEach((result, idx) => {
//         const track = batch[idx];
//         if (result) matched.push(result);
//         else unmatched.push({ title: track.title, artist: track.artist });
//       });

//       // Small delay between batches to avoid rate limiting
//       if (i + batchSize < tracks.length) {
//         await new Promise(r => setTimeout(r, 300));
//       }
//     }

//     console.log(`[Import] Matched: ${matched.length}/${tracks.length}`);

//     res.json({
//       playlistName,
//       source,
//       total:     tracks.length,
//       matched:   matched.length,
//       unmatched: unmatched.length,
//       songs:     matched,
//       notFound:  unmatched
//     });

//   } catch (err) {
//     console.error('[Import] Error:', err.message);
//     console.error('[Import] Error status:', err.response?.status);
//     console.error('[Import] Error body:', JSON.stringify(err.response?.data));
//     if (err.response?.status === 404) {
//       return res.status(404).json({ message: 'Playlist not found. Make sure it is public.' });
//     }
//     if (err.response?.status === 401) {
//       return res.status(401).json({ message: 'Spotify credentials invalid. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.' });
//     }
//     if (err.response?.status === 403) {
//       return res.status(403).json({
//         message: 'Spotify blocked this request (403). Either the playlist is still private/restricted, or it is a Spotify-owned editorial playlist (e.g. Discover Weekly, Today\'s Top Hits) which third-party apps cannot read. Try a user-created public playlist instead.',
//         spotifyDetail: err.response?.data?.error?.message || null
//       });
//     }
//     res.status(500).json({ message: err.message || 'Import failed' });
//   }
// });

// // ── POST /api/import/create ───────────────────────────────────────────
// // Step 2: User confirmed preview → create the actual playlist
// router.post('/create', requireAuth, async (req, res) => {
//   const { playlistName, songs } = req.body;

//   if (!playlistName || !songs?.length) {
//     return res.status(400).json({ message: 'Playlist name and songs required' });
//   }

//   try {
//     // Upsert all songs in DB (background)
//     const savedSongs = await Promise.all(
//       songs.map(async (song) => {
//         try {
//           const keyField = song.jiosaavn_id ? 'jiosaavn_id' : 'youtube_id';
//           const keyValue = song.jiosaavn_id || song.youtube_id;
//           if (!keyValue) return null;
//           return await Song.findOneAndUpdate(
//             { [keyField]: keyValue },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           );
//         } catch {
//           return null;
//         }
//       })
//     );

//     const validSongs = savedSongs.filter(Boolean);

//     // Create playlist
//     const playlist = new Playlist({
//       name:    playlistName,
//       user:    req.user._id,
//       songs:   validSongs.map(s => s._id),
//       isPublic: false
//     });
//     await playlist.save();

//     res.json({
//       message:    `Playlist "${playlistName}" created with ${validSongs.length} songs ✅`,
//       playlistId: playlist._id,
//       songCount:  validSongs.length
//     });
//   } catch (err) {
//     console.error('[Import] Create error:', err.message);
//     res.status(500).json({ message: 'Failed to create playlist' });
//   }
// });

// module.exports = router;




// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const jwt     = require('jsonwebtoken');
// const User    = require('../models/User');
// const Song    = require('../models/Song');
// const Playlist = require('../models/Playlist');
// router.get('/debug-spotify', async (req, res) => {
//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   res.json({
//     hasClientId:     !!clientId,
//     hasClientSecret: !!clientSecret,
//     clientIdStart:   clientId?.slice(0, 6) || 'MISSING',
//     secretStart:     clientSecret?.slice(0, 6) || 'MISSING'
//   });
// });

// // ── Auth middleware ───────────────────────────────────────────────────
// const requireAuth = async (req, res, next) => {
//   try {
//     const authHeader = req.headers.authorization;
//     console.log('[Import] Auth header:', authHeader ? authHeader.slice(0, 30) + '...' : 'MISSING');
//     const token = authHeader?.split(' ')[1];
//     if (!token) return res.status(401).json({ message: 'Login required — no token found' });
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = await User.findById(decoded.id).select('-password');
//     if (!req.user) return res.status(401).json({ message: 'User not found' });
//     next();
//   } catch (err) {
//     console.error('[Import] Auth error:', err.message);
//     res.status(401).json({ message: `Invalid token: ${err.message}` });
//   }
// };

// // ── JioSaavn instances ────────────────────────────────────────────────
// const JIOSAAVN_BASE = process.env.JIOSAAVN_API_BASE
//   || 'https://jiosaavn-api-privatecvc2.vercel.app/api';

// // ── Format seconds to mm:ss ───────────────────────────────────────────
// const formatSeconds = (s) => {
//   const total = parseInt(s) || 0;
//   return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
// };

// // ── Get Spotify access token (Client Credentials — no user login) ─────
// let spotifyToken    = null;
// let spotifyTokenExp = 0;


// const getSpotifyToken = async () => {
//   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

//   const clientId     = process.env.SPOTIFY_CLIENT_ID;
//   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
//   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

//   console.log('[Spotify] Getting token with clientId:', clientId.slice(0, 8) + '...');

//   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

//   try {
//     const res = await axios.post(
//       'https://accounts.spotify.com/api/token',
//       'grant_type=client_credentials',
//       {
//         headers: {
//           Authorization:  `Basic ${creds}`,
//           'Content-Type': 'application/x-www-form-urlencoded'
//         }
//       }
//     );
//     spotifyToken    = res.data.access_token;
//     spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
//     console.log('[Spotify] ✅ Token obtained');
//     return spotifyToken;
//   } catch (err) {
//     // Log exact Spotify error
//     console.error('[Spotify] Token error status:', err.response?.status);
//     console.error('[Spotify] Token error body:', JSON.stringify(err.response?.data));
//     throw new Error(`Spotify auth failed: ${JSON.stringify(err.response?.data)}`);
//   }
// };
// async function fetchSpotifyPlaylist(playlistId, token) {
//   console.log('[Spotify] Fetching playlist:', playlistId);
//   const metaRes = await axios.get(
//     `https://api.spotify.com/v1/playlists/${playlistId}`,
//     { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
//   );
//   console.log('[Spotify] Playlist name:', metaRes.data.name);
//   return metaRes.data;
// }

// // const getSpotifyToken = async () => {
// //   if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;

// //   const clientId     = process.env.SPOTIFY_CLIENT_ID;
// //   const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
// //   if (!clientId || !clientSecret) throw new Error('Spotify credentials not configured');

// //   const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
// //   const res   = await axios.post(
// //     'https://accounts.spotify.com/api/token',
// //     'grant_type=client_credentials',
// //     { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
// //   );

// //   spotifyToken    = res.data.access_token;
// //   spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
// //   return spotifyToken;
// // };

// // ── Extract playlist ID from various URL formats ──────────────────────
// const extractSpotifyId = (url) => {
//   const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
//   return match ? match[1] : null;
// };

// const extractYouTubePlaylistId = (url) => {
//   const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
//   return match ? match[1] : null;
// };

// const extractJioSaavnId = (url) => {
//   // https://www.jiosaavn.com/featured/xxx/yyy or /s/playlist/xxx
//   const match = url.match(/(?:featured|playlist)\/[^/]+\/([a-zA-Z0-9_-]+)/);
//   return match ? match[1] : null;
// };

// // ── Search JioSaavn for a track ───────────────────────────────────────
// const searchJioSaavnTrack = async (title, artist) => {
//   try {
//     const query = `${title} ${artist}`.trim();
//     const res   = await axios.get(`${JIOSAAVN_BASE}/search/songs`, {
//       params:  { query, limit: 5 },
//       timeout: 6000
//     });

//     const results = res.data?.data?.results || [];
//     if (!results.length) return null;

//     // Score results
//     const q       = title.toLowerCase();
//     const a       = artist.toLowerCase();
//     const scored  = results.map(item => {
//       const t   = (item.name || '').toLowerCase();
//       const ar  = item.artists?.primary?.map(x => x.name).join(' ').toLowerCase() || '';
//       let score = 0;
//       if (t === q)           score += 80;
//       else if (t.includes(q)) score += 40;
//       if (ar.includes(a))    score += 30;
//       if (item.hasLyrics)    score += 10;
//       const plays = item.playCount || 0;
//       if (plays > 10_000_000) score += 20;
//       else if (plays > 1_000_000) score += 10;
//       // penalize instrumental
//       if ((item.language || '').toLowerCase() === 'instrumental') score -= 60;
//       return { item, score };
//     }).sort((a, b) => b.score - a.score);

//     const best = scored[0];
//     if (best.score < 30) return null; // too low confidence

//     const item         = best.item;
//     const downloadUrls = item.downloadUrl || [];
//     const streamUrl    = downloadUrls[downloadUrls.length - 1]?.url || downloadUrls[0]?.url;
//     if (!streamUrl) return null;

//     const images    = item.image || [];
//     const imageUrl  = images[images.length - 1]?.url || images[0]?.url || '';
//     const artistStr = item.artists?.primary?.map(a => a.name).join(', ') || artist;

//     return {
//       source:      'jiosaavn',
//       jiosaavn_id: item.id,
//       title:       item.name,
//       artist:      artistStr,
//       image_url:   imageUrl,
//       duration:    formatSeconds(item.duration),
//       stream_url:  streamUrl,
//       language:    item.language || '',
//       play_count:  item.playCount || 0
//     };
//   } catch {
//     return null;
//   }
// };

// // ── Search YouTube for a track ────────────────────────────────────────
// const searchYouTubeTrack = async (title, artist) => {
//   try {
//     const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;
//     const res    = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//       params: {
//         key: apiKey, part: 'snippet',
//         q: `${title} ${artist} official audio`,
//         type: 'video', videoCategoryId: '10', maxResults: 1
//       },
//       timeout: 6000
//     });

//     const item = res.data.items?.[0];
//     if (!item) return null;

//     return {
//       source:     'youtube',
//       youtube_id: item.id.videoId,
//       title:      item.snippet.title,
//       artist:     item.snippet.channelTitle,
//       image_url:  item.snippet.thumbnails?.medium?.url || '',
//       duration:   '0:00'
//     };
//   } catch {
//     return null;
//   }
// };

// // ── Match a track: JioSaavn first, YouTube fallback ───────────────────
// const matchTrack = async (title, artist) => {
//   const jiosaavn = await searchJioSaavnTrack(title, artist);
//   if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn' };

//   const youtube = await searchYouTubeTrack(title, artist);
//   if (youtube) return { ...youtube, matchSource: 'youtube' };

//   return null;
// };

// // ══════════════════════════════════════════════════════════════════════
// // ROUTES
// // ══════════════════════════════════════════════════════════════════════

// // ── POST /api/import/preview ──────────────────────────────────────────
// // Step 1: Fetch playlist from source + match tracks
// // Returns preview without creating playlist yet
// router.post('/preview', requireAuth, async (req, res) => {
//   const { url, source } = req.body; // source: 'spotify' | 'youtube' | 'jiosaavn'

//   if (!url || !source) {
//     return res.status(400).json({ message: 'URL and source required' });
//   }

//   try {
//     let playlistName = 'Imported Playlist';
//     let tracks       = []; // [{ title, artist, image, duration }]

//     // ── SPOTIFY ──────────────────────────────────────────────────────
//     if (source === 'spotify') {
//       const playlistId = extractSpotifyId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid Spotify playlist URL' });

//       const token = await getSpotifyToken();

//       // Fetch playlist metadata
//       const metaRes = await axios.get(
//         `https://api.spotify.com/v1/playlists/${playlistId}`,
//         { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
//       );
//       playlistName = metaRes.data.name;

//       // Fetch all tracks (handle pagination)
//       let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,items(track(name,artists,duration_ms,album(images)))`;
//       while (nextUrl) {
//         const tracksRes = await axios.get(nextUrl, {
//           headers: { Authorization: `Bearer ${token}` }, timeout: 8000
//         });
//         const items = tracksRes.data.items || [];
//         items.forEach(({ track }) => {
//           if (!track || track.is_local) return;
//           tracks.push({
//             title:    track.name,
//             artist:   track.artists?.map(a => a.name).join(', ') || '',
//             image:    track.album?.images?.[0]?.url || '',
//             duration: formatSeconds(Math.floor((track.duration_ms || 0) / 1000))
//           });
//         });
//         nextUrl = tracksRes.data.next;
//         if (tracks.length >= 200) break; // cap at 200 songs
//       }
//     }

//     // ── YOUTUBE ───────────────────────────────────────────────────────
//     else if (source === 'youtube') {
//       const playlistId = extractYouTubePlaylistId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid YouTube playlist URL' });

//       const apiKey = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;

//       // Fetch playlist metadata
//       const metaRes = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
//         params: { key: apiKey, part: 'snippet', id: playlistId },
//         timeout: 8000
//       });
//       playlistName = metaRes.data.items?.[0]?.snippet?.title || 'YouTube Playlist';

//       // Fetch all videos (handle pagination)
//       let pageToken = '';
//       do {
//         const params = { key: apiKey, part: 'snippet', playlistId, maxResults: 50 };
//         if (pageToken) params.pageToken = pageToken;
//         const videosRes = await axios.get(
//           'https://www.googleapis.com/youtube/v3/playlistItems',
//           { params, timeout: 8000 }
//         );
//         (videosRes.data.items || []).forEach(item => {
//           const snippet = item.snippet;
//           if (!snippet?.resourceId?.videoId) return;
//           // Clean YouTube title (remove "- Official Video" etc)
//           const rawTitle = snippet.title || '';
//           const cleanTitle = rawTitle
//             .replace(/\(.*?official.*?\)/gi, '')
//             .replace(/\[.*?official.*?\]/gi, '')
//             .replace(/- official.*/gi, '')
//             .replace(/| official.*/gi, '')
//             .replace(/\(.*?audio.*?\)/gi, '')
//             .replace(/\(.*?lyric.*?\)/gi, '')
//             .trim();
//           tracks.push({
//             title:      cleanTitle || rawTitle,
//             artist:     snippet.videoOwnerChannelTitle?.replace(/ - Topic$/i, '') || '',
//             image:      snippet.thumbnails?.medium?.url || '',
//             duration:   '0:00',
//             youtube_id: snippet.resourceId.videoId
//           });
//         });
//         pageToken = videosRes.data.nextPageToken || '';
//         if (tracks.length >= 200) break;
//       } while (pageToken);
//     }

//     // ── JIOSAAVN ──────────────────────────────────────────────────────
//     else if (source === 'jiosaavn') {
//       const playlistId = extractJioSaavnId(url);
//       if (!playlistId) return res.status(400).json({ message: 'Invalid JioSaavn playlist URL.\nTry: https://www.jiosaavn.com/featured/playlist-name/id' });

//       const res2 = await axios.get(`${JIOSAAVN_BASE}/playlists`, {
//         params: { id: playlistId }, timeout: 8000
//       });

//       const data = res2.data?.data;
//       if (!data) return res.status(404).json({ message: 'Playlist not found on JioSaavn' });

//       playlistName = data.name || 'JioSaavn Playlist';
//       const songs  = data.songs || [];
//       songs.forEach(item => {
//         const images    = item.image || [];
//         const artists   = item.artists?.primary?.map(a => a.name).join(', ')
//           || item.artists?.all?.map(a => a.name).join(', ') || '';
//         tracks.push({
//           title:    item.name,
//           artist:   artists,
//           image:    images[images.length - 1]?.url || images[0]?.url || '',
//           duration: formatSeconds(item.duration)
//         });
//       });
//     }

//     else {
//       return res.status(400).json({ message: 'Invalid source. Use: spotify, youtube, jiosaavn' });
//     }

//     if (tracks.length === 0) {
//       return res.status(404).json({ message: 'No tracks found in this playlist' });
//     }

//     // ── Match all tracks concurrently (batches of 5) ──────────────────
//     console.log(`[Import] Matching ${tracks.length} tracks from ${source}...`);
//     const matched   = [];
//     const unmatched = [];
//     const batchSize = 5;

//     for (let i = 0; i < tracks.length; i += batchSize) {
//       const batch   = tracks.slice(i, i + batchSize);
//       const results = await Promise.all(
//         batch.map(async (track) => {
//           // For YouTube tracks that already have a videoId — use directly
//           if (source === 'youtube' && track.youtube_id) {
//             // Still try JioSaavn first for better quality
//             const jiosaavn = await searchJioSaavnTrack(track.title, track.artist);
//             if (jiosaavn) return { ...jiosaavn, matchSource: 'jiosaavn', originalTitle: track.title };
//             return {
//               source:        'youtube',
//               youtube_id:    track.youtube_id,
//               title:         track.title,
//               artist:        track.artist,
//               image_url:     track.image,
//               duration:      track.duration,
//               matchSource:   'youtube',
//               originalTitle: track.title
//             };
//           }
//           // For JioSaavn source — tracks are already matched
//           if (source === 'jiosaavn') {
//             return {
//               ...track,
//               matchSource:   'jiosaavn_direct',
//               originalTitle: track.title
//             };
//           }
//           const result = await matchTrack(track.title, track.artist);
//           return result
//             ? { ...result, originalTitle: track.title, originalArtist: track.artist }
//             : null;
//         })
//       );

//       results.forEach((result, idx) => {
//         const track = batch[idx];
//         if (result) matched.push(result);
//         else unmatched.push({ title: track.title, artist: track.artist });
//       });

//       // Small delay between batches to avoid rate limiting
//       if (i + batchSize < tracks.length) {
//         await new Promise(r => setTimeout(r, 300));
//       }
//     }

//     console.log(`[Import] Matched: ${matched.length}/${tracks.length}`);

//     res.json({
//       playlistName,
//       source,
//       total:     tracks.length,
//       matched:   matched.length,
//       unmatched: unmatched.length,
//       songs:     matched,
//       notFound:  unmatched
//     });

//   } catch (err) {
//     console.error('[Import] Error:', err.message);
//     if (err.response?.status === 404) {
//       return res.status(404).json({ message: 'Playlist not found. Make sure it is public.' });
//     }
//     if (err.response?.status === 401) {
//       return res.status(401).json({ message: 'Spotify credentials invalid. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.' });
//     }
//     res.status(500).json({ message: err.message || 'Import failed' });
//   }
// });

// // ── POST /api/import/create ───────────────────────────────────────────
// // Step 2: User confirmed preview → create the actual playlist
// router.post('/create', requireAuth, async (req, res) => {
//   const { playlistName, songs } = req.body;

//   if (!playlistName || !songs?.length) {
//     return res.status(400).json({ message: 'Playlist name and songs required' });
//   }

//   try {
//     // Upsert all songs in DB (background)
//     const savedSongs = await Promise.all(
//       songs.map(async (song) => {
//         try {
//           const keyField = song.jiosaavn_id ? 'jiosaavn_id' : 'youtube_id';
//           const keyValue = song.jiosaavn_id || song.youtube_id;
//           if (!keyValue) return null;
//           return await Song.findOneAndUpdate(
//             { [keyField]: keyValue },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           );
//         } catch {
//           return null;
//         }
//       })
//     );

//     const validSongs = savedSongs.filter(Boolean);

//     // Create playlist
//     const playlist = new Playlist({
//       name:    playlistName,
//       user:    req.user._id,
//       songs:   validSongs.map(s => s._id),
//       isPublic: false
//     });
//     await playlist.save();

//     res.json({
//       message:    `Playlist "${playlistName}" created with ${validSongs.length} songs ✅`,
//       playlistId: playlist._id,
//       songCount:  validSongs.length
//     });
//   } catch (err) {
//     console.error('[Import] Create error:', err.message);
//     res.status(500).json({ message: 'Failed to create playlist' });
//   }
// });

// module.exports = router;