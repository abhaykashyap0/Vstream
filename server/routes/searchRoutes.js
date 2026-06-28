const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const Song    = require('../models/Song');
const User    = require('../models/User');
const jwt     = require('jsonwebtoken');

// ── Optional auth ──────────────────────────────────────────────────
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    }
  } catch {}
  next();
};

// ── Duration parser (YouTube ISO8601) ────────────────────────────────
const parseISO8601Duration = (iso) => {
  if (!iso) return '0:00';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
};

// ── Format JioSaavn seconds duration as M:SS ─────────────────────────
const formatSeconds = (secs) => {
  const total = parseInt(secs) || 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ── YouTube API key rotation ──────────────────────────────────────────
const getApiKey = () => {
  const keys = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
  ].filter(Boolean);
  if (keys.length === 0) return process.env.YOUTUBE_API_KEY;
  return keys[Math.floor(Math.random() * keys.length)];
};

// ── JioSaavn API base — uses public hosted instance by default ───────
// Set JIOSAAVN_API_BASE in .env if you deploy your own instance later
const JIOSAAVN_API_BASE = process.env.JIOSAAVN_API_BASE || 'https://saavn.dev/api';

// ── Search JioSaavn — returns normalized song objects or [] on failure ──
const searchJioSaavn = async (query) => {
  try {
    console.log(`[JioSaavn] Searching for: "${query}" via ${JIOSAAVN_API_BASE}/search/songs`);
    const res = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
      timeout: 6000,
      params: { query, limit: 15 }
    });

    console.log(`[JioSaavn] Response status: ${res.status}, success: ${res.data?.success}`);
    const results = res.data?.data?.results || [];
    console.log(`[JioSaavn] Found ${results.length} results`);
    if (results.length === 0) {
      console.log('[JioSaavn] Raw response data:', JSON.stringify(res.data).slice(0, 500));
      return [];
    }

    return results.map(item => {
      // Pick highest quality download URL (last in array is usually best)
      const downloadUrls = item.downloadUrl || [];
      const bestStream = downloadUrls[downloadUrls.length - 1]?.url
        || downloadUrls[0]?.url
        || null;

      // Pick highest quality image
      const images = item.image || [];
      const bestImage = images[images.length - 1]?.url
        || images[0]?.url
        || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop';

      const artistNames = item.artists?.primary?.map(a => a.name).join(', ')
        || item.artists?.all?.map(a => a.name).join(', ')
        || 'Unknown Artist';

      return {
        source: 'jiosaavn',
        jiosaavn_id: item.id,
        title: item.name,
        artist: artistNames,
        image_url: bestImage,
        duration: formatSeconds(item.duration),
        stream_url: bestStream
      };
    }).filter(s => s.stream_url); // only keep songs with a valid stream URL
  } catch (err) {
    console.error('[JioSaavn] FAILED:', err.message);
    console.error('[JioSaavn] Error code:', err.code);
    console.error('[JioSaavn] Response status:', err.response?.status);
    console.error('[JioSaavn] Response data:', JSON.stringify(err.response?.data || {}).slice(0, 300));
    return [];
  }
};

// ── Debug endpoint — test JioSaavn connectivity directly ───────────────
// Visit: https://your-render-url.onrender.com/api/search/debug-jiosaavn?q=black swan
router.get('/debug-jiosaavn', async (req, res) => {
  const query = req.query.q || 'black swan';
  try {
    const apiRes = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
      timeout: 8000,
      params: { query, limit: 5 }
    });
    res.json({
      success: true,
      apiBase: JIOSAAVN_API_BASE,
      query,
      status: apiRes.status,
      resultCount: apiRes.data?.data?.results?.length || 0,
      sampleResult: apiRes.data?.data?.results?.[0] || null,
      rawDataKeys: Object.keys(apiRes.data || {})
    });
  } catch (err) {
    res.json({
      success: false,
      apiBase: JIOSAAVN_API_BASE,
      query,
      error: err.message,
      code: err.code,
      responseStatus: err.response?.status,
      responseData: err.response?.data || null
    });
  }
});

// ── Search YouTube — existing logic, unchanged ────────────────────────
const searchYouTube = async (query) => {
  try {
    const apiKey = getApiKey();
    const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      timeout: 8000,
      params: { key: apiKey, part: 'snippet', q: `${query} song`, type: 'video', videoCategoryId: '10', maxResults: 15 }
    });

    const items = searchRes.data.items || [];
    if (items.length === 0) return [];

    const videoIds  = items.map(item => item.id.videoId).join(',');
    const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      timeout: 8000,
      params: { key: apiKey, part: 'contentDetails', id: videoIds }
    });

    const durationMap = {};
    (detailsRes.data.items || []).forEach(v => {
      durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
    });

    return items.map(item => {
      const videoId = item.id.videoId;
      const snippet = item.snippet;
      return {
        source: 'youtube',
        youtube_id: videoId,
        title: snippet.title,
        artist: snippet.channelTitle,
        image_url: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url ||
          'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
        duration: durationMap[videoId] || '0:00'
      };
    });
  } catch (ytError) {
    if (ytError.response?.status === 403) {
      throw { quotaExceeded: true };
    }
    console.warn('YouTube API error:', ytError.message);
    return [];
  }
};

// ── Main search ────────────────────────────────────────────────────
// Flow: check local DB cache → try JioSaavn → fallback to YouTube if empty
router.get('/', optionalAuth, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  try {
    const localSongs = await Song.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { artist: { $regex: query, $options: 'i' } }
      ]
    }).limit(15);

    // ✅ Track search query for logged-in users
    if (req.user && query.trim().length > 1) {
      User.findByIdAndUpdate(req.user._id, {
        $push: {
          searchHistory: {
            $each: [{ query: query.trim().toLowerCase() }],
            $slice: -50
          }
        }
      }).catch(() => {});
    }

    if (localSongs.length > 0) {
      console.log(`Cache hit for "${query}" — 0 API units used`);
      return res.json(localSongs);
    }

    // ── Step 1: Try JioSaavn first ────────────────────────────────────
    const jiosaavnResults = await searchJioSaavn(query);

    if (jiosaavnResults.length > 0) {
      // Save to DB cache, keyed by jiosaavn_id
      const upsertPromises = jiosaavnResults.map(song =>
        Song.findOneAndUpdate(
          { jiosaavn_id: song.jiosaavn_id },
          song,
          { upsert: true, new: true, runValidators: false }
        ).catch(() => null)
      );
      const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
      console.log(`JioSaavn hit for "${query}" — ${savedSongs.length} songs`);
      return res.json(savedSongs);
    }

    // ── Step 2: Fallback to YouTube — same logic as before, untouched ──
    try {
      const youtubeResults = await searchYouTube(query);
      if (youtubeResults.length === 0) return res.json([]);

      const upsertPromises = youtubeResults.map(song =>
        Song.findOneAndUpdate(
          { youtube_id: song.youtube_id },
          song,
          { upsert: true, new: true, runValidators: false }
        ).catch(() => null)
      );
      const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
      console.log(`YouTube fallback for "${query}" — ${savedSongs.length} songs`);
      return res.json(savedSongs);
    } catch (ytErr) {
      if (ytErr.quotaExceeded) {
        return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
      }
      return res.json([]);
    }
  } catch (error) {
    console.error('Search Error:', error.message);
    res.status(500).json({ message: 'Search failed', detail: error.message });
  }
});

// ── Resolve YouTube video ID for a JioSaavn song (lazy, on video-button-click) ──
router.get('/youtube-id/:songId', optionalAuth, async (req, res) => {
  try {
    const song = await Song.findById(req.params.songId);
    if (!song) return res.status(404).json({ message: 'Song not found' });

    // Already resolved — return cached value
    if (song.resolved_youtube_id) {
      return res.json({ youtube_id: song.resolved_youtube_id });
    }

    // If this is already a YouTube-sourced song, just return its ID
    if (song.source === 'youtube' && song.youtube_id) {
      return res.json({ youtube_id: song.youtube_id });
    }

    // JioSaavn song — search YouTube to find matching video
    const query = `${song.title} ${song.artist}`;
    const apiKey = getApiKey();
    const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      timeout: 8000,
      params: { key: apiKey, part: 'snippet', q: `${query} official`, type: 'video', videoCategoryId: '10', maxResults: 1 }
    });

    const items = searchRes.data.items || [];
    if (items.length === 0) {
      return res.status(404).json({ message: 'No matching video found' });
    }

    const youtubeId = items[0].id.videoId;

    // Cache the resolved ID so we don't re-search next time
    song.resolved_youtube_id = youtubeId;
    await song.save();

    return res.json({ youtube_id: youtubeId });
  } catch (error) {
    if (error.response?.status === 403) {
      return res.status(429).json({ message: 'YouTube quota exceeded. Please try again tomorrow.' });
    }
    console.error('YouTube ID resolve error:', error.message);
    res.status(500).json({ message: 'Could not resolve video' });
  }
});

// ── Suggestions ────────────────────────────────────────────────────
// For logged-in: personalized based on search history + recently played
// For guests: random songs from DB (same as before)
router.get('/suggestions', optionalAuth, async (req, res) => {
  try {
    const count = await Song.countDocuments();
    if (count === 0) return res.json({ type: 'random', songs: [] });

    const excludeParam = req.query.exclude ? req.query.exclude.split(',').filter(Boolean) : [];

    if (!req.user) {
      const matchStage = excludeParam.length > 0 ? { $match: { _id: { $nin: excludeParam } } } : { $match: {} };
      const songs = await Song.aggregate([matchStage, { $sample: { size: 12 } }]);
      return res.json({ type: 'random', songs });
    }

    const fullUser = await User.findById(req.user._id).populate('recentlyPlayed');
    const recentlyPlayed = fullUser.recentlyPlayed || [];
    const searchHistory  = (fullUser.searchHistory || []).slice(-50);
    const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
    const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

    const excludeIds = [
      ...recentlyPlayed.map(s => s._id.toString()),
      ...excludeParam
    ];

    if (playedArtists.length === 0 && searchKeywords.length === 0) {
      const songs = await Song.aggregate([
        { $match: excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {} },
        { $sample: { size: 12 } }
      ]);
      return res.json({ type: 'random', songs });
    }

    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const artistRegex  = playedArtists.map(a => new RegExp(escape(a), 'i'));
    const keywordRegex = searchKeywords.map(k => new RegExp(escape(k), 'i'));

    let suggestions = await Song.find({
      _id: { $nin: excludeIds },
      $or: [
        { artist: { $in: artistRegex } },
        { title:  { $in: keywordRegex } },
        { artist: { $in: keywordRegex } }
      ]
    }).limit(20);

    if (suggestions.length < 8) {
      const allExclude = [...excludeIds, ...suggestions.map(s => s._id.toString())];
      const extra = await Song.aggregate([
        { $match: allExclude.length > 0 ? { _id: { $nin: allExclude } } : {} },
        { $sample: { size: 12 - suggestions.length } }
      ]);
      suggestions = [...suggestions, ...extra];
    }

    return res.json({ type: 'personalized', songs: suggestions });
  } catch (error) {
    console.error('Suggestions error:', error.message);
    res.status(500).json({ message: 'Could not fetch suggestions' });
  }
});


// ── Smart playlist ─────────────────────────────────────────────────
// Generates a playlist based on user's history — can be saved to library
router.get('/smart-playlist', optionalAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Login required' });
    }

    const fullUser = await User
      .findById(req.user._id)
      .populate('recentlyPlayed');

    const recentlyPlayed = fullUser.recentlyPlayed || [];
    const searchHistory  = (fullUser.searchHistory || []).slice(-50);

    const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
    const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

    if (playedArtists.length === 0 && searchKeywords.length === 0) {
      const songs = await Song.aggregate([{ $sample: { size: 20 } }]);
      return res.json({ title: 'Discover Mix', songs, reason: 'popular' });
    }

    const artistRegex  = playedArtists.map(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    const keywordRegex = searchKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

    let songs = await Song.find({
      $or: [
        { artist: { $in: artistRegex } },
        { title:  { $in: keywordRegex } },
        { artist: { $in: keywordRegex } }
      ]
    }).limit(25);

    const combined = [...recentlyPlayed, ...songs.filter(s =>
      !recentlyPlayed.some(r => r._id.toString() === s._id.toString())
    )].slice(0, 25);

    if (combined.length < 10) {
      const extra = await Song.aggregate([
        { $match: { _id: { $nin: combined.map(s => s._id) } } },
        { $sample: { size: 15 } }
      ]);
      combined.push(...extra);
    }

    const allSongs = combined.sort(() => Math.random() - 0.5);

    const topArtist  = playedArtists[0];
    const topKeyword = searchKeywords[searchKeywords.length - 1];
    const title = topArtist
      ? `${topArtist} & More`
      : topKeyword
        ? `${topKeyword.charAt(0).toUpperCase() + topKeyword.slice(1)} Mix`
        : 'Your Mix';

    res.json({
      title,
      songs: allSongs,
      reason: `Based on your ${recentlyPlayed.length} recently played songs and ${searchKeywords.length} searches`
    });
  } catch (error) {
    console.error('Smart playlist error:', error.message);
    res.status(500).json({ message: 'Could not generate playlist' });
  }
});

module.exports = router;



//ok but logs







// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const Song    = require('../models/Song');
// const User    = require('../models/User');
// const jwt     = require('jsonwebtoken');

// // ── Optional auth ──────────────────────────────────────────────────
// const optionalAuth = async (req, res, next) => {
//   try {
//     const token = req.headers.authorization?.split(' ')[1];
//     if (token) {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       req.user = await User.findById(decoded.id).select('-password');
//     }
//   } catch {}
//   next();
// };

// // ── Duration parser (YouTube ISO8601) ────────────────────────────────
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
//   return `${m}:${String(s).padStart(2,'0')}`;
// };

// // ── Format JioSaavn seconds duration as M:SS ─────────────────────────
// const formatSeconds = (secs) => {
//   const total = parseInt(secs) || 0;
//   const m = Math.floor(total / 60);
//   const s = total % 60;
//   return `${m}:${String(s).padStart(2, '0')}`;
// };

// // ── YouTube API key rotation ──────────────────────────────────────────
// const getApiKey = () => {
//   const keys = [
//     process.env.YOUTUBE_API_KEY_1,
//     process.env.YOUTUBE_API_KEY_2,
//     process.env.YOUTUBE_API_KEY_3,
//   ].filter(Boolean);
//   if (keys.length === 0) return process.env.YOUTUBE_API_KEY;
//   return keys[Math.floor(Math.random() * keys.length)];
// };

// // ── JioSaavn API base — uses public hosted instance by default ───────
// // Set JIOSAAVN_API_BASE in .env if you deploy your own instance later
// const JIOSAAVN_API_BASE = process.env.JIOSAAVN_API_BASE || 'https://saavn.dev/api';

// // ── Search JioSaavn — returns normalized song objects or [] on failure ──
// const searchJioSaavn = async (query) => {
//   try {
//     const res = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 6000,
//       params: { query, limit: 15 }
//     });

//     const results = res.data?.data?.results || [];
//     if (results.length === 0) return [];

//     return results.map(item => {
//       // Pick highest quality download URL (last in array is usually best)
//       const downloadUrls = item.downloadUrl || [];
//       const bestStream = downloadUrls[downloadUrls.length - 1]?.url
//         || downloadUrls[0]?.url
//         || null;

//       // Pick highest quality image
//       const images = item.image || [];
//       const bestImage = images[images.length - 1]?.url
//         || images[0]?.url
//         || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop';

//       const artistNames = item.artists?.primary?.map(a => a.name).join(', ')
//         || item.artists?.all?.map(a => a.name).join(', ')
//         || 'Unknown Artist';

//       return {
//         source: 'jiosaavn',
//         jiosaavn_id: item.id,
//         title: item.name,
//         artist: artistNames,
//         image_url: bestImage,
//         duration: formatSeconds(item.duration),
//         stream_url: bestStream
//       };
//     }).filter(s => s.stream_url); // only keep songs with a valid stream URL
//   } catch (err) {
//     console.warn('JioSaavn search failed, falling back to YouTube:', err.message);
//     return [];
//   }
// };

// // ── Search YouTube — existing logic, unchanged ────────────────────────
// const searchYouTube = async (query) => {
//   try {
//     const apiKey = getApiKey();
//     const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//       timeout: 8000,
//       params: { key: apiKey, part: 'snippet', q: `${query} song`, type: 'video', videoCategoryId: '10', maxResults: 15 }
//     });

//     const items = searchRes.data.items || [];
//     if (items.length === 0) return [];

//     const videoIds  = items.map(item => item.id.videoId).join(',');
//     const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//       timeout: 8000,
//       params: { key: apiKey, part: 'contentDetails', id: videoIds }
//     });

//     const durationMap = {};
//     (detailsRes.data.items || []).forEach(v => {
//       durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//     });

//     return items.map(item => {
//       const videoId = item.id.videoId;
//       const snippet = item.snippet;
//       return {
//         source: 'youtube',
//         youtube_id: videoId,
//         title: snippet.title,
//         artist: snippet.channelTitle,
//         image_url: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url ||
//           'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//         duration: durationMap[videoId] || '0:00'
//       };
//     });
//   } catch (ytError) {
//     if (ytError.response?.status === 403) {
//       throw { quotaExceeded: true };
//     }
//     console.warn('YouTube API error:', ytError.message);
//     return [];
//   }
// };

// // ── Main search ────────────────────────────────────────────────────
// // Flow: check local DB cache → try JioSaavn → fallback to YouTube if empty
// router.get('/', optionalAuth, async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     const localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(15);

//     // ✅ Track search query for logged-in users
//     if (req.user && query.trim().length > 1) {
//       User.findByIdAndUpdate(req.user._id, {
//         $push: {
//           searchHistory: {
//             $each: [{ query: query.trim().toLowerCase() }],
//             $slice: -50
//           }
//         }
//       }).catch(() => {});
//     }

//     if (localSongs.length > 0) {
//       console.log(`Cache hit for "${query}" — 0 API units used`);
//       return res.json(localSongs);
//     }

//     // ── Step 1: Try JioSaavn first ────────────────────────────────────
//     const jiosaavnResults = await searchJioSaavn(query);

//     if (jiosaavnResults.length > 0) {
//       // Save to DB cache, keyed by jiosaavn_id
//       const upsertPromises = jiosaavnResults.map(song =>
//         Song.findOneAndUpdate(
//           { jiosaavn_id: song.jiosaavn_id },
//           song,
//           { upsert: true, new: true, runValidators: false }
//         ).catch(() => null)
//       );
//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       console.log(`JioSaavn hit for "${query}" — ${savedSongs.length} songs`);
//       return res.json(savedSongs);
//     }

//     // ── Step 2: Fallback to YouTube — same logic as before, untouched ──
//     try {
//       const youtubeResults = await searchYouTube(query);
//       if (youtubeResults.length === 0) return res.json([]);

//       const upsertPromises = youtubeResults.map(song =>
//         Song.findOneAndUpdate(
//           { youtube_id: song.youtube_id },
//           song,
//           { upsert: true, new: true, runValidators: false }
//         ).catch(() => null)
//       );
//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       console.log(`YouTube fallback for "${query}" — ${savedSongs.length} songs`);
//       return res.json(savedSongs);
//     } catch (ytErr) {
//       if (ytErr.quotaExceeded) {
//         return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
//       }
//       return res.json([]);
//     }
//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// // ── Resolve YouTube video ID for a JioSaavn song (lazy, on video-button-click) ──
// router.get('/youtube-id/:songId', optionalAuth, async (req, res) => {
//   try {
//     const song = await Song.findById(req.params.songId);
//     if (!song) return res.status(404).json({ message: 'Song not found' });

//     // Already resolved — return cached value
//     if (song.resolved_youtube_id) {
//       return res.json({ youtube_id: song.resolved_youtube_id });
//     }

//     // If this is already a YouTube-sourced song, just return its ID
//     if (song.source === 'youtube' && song.youtube_id) {
//       return res.json({ youtube_id: song.youtube_id });
//     }

//     // JioSaavn song — search YouTube to find matching video
//     const query = `${song.title} ${song.artist}`;
//     const apiKey = getApiKey();
//     const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//       timeout: 8000,
//       params: { key: apiKey, part: 'snippet', q: `${query} official`, type: 'video', videoCategoryId: '10', maxResults: 1 }
//     });

//     const items = searchRes.data.items || [];
//     if (items.length === 0) {
//       return res.status(404).json({ message: 'No matching video found' });
//     }

//     const youtubeId = items[0].id.videoId;

//     // Cache the resolved ID so we don't re-search next time
//     song.resolved_youtube_id = youtubeId;
//     await song.save();

//     return res.json({ youtube_id: youtubeId });
//   } catch (error) {
//     if (error.response?.status === 403) {
//       return res.status(429).json({ message: 'YouTube quota exceeded. Please try again tomorrow.' });
//     }
//     console.error('YouTube ID resolve error:', error.message);
//     res.status(500).json({ message: 'Could not resolve video' });
//   }
// });

// // ── Suggestions ────────────────────────────────────────────────────
// // For logged-in: personalized based on search history + recently played
// // For guests: random songs from DB (same as before)
// router.get('/suggestions', optionalAuth, async (req, res) => {
//   try {
//     const count = await Song.countDocuments();
//     if (count === 0) return res.json({ type: 'random', songs: [] });

//     const excludeParam = req.query.exclude ? req.query.exclude.split(',').filter(Boolean) : [];

//     if (!req.user) {
//       const matchStage = excludeParam.length > 0 ? { $match: { _id: { $nin: excludeParam } } } : { $match: {} };
//       const songs = await Song.aggregate([matchStage, { $sample: { size: 12 } }]);
//       return res.json({ type: 'random', songs });
//     }

//     const fullUser = await User.findById(req.user._id).populate('recentlyPlayed');
//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);
//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     const excludeIds = [
//       ...recentlyPlayed.map(s => s._id.toString()),
//       ...excludeParam
//     ];

//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([
//         { $match: excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {} },
//         { $sample: { size: 12 } }
//       ]);
//       return res.json({ type: 'random', songs });
//     }

//     const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     const artistRegex  = playedArtists.map(a => new RegExp(escape(a), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(escape(k), 'i'));

//     let suggestions = await Song.find({
//       _id: { $nin: excludeIds },
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(20);

//     if (suggestions.length < 8) {
//       const allExclude = [...excludeIds, ...suggestions.map(s => s._id.toString())];
//       const extra = await Song.aggregate([
//         { $match: allExclude.length > 0 ? { _id: { $nin: allExclude } } : {} },
//         { $sample: { size: 12 - suggestions.length } }
//       ]);
//       suggestions = [...suggestions, ...extra];
//     }

//     return res.json({ type: 'personalized', songs: suggestions });
//   } catch (error) {
//     console.error('Suggestions error:', error.message);
//     res.status(500).json({ message: 'Could not fetch suggestions' });
//   }
// });


// // ── Smart playlist ─────────────────────────────────────────────────
// // Generates a playlist based on user's history — can be saved to library
// router.get('/smart-playlist', optionalAuth, async (req, res) => {
//   try {
//     if (!req.user) {
//       return res.status(401).json({ message: 'Login required' });
//     }

//     const fullUser = await User
//       .findById(req.user._id)
//       .populate('recentlyPlayed');

//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);

//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([{ $sample: { size: 20 } }]);
//       return res.json({ title: 'Discover Mix', songs, reason: 'popular' });
//     }

//     const artistRegex  = playedArtists.map(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

//     let songs = await Song.find({
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(25);

//     const combined = [...recentlyPlayed, ...songs.filter(s =>
//       !recentlyPlayed.some(r => r._id.toString() === s._id.toString())
//     )].slice(0, 25);

//     if (combined.length < 10) {
//       const extra = await Song.aggregate([
//         { $match: { _id: { $nin: combined.map(s => s._id) } } },
//         { $sample: { size: 15 } }
//       ]);
//       combined.push(...extra);
//     }

//     const allSongs = combined.sort(() => Math.random() - 0.5);

//     const topArtist  = playedArtists[0];
//     const topKeyword = searchKeywords[searchKeywords.length - 1];
//     const title = topArtist
//       ? `${topArtist} & More`
//       : topKeyword
//         ? `${topKeyword.charAt(0).toUpperCase() + topKeyword.slice(1)} Mix`
//         : 'Your Mix';

//     res.json({
//       title,
//       songs: allSongs,
//       reason: `Based on your ${recentlyPlayed.length} recently played songs and ${searchKeywords.length} searches`
//     });
//   } catch (error) {
//     console.error('Smart playlist error:', error.message);
//     res.status(500).json({ message: 'Could not generate playlist' });
//   }
// });

// module.exports = router;




// jiosavan 






// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const Song    = require('../models/Song');
// const User    = require('../models/User');
// const jwt     = require('jsonwebtoken');

// // ── Optional auth ──────────────────────────────────────────────────
// const optionalAuth = async (req, res, next) => {
//   try {
//     const token = req.headers.authorization?.split(' ')[1];
//     if (token) {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       req.user = await User.findById(decoded.id).select('-password');
//     }
//   } catch {}
//   next();
// };

// // ── Duration parser ────────────────────────────────────────────────
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
//   return `${m}:${String(s).padStart(2,'0')}`;
// };

// // ── API key rotation ───────────────────────────────────────────────
// const getApiKey = () => {
//   const keys = [
//     process.env.YOUTUBE_API_KEY_1,
//     process.env.YOUTUBE_API_KEY_2,
//     process.env.YOUTUBE_API_KEY_3,
//   ].filter(Boolean);
//   if (keys.length === 0) return process.env.YOUTUBE_API_KEY;
//   return keys[Math.floor(Math.random() * keys.length)];
// };

// // ── Main search ────────────────────────────────────────────────────
// router.get('/', optionalAuth, async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     const localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(15);

//     // ✅ Track search query for logged-in users
//     if (req.user && query.trim().length > 1) {
//       User.findByIdAndUpdate(req.user._id, {
//         $push: {
//           searchHistory: {
//             $each: [{ query: query.trim().toLowerCase() }],
//             $slice: -50
//           }
//         }
//       }).catch(() => {});
//     }

//     if (localSongs.length > 0) {
//       console.log(`Cache hit for "${query}" — 0 API units used`);
//       return res.json(localSongs);
//     }

//     // Call YouTube API
//     try {
//       const apiKey = getApiKey();
//       const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//         timeout: 8000,
//         params: { key: apiKey, part: 'snippet', q: `${query} song`, type: 'video', videoCategoryId: '10', maxResults: 15 }
//       });

//       const items = searchRes.data.items || [];
//       if (items.length === 0) return res.json([]);

//       const videoIds  = items.map(item => item.id.videoId).join(',');
//       const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//         timeout: 8000,
//         params: { key: apiKey, part: 'contentDetails', id: videoIds }
//       });

//       const durationMap = {};
//       (detailsRes.data.items || []).forEach(v => {
//         durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//       });

//       const upsertPromises = items.map(async (item) => {
//         const videoId = item.id.videoId;
//         const snippet = item.snippet;
//         return await Song.findOneAndUpdate(
//           { youtube_id: videoId },
//           {
//             youtube_id: videoId,
//             title: snippet.title,
//             artist: snippet.channelTitle,
//             image_url: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url ||
//               'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//             duration: durationMap[videoId] || '0:00'
//           },
//           { upsert: true, new: true, runValidators: false }
//         );
//       });

//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       return res.json(savedSongs);
//     } catch (ytError) {
//       if (ytError.response?.status === 403)
//         return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
//       console.warn('YouTube API error:', ytError.message);
//       return res.json([]);
//     }
//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// // ── Suggestions ────────────────────────────────────────────────────
// // For logged-in: personalized based on search history + recently played
// // For guests: random songs from DB (same as before)
// router.get('/suggestions', optionalAuth, async (req, res) => {
//   try {
//     const count = await Song.countDocuments();
//     if (count === 0) return res.json({ type: 'random', songs: [] });

//     // exclude param — IDs of songs currently shown, to skip on refresh
//     const excludeParam = req.query.exclude ? req.query.exclude.split(',').filter(Boolean) : [];

//     // Guest user — random songs excluding currently shown
//     if (!req.user) {
//       const matchStage = excludeParam.length > 0 ? { $match: { _id: { $nin: excludeParam } } } : { $match: {} };
//       const songs = await Song.aggregate([matchStage, { $sample: { size: 12 } }]);
//       return res.json({ type: 'random', songs });
//     }

//     // Logged-in user — personalized
//     const fullUser = await User.findById(req.user._id).populate('recentlyPlayed');
//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);
//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     // All IDs to exclude: recently played + currently shown (for refresh variety)
//     const excludeIds = [
//       ...recentlyPlayed.map(s => s._id.toString()),
//       ...excludeParam
//     ];

//     // No history — return random excluding current shown
//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([
//         { $match: excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {} },
//         { $sample: { size: 12 } }
//       ]);
//       return res.json({ type: 'random', songs });
//     }

//     const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     const artistRegex  = playedArtists.map(a => new RegExp(escape(a), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(escape(k), 'i'));

//     // Find matching songs excluding seen ones
//     let suggestions = await Song.find({
//       _id: { $nin: excludeIds },
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(20);

//     // Fill with random if not enough
//     if (suggestions.length < 8) {
//       const allExclude = [...excludeIds, ...suggestions.map(s => s._id.toString())];
//       const extra = await Song.aggregate([
//         { $match: allExclude.length > 0 ? { _id: { $nin: allExclude } } : {} },
//         { $sample: { size: 12 - suggestions.length } }
//       ]);
//       suggestions = [...suggestions, ...extra];
//     }

//     return res.json({ type: 'personalized', songs: suggestions });
//   } catch (error) {
//     console.error('Suggestions error:', error.message);
//     res.status(500).json({ message: 'Could not fetch suggestions' });
//   }
// });


// // ── Smart playlist ─────────────────────────────────────────────────
// // Generates a playlist based on user's history — can be saved to library
// router.get('/smart-playlist', optionalAuth, async (req, res) => {
//   try {
//     if (!req.user) {
//       return res.status(401).json({ message: 'Login required' });
//     }

//     const fullUser = await User
//       .findById(req.user._id)
//       .populate('recentlyPlayed');

//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);

//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([{ $sample: { size: 20 } }]);
//       return res.json({ title: 'Discover Mix', songs, reason: 'popular' });
//     }

//     const artistRegex  = playedArtists.map(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

//     // Get matching songs
//     let songs = await Song.find({
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(25);

//     // Include recently played songs too (full playlist)
//     const combined = [...recentlyPlayed, ...songs.filter(s =>
//       !recentlyPlayed.some(r => r._id.toString() === s._id.toString())
//     )].slice(0, 25);

//     // Fill with random if less than 10
//     if (combined.length < 10) {
//       const extra = await Song.aggregate([
//         { $match: { _id: { $nin: combined.map(s => s._id) } } },
//         { $sample: { size: 15 } }
//       ]);
//       combined.push(...extra);
//     }

//     // ✅ Shuffle the playlist every time so refresh shows different order
//     const allSongs = combined.sort(() => Math.random() - 0.5);

//     // Build a smart title based on top artist/keyword
//     const topArtist  = playedArtists[0];
//     const topKeyword = searchKeywords[searchKeywords.length - 1];
//     const title = topArtist
//       ? `${topArtist} & More`
//       : topKeyword
//         ? `${topKeyword.charAt(0).toUpperCase() + topKeyword.slice(1)} Mix`
//         : 'Your Mix';

//     res.json({
//       title,
//       songs: allSongs,
//       reason: `Based on your ${recentlyPlayed.length} recently played songs and ${searchKeywords.length} searches`
//     });
//   } catch (error) {
//     console.error('Smart playlist error:', error.message);
//     res.status(500).json({ message: 'Could not generate playlist' });
//   }
// });

// module.exports = router;

// refresh and lyrics


// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const Song    = require('../models/Song');
// const User    = require('../models/User');
// const jwt     = require('jsonwebtoken');

// // ── Optional auth ──────────────────────────────────────────────────
// const optionalAuth = async (req, res, next) => {
//   try {
//     const token = req.headers.authorization?.split(' ')[1];
//     if (token) {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       req.user = await User.findById(decoded.id).select('-password');
//     }
//   } catch {}
//   next();
// };

// // ── Duration parser ────────────────────────────────────────────────
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
//   return `${m}:${String(s).padStart(2,'0')}`;
// };

// // ── API key rotation ───────────────────────────────────────────────
// const getApiKey = () => {
//   const keys = [
//     process.env.YOUTUBE_API_KEY_1,
//     process.env.YOUTUBE_API_KEY_2,
//     process.env.YOUTUBE_API_KEY_3,
//   ].filter(Boolean);
//   if (keys.length === 0) return process.env.YOUTUBE_API_KEY;
//   return keys[Math.floor(Math.random() * keys.length)];
// };

// // ── Main search ────────────────────────────────────────────────────
// router.get('/', optionalAuth, async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     const localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(15);

//     // ✅ Track search query for logged-in users
//     if (req.user && query.trim().length > 1) {
//       User.findByIdAndUpdate(req.user._id, {
//         $push: {
//           searchHistory: {
//             $each: [{ query: query.trim().toLowerCase() }],
//             $slice: -50
//           }
//         }
//       }).catch(() => {});
//     }

//     if (localSongs.length > 0) {
//       console.log(`Cache hit for "${query}" — 0 API units used`);
//       return res.json(localSongs);
//     }

//     // Call YouTube API
//     try {
//       const apiKey = getApiKey();
//       const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//         timeout: 8000,
//         params: { key: apiKey, part: 'snippet', q: `${query} song`, type: 'video', videoCategoryId: '10', maxResults: 15 }
//       });

//       const items = searchRes.data.items || [];
//       if (items.length === 0) return res.json([]);

//       const videoIds  = items.map(item => item.id.videoId).join(',');
//       const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//         timeout: 8000,
//         params: { key: apiKey, part: 'contentDetails', id: videoIds }
//       });

//       const durationMap = {};
//       (detailsRes.data.items || []).forEach(v => {
//         durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//       });

//       const upsertPromises = items.map(async (item) => {
//         const videoId = item.id.videoId;
//         const snippet = item.snippet;
//         return await Song.findOneAndUpdate(
//           { youtube_id: videoId },
//           {
//             youtube_id: videoId,
//             title: snippet.title,
//             artist: snippet.channelTitle,
//             image_url: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url ||
//               'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//             duration: durationMap[videoId] || '0:00'
//           },
//           { upsert: true, new: true, runValidators: false }
//         );
//       });

//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       return res.json(savedSongs);
//     } catch (ytError) {
//       if (ytError.response?.status === 403)
//         return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
//       console.warn('YouTube API error:', ytError.message);
//       return res.json([]);
//     }
//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// // ── Suggestions ────────────────────────────────────────────────────
// // For logged-in: personalized based on search history + recently played
// // For guests: random songs from DB (same as before)
// router.get('/suggestions', optionalAuth, async (req, res) => {
//   try {
//     const count = await Song.countDocuments();
//     if (count === 0) return res.json({ type: 'random', songs: [] });

//     // exclude param — IDs of songs currently shown, to skip on refresh
//     const excludeParam = req.query.exclude ? req.query.exclude.split(',').filter(Boolean) : [];

//     // Guest user — random songs excluding currently shown
//     if (!req.user) {
//       const matchStage = excludeParam.length > 0 ? { $match: { _id: { $nin: excludeParam } } } : { $match: {} };
//       const songs = await Song.aggregate([matchStage, { $sample: { size: 12 } }]);
//       return res.json({ type: 'random', songs });
//     }

//     // Logged-in user — personalized
//     const fullUser = await User.findById(req.user._id).populate('recentlyPlayed');
//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);
//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     // All IDs to exclude: recently played + currently shown (for refresh variety)
//     const excludeIds = [
//       ...recentlyPlayed.map(s => s._id.toString()),
//       ...excludeParam
//     ];

//     // No history — return random excluding current shown
//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([
//         { $match: excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {} },
//         { $sample: { size: 12 } }
//       ]);
//       return res.json({ type: 'random', songs });
//     }

//     const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     const artistRegex  = playedArtists.map(a => new RegExp(escape(a), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(escape(k), 'i'));

//     // Find matching songs excluding seen ones
//     let suggestions = await Song.find({
//       _id: { $nin: excludeIds },
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(20);

//     // Fill with random if not enough
//     if (suggestions.length < 8) {
//       const allExclude = [...excludeIds, ...suggestions.map(s => s._id.toString())];
//       const extra = await Song.aggregate([
//         { $match: allExclude.length > 0 ? { _id: { $nin: allExclude } } : {} },
//         { $sample: { size: 12 - suggestions.length } }
//       ]);
//       suggestions = [...suggestions, ...extra];
//     }

//     return res.json({ type: 'personalized', songs: suggestions });
//   } catch (error) {
//     console.error('Suggestions error:', error.message);
//     res.status(500).json({ message: 'Could not fetch suggestions' });
//   }
// });


// // ── Smart playlist ─────────────────────────────────────────────────
// // Generates a playlist based on user's history — can be saved to library
// router.get('/smart-playlist', optionalAuth, async (req, res) => {
//   try {
//     if (!req.user) {
//       return res.status(401).json({ message: 'Login required' });
//     }

//     const fullUser = await User
//       .findById(req.user._id)
//       .populate('recentlyPlayed');

//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);

//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([{ $sample: { size: 20 } }]);
//       return res.json({ title: 'Discover Mix', songs, reason: 'popular' });
//     }

//     const artistRegex  = playedArtists.map(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

//     // Get matching songs
//     let songs = await Song.find({
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(25);

//     // Include recently played songs too (full playlist)
//     const allSongs = [...recentlyPlayed, ...songs.filter(s =>
//       !recentlyPlayed.some(r => r._id.toString() === s._id.toString())
//     )].slice(0, 25);

//     // Fill with random if less than 10
//     if (allSongs.length < 10) {
//       const extra = await Song.aggregate([
//         { $match: { _id: { $nin: allSongs.map(s => s._id) } } },
//         { $sample: { size: 15 } }
//       ]);
//       allSongs.push(...extra);
//     }

//     // Build a smart title based on top artist/keyword
//     const topArtist  = playedArtists[0];
//     const topKeyword = searchKeywords[searchKeywords.length - 1];
//     const title = topArtist
//       ? `${topArtist} & More`
//       : topKeyword
//         ? `${topKeyword.charAt(0).toUpperCase() + topKeyword.slice(1)} Mix`
//         : 'Your Mix';

//     res.json({
//       title,
//       songs: allSongs,
//       reason: `Based on your ${recentlyPlayed.length} recently played songs and ${searchKeywords.length} searches`
//     });
//   } catch (error) {
//     console.error('Smart playlist error:', error.message);
//     res.status(500).json({ message: 'Could not generate playlist' });
//   }
// });

// module.exports = router;

// refresh biutton n


// const express = require('express');
// const router  = express.Router();
// const axios   = require('axios');
// const Song    = require('../models/Song');
// const User    = require('../models/User');
// const jwt     = require('jsonwebtoken');

// // ── Optional auth ──────────────────────────────────────────────────
// const optionalAuth = async (req, res, next) => {
//   try {
//     const token = req.headers.authorization?.split(' ')[1];
//     if (token) {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
//       req.user = await User.findById(decoded.id).select('-password');
//     }
//   } catch {}
//   next();
// };

// // ── Duration parser ────────────────────────────────────────────────
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
//   return `${m}:${String(s).padStart(2,'0')}`;
// };

// // ── API key rotation ───────────────────────────────────────────────
// const getApiKey = () => {
//   const keys = [
//     process.env.YOUTUBE_API_KEY_1,
//     process.env.YOUTUBE_API_KEY_2,
//     process.env.YOUTUBE_API_KEY_3,
//   ].filter(Boolean);
//   if (keys.length === 0) return process.env.YOUTUBE_API_KEY;
//   return keys[Math.floor(Math.random() * keys.length)];
// };

// // ── Main search ────────────────────────────────────────────────────
// router.get('/', optionalAuth, async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     const localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(15);

//     // ✅ Track search query for logged-in users
//     if (req.user && query.trim().length > 1) {
//       User.findByIdAndUpdate(req.user._id, {
//         $push: {
//           searchHistory: {
//             $each: [{ query: query.trim().toLowerCase() }],
//             $slice: -50
//           }
//         }
//       }).catch(() => {});
//     }

//     if (localSongs.length > 0) {
//       console.log(`Cache hit for "${query}" — 0 API units used`);
//       return res.json(localSongs);
//     }

//     // Call YouTube API
//     try {
//       const apiKey = getApiKey();
//       const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//         timeout: 8000,
//         params: { key: apiKey, part: 'snippet', q: `${query} song`, type: 'video', videoCategoryId: '10', maxResults: 15 }
//       });

//       const items = searchRes.data.items || [];
//       if (items.length === 0) return res.json([]);

//       const videoIds  = items.map(item => item.id.videoId).join(',');
//       const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//         timeout: 8000,
//         params: { key: apiKey, part: 'contentDetails', id: videoIds }
//       });

//       const durationMap = {};
//       (detailsRes.data.items || []).forEach(v => {
//         durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//       });

//       const upsertPromises = items.map(async (item) => {
//         const videoId = item.id.videoId;
//         const snippet = item.snippet;
//         return await Song.findOneAndUpdate(
//           { youtube_id: videoId },
//           {
//             youtube_id: videoId,
//             title: snippet.title,
//             artist: snippet.channelTitle,
//             image_url: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url ||
//               'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//             duration: durationMap[videoId] || '0:00'
//           },
//           { upsert: true, new: true, runValidators: false }
//         );
//       });

//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       return res.json(savedSongs);
//     } catch (ytError) {
//       if (ytError.response?.status === 403)
//         return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
//       console.warn('YouTube API error:', ytError.message);
//       return res.json([]);
//     }
//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// // ── Suggestions ────────────────────────────────────────────────────
// // For logged-in: personalized based on search history + recently played
// // For guests: random songs from DB (same as before)
// router.get('/suggestions', optionalAuth, async (req, res) => {
//   try {
//     const count = await Song.countDocuments();
//     if (count === 0) return res.json({ type: 'random', songs: [] });

//     // ── Guest user — random songs from DB (old behaviour) ──────────
//     if (!req.user) {
//       const songs = await Song.aggregate([{ $sample: { size: 12 } }]);
//       return res.json({ type: 'random', songs });
//     }

//     // ── Logged-in user — personalized ──────────────────────────────
//     const fullUser = await User
//       .findById(req.user._id)
//       .populate('recentlyPlayed');

//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);

//     // Extract artists from recently played songs
//     const playedArtists = [...new Set(
//       recentlyPlayed.map(s => s.artist).filter(Boolean)
//     )];

//     // Extract keywords from search history
//     const searchKeywords = [...new Set(
//       searchHistory.map(s => s.query).filter(Boolean)
//     )].slice(-15);

//     // No history at all — return random
//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([{ $sample: { size: 12 } }]);
//       return res.json({ type: 'random', songs });
//     }

//     // Build queries
//     const artistRegex  = playedArtists.map(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

//     const excludeIds = recentlyPlayed.map(s => s._id);

//     // Find songs matching artists OR keywords, excluding already played
//     let suggestions = await Song.find({
//       _id: { $nin: excludeIds },
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(20);

//     // Fill remaining with random if not enough
//     if (suggestions.length < 8) {
//       const extra = await Song.aggregate([
//         { $match: { _id: { $nin: [...excludeIds, ...suggestions.map(s => s._id)] } } },
//         { $sample: { size: 12 - suggestions.length } }
//       ]);
//       suggestions = [...suggestions, ...extra];
//     }

//     return res.json({ type: 'personalized', songs: suggestions });
//   } catch (error) {
//     console.error('Suggestions error:', error.message);
//     res.status(500).json({ message: 'Could not fetch suggestions' });
//   }
// });

// // ── Smart playlist ─────────────────────────────────────────────────
// // Generates a playlist based on user's history — can be saved to library
// router.get('/smart-playlist', optionalAuth, async (req, res) => {
//   try {
//     if (!req.user) {
//       return res.status(401).json({ message: 'Login required' });
//     }

//     const fullUser = await User
//       .findById(req.user._id)
//       .populate('recentlyPlayed');

//     const recentlyPlayed = fullUser.recentlyPlayed || [];
//     const searchHistory  = (fullUser.searchHistory || []).slice(-50);

//     const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
//     const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);

//     if (playedArtists.length === 0 && searchKeywords.length === 0) {
//       const songs = await Song.aggregate([{ $sample: { size: 20 } }]);
//       return res.json({ title: 'Discover Mix', songs, reason: 'popular' });
//     }

//     const artistRegex  = playedArtists.map(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
//     const keywordRegex = searchKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

//     // Get matching songs
//     let songs = await Song.find({
//       $or: [
//         { artist: { $in: artistRegex } },
//         { title:  { $in: keywordRegex } },
//         { artist: { $in: keywordRegex } }
//       ]
//     }).limit(25);

//     // Include recently played songs too (full playlist)
//     const allSongs = [...recentlyPlayed, ...songs.filter(s =>
//       !recentlyPlayed.some(r => r._id.toString() === s._id.toString())
//     )].slice(0, 25);

//     // Fill with random if less than 10
//     if (allSongs.length < 10) {
//       const extra = await Song.aggregate([
//         { $match: { _id: { $nin: allSongs.map(s => s._id) } } },
//         { $sample: { size: 15 } }
//       ]);
//       allSongs.push(...extra);
//     }

//     // Build a smart title based on top artist/keyword
//     const topArtist  = playedArtists[0];
//     const topKeyword = searchKeywords[searchKeywords.length - 1];
//     const title = topArtist
//       ? `${topArtist} & More`
//       : topKeyword
//         ? `${topKeyword.charAt(0).toUpperCase() + topKeyword.slice(1)} Mix`
//         : 'Your Mix';

//     res.json({
//       title,
//       songs: allSongs,
//       reason: `Based on your ${recentlyPlayed.length} recently played songs and ${searchKeywords.length} searches`
//     });
//   } catch (error) {
//     console.error('Smart playlist error:', error.message);
//     res.status(500).json({ message: 'Could not generate playlist' });
//   }
// });

// module.exports = router;




//serchroutes.js,searchbar homepage for vts suggestion


// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const Song = require('../models/Song');

// // Helper: convert YouTube ISO 8601 duration (PT4M13S) to readable "4:13"
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
//   return `${m}:${String(s).padStart(2, '0')}`;
// };

// // Rotate through multiple API keys to maximize free quota
// // Add as many keys as you have to YOUTUBE_API_KEY_1, YOUTUBE_API_KEY_2, etc. in .env
// const getApiKey = () => {
//   const keys = [
//     process.env.YOUTUBE_API_KEY_1,
//     process.env.YOUTUBE_API_KEY_2,
//     process.env.YOUTUBE_API_KEY_3,
//   ].filter(Boolean); // remove undefined keys

//   if (keys.length === 0) return process.env.YOUTUBE_API_KEY; // fallback to old single key
//   // Pick a random key each request — distributes usage evenly across keys
//   return keys[Math.floor(Math.random() * keys.length)];
// };

// router.get('/', async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     // ── Step 1: Search MongoDB cache first ──────────────────────────────
//     const localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(15);

//     // ✅ OPTIMIZATION: Only call YouTube API if NO results exist in DB at all
//     // Previously this was < 5, meaning YouTube was called even when we had results
//     // Now cached results are always served without touching the API quota
//     if (localSongs.length > 0) {
//       console.log(`Cache hit for "${query}" — ${localSongs.length} songs, 0 API units used`);
//       return res.json(localSongs);
//     }

//     // ── Step 2: Nothing in cache — call YouTube API ──────────────────────
//     console.log(`Cache miss for "${query}" — calling YouTube API`);
//     try {
//       const apiKey = getApiKey();

//       // Step A: Search for video IDs (~100 units)
//       const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//         timeout: 8000,
//         params: {
//           key: apiKey,
//           part: 'snippet',
//           q: `${query} song`,
//           type: 'video',
//           videoCategoryId: '10',
//           maxResults: 15
//         }
//       });

//       const items = searchRes.data.items || [];
//       if (items.length === 0) return res.json([]);

//       // Step B: Get video durations (~1 unit per video)
//       const videoIds = items.map(item => item.id.videoId).join(',');
//       const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//         timeout: 8000,
//         params: {
//           key: apiKey,
//           part: 'contentDetails',
//           id: videoIds
//         }
//       });

//       const durationMap = {};
//       (detailsRes.data.items || []).forEach(v => {
//         durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//       });

//       // Step C: Save results to MongoDB so future searches are free
//       const upsertPromises = items.map(async (item) => {
//         const videoId = item.id.videoId;
//         const snippet = item.snippet;
//         return await Song.findOneAndUpdate(
//           { youtube_id: videoId },
//           {
//             youtube_id: videoId,
//             title: snippet.title,
//             artist: snippet.channelTitle,
//             image_url: snippet.thumbnails?.medium?.url ||
//               snippet.thumbnails?.default?.url ||
//               'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//             duration: durationMap[videoId] || '0:00'
//           },
//           { upsert: true, new: true, runValidators: false }
//         );
//       });

//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       console.log(`Saved ${savedSongs.length} songs to cache for "${query}"`);
//       return res.json(savedSongs);

//     } catch (ytError) {
//       // Handle quota exceeded specifically
//       if (ytError.response?.status === 403) {
//         console.error('YouTube API quota exceeded or invalid key');
//         return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
//       }
//       console.warn('YouTube API error:', ytError.message);
//       return res.json([]); // Return empty gracefully
//     }

//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// // ✅ Suggestions — returns random cached songs from MongoDB (no API call)
// router.get('/suggestions', async (req, res) => {
//   try {
//     const count = await Song.countDocuments();
//     if (count === 0) return res.json([]);
//     // Get 12 random songs using MongoDB aggregation
//     const songs = await Song.aggregate([{ $sample: { size: 12 } }]);
//     res.json(songs);
//   } catch (error) {
//     console.error('Suggestions error:', error.message);
//     res.status(500).json({ message: 'Could not fetch suggestions' });
//   }
// });

// module.exports = router;


//searchroutes and searchbar are updated for suggestion below search bar 



// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const Song = require('../models/Song');

// // Helper: convert YouTube ISO 8601 duration (PT4M13S) to readable "4:13"
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
//   return `${m}:${String(s).padStart(2, '0')}`;
// };

// // Rotate through multiple API keys to maximize free quota
// // Add as many keys as you have to YOUTUBE_API_KEY_1, YOUTUBE_API_KEY_2, etc. in .env
// const getApiKey = () => {
//   const keys = [
//     process.env.YOUTUBE_API_KEY_1,
//     process.env.YOUTUBE_API_KEY_2,
//     process.env.YOUTUBE_API_KEY_3,
//   ].filter(Boolean); // remove undefined keys

//   if (keys.length === 0) return process.env.YOUTUBE_API_KEY; // fallback to old single key
//   // Pick a random key each request — distributes usage evenly across keys
//   return keys[Math.floor(Math.random() * keys.length)];
// };

// router.get('/', async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     // ── Step 1: Search MongoDB cache first ──────────────────────────────
//     const localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(15);

//     // ✅ OPTIMIZATION: Only call YouTube API if NO results exist in DB at all
//     // Previously this was < 5, meaning YouTube was called even when we had results
//     // Now cached results are always served without touching the API quota
//     if (localSongs.length > 0) {
//       console.log(`Cache hit for "${query}" — ${localSongs.length} songs, 0 API units used`);
//       return res.json(localSongs);
//     }

//     // ── Step 2: Nothing in cache — call YouTube API ──────────────────────
//     console.log(`Cache miss for "${query}" — calling YouTube API`);
//     try {
//       const apiKey = getApiKey();

//       // Step A: Search for video IDs (~100 units)
//       const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//         timeout: 8000,
//         params: {
//           key: apiKey,
//           part: 'snippet',
//           q: `${query} song`,
//           type: 'video',
//           videoCategoryId: '10',
//           maxResults: 15
//         }
//       });

//       const items = searchRes.data.items || [];
//       if (items.length === 0) return res.json([]);

//       // Step B: Get video durations (~1 unit per video)
//       const videoIds = items.map(item => item.id.videoId).join(',');
//       const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//         timeout: 8000,
//         params: {
//           key: apiKey,
//           part: 'contentDetails',
//           id: videoIds
//         }
//       });

//       const durationMap = {};
//       (detailsRes.data.items || []).forEach(v => {
//         durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//       });

//       // Step C: Save results to MongoDB so future searches are free
//       const upsertPromises = items.map(async (item) => {
//         const videoId = item.id.videoId;
//         const snippet = item.snippet;
//         return await Song.findOneAndUpdate(
//           { youtube_id: videoId },
//           {
//             youtube_id: videoId,
//             title: snippet.title,
//             artist: snippet.channelTitle,
//             image_url: snippet.thumbnails?.medium?.url ||
//               snippet.thumbnails?.default?.url ||
//               'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//             duration: durationMap[videoId] || '0:00'
//           },
//           { upsert: true, new: true, runValidators: false }
//         );
//       });

//       const savedSongs = (await Promise.all(upsertPromises)).filter(Boolean);
//       console.log(`Saved ${savedSongs.length} songs to cache for "${query}"`);
//       return res.json(savedSongs);

//     } catch (ytError) {
//       // Handle quota exceeded specifically
//       if (ytError.response?.status === 403) {
//         console.error('YouTube API quota exceeded or invalid key');
//         return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
//       }
//       console.warn('YouTube API error:', ytError.message);
//       return res.json([]); // Return empty gracefully
//     }

//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// module.exports = router;



//searchroutes.js amnd search bar and .env updated for youtube api and search functionality

// 
// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const Song = require('../models/Song');

// // Helper: convert YouTube ISO 8601 duration (PT4M13S) to readable "4:13"
// const parseISO8601Duration = (iso) => {
//   if (!iso) return '0:00';
//   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
//   if (!match) return '0:00';
//   const h = parseInt(match[1] || 0);
//   const m = parseInt(match[2] || 0);
//   const s = parseInt(match[3] || 0);
//   if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
//   return `${m}:${String(s).padStart(2, '0')}`;
// };

// router.get('/', async (req, res) => {
//   const query = req.query.q;
//   if (!query) return res.json([]);

//   try {
//     // 1. Search local MongoDB first
//     let localSongs = await Song.find({
//       $or: [
//         { title: { $regex: query, $options: 'i' } },
//         { artist: { $regex: query, $options: 'i' } }
//       ]
//     }).limit(10);

//     // 2. If sparse, fetch from YouTube Data API v3
//     if (localSongs.length < 5) {
//       try {
//         // Step A: Search for video IDs
//         const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
//           timeout: 8000,
//           params: {
//             key: process.env.YOUTUBE_API_KEY,
//             part: 'snippet',
//             q: `${query} song`,
//             type: 'video',
//             videoCategoryId: '10', // Music category
//             maxResults: 15
//           }
//         });

//         const items = searchRes.data.items || [];
//         if (items.length === 0) return res.json(localSongs);

//         // Step B: Get video durations via videos endpoint
//         const videoIds = items.map(item => item.id.videoId).join(',');
//         const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
//           timeout: 8000,
//           params: {
//             key: process.env.YOUTUBE_API_KEY,
//             part: 'contentDetails',
//             id: videoIds
//           }
//         });

//         // Map duration by videoId
//         const durationMap = {};
//         (detailsRes.data.items || []).forEach(v => {
//           durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
//         });

//         // Step C: Upsert into MongoDB
//         const upsertPromises = items.map(async (item) => {
//           const videoId = item.id.videoId;
//           const snippet = item.snippet;
//           return await Song.findOneAndUpdate(
//             { youtube_id: videoId },
//             {
//               youtube_id: videoId,
//               title: snippet.title,
//               artist: snippet.channelTitle,
//               image_url: snippet.thumbnails?.medium?.url ||
//                 snippet.thumbnails?.default?.url ||
//                 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
//               duration: durationMap[videoId] || '0:00'
//             },
//             { upsert: true, new: true, runValidators: false }
//           );
//         });

//         const savedSongs = await Promise.all(upsertPromises);

//         // Combine local + YouTube results
//         const combined = [...localSongs];
//         savedSongs.forEach(ss => {
//           if (ss && !combined.some(cs => cs._id.toString() === ss._id.toString())) {
//             combined.push(ss);
//           }
//         });
//         return res.json(combined);

//       } catch (ytError) {
//         console.warn('YouTube API error:', ytError.message);
//         return res.json(localSongs); // Fall back to local results gracefully
//       }
//     }

//     res.json(localSongs);
//   } catch (error) {
//     console.error('Search Error:', error.message);
//     res.status(500).json({ message: 'Search failed', detail: error.message });
//   }
// });

// module.exports = router;
