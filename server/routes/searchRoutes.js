const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const Song    = require('../models/Song');
const User    = require('../models/User');
const jwt     = require('jsonwebtoken');

// ── DNS fix for Render ────────────────────────────────────────────────
const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('DNS config warning:', e.message);
}

// ── Optional auth ─────────────────────────────────────────────────────
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

// ── Duration helpers ──────────────────────────────────────────────────
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

const formatSeconds = (secs) => {
  const total = parseInt(secs) || 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
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

// ── JioSaavn API instances — tried in order until one works ──────────
// Your Workers proxy is first (fastest). Community instances are fallbacks.
// If saavn.dev goes down (like it did), the others kick in automatically.
const JIOSAAVN_INSTANCES = [
  process.env.JIOSAAVN_API_BASE,                              // your CF Workers proxy
  'https://jiosaavn-api-privatecvc2.vercel.app/api',         // community fallback 1
  'https://saavn-api-sigma.vercel.app/api',                  // community fallback 2
  'https://jiosaavn-api.vercel.app/api',                     // community fallback 3
].filter(Boolean);

// ── Score a JioSaavn result for relevance ────────────────────────────
const scoreJioSaavnResult = (item, query) => {
  const q       = query.toLowerCase().trim();
  const title   = (item.name || '').toLowerCase();
  const lang    = (item.language || '').toLowerCase();
  const label   = (item.label || '').toLowerCase();
  const year    = parseInt(item.year) || new Date().getFullYear();
  const plays   = item.playCount || 0;

  let score = 0;

  // Title match
  if (title === q)               score += 100;
  else if (title.startsWith(q)) score += 70;
  else if (title.includes(q))   score += 40;

  // Hard penalize: covers / instrumentals / karaoke / sequels
  if (lang === 'instrumental')           score -= 80;
  if (item.hasLyrics === false)          score -= 40;
  if (title.includes('cover'))           score -= 50;
  if (title.includes('karaoke'))         score -= 80;
  if (title.includes('tribute'))         score -= 50;
  if (title.includes('ringtone'))        score -= 80;
  if (title.includes('bgm'))             score -= 60;
  if (title.includes('lofi'))            score -= 20;
  if (title.includes('remix'))           score -= 15;
  if (/\bii\b/.test(title))             score -= 40;  // "Awarapan II"
  if (title.includes(' 2)'))            score -= 40;  // "Song (From Movie 2)"
  if (title.includes('part 2'))         score -= 40;
  if (title.includes('version'))        score -= 20;
  if (title.includes('reprise'))        score -= 30;

  // Penalize: old song with suspiciously low plays (likely cover)
  const age = new Date().getFullYear() - year;
  if (age > 5  && plays < 500_000)   score -= 40;
  if (age > 10 && plays < 1_000_000) score -= 20;

  // Boost: high play count = popular original
  if (plays > 100_000)     score += 10;
  if (plays > 1_000_000)   score += 20;
  if (plays > 10_000_000)  score += 30;
  if (plays > 100_000_000) score += 20;

  // Boost: major Indian labels
  const MAJOR_LABELS = [
    't-series', 'sony music', 'zee music', 'saregama',
    'tips music', 'eros', 'yrf', 'dharma', 'speed records',
    'lahari music', 'aditya music', 'venus', 'universal'
  ];
  if (MAJOR_LABELS.some(l => label.includes(l))) score += 25;

  // Boost: has lyrics, Hindi/Punjabi language
  if (item.hasLyrics === true) score += 20;
  if (lang === 'hindi')        score += 15;
  if (lang === 'punjabi')      score += 10;

  return score;
};

// ── Call one JioSaavn instance ────────────────────────────────────────
const callJioSaavnInstance = async (base, query, limit = 30) => {
  const res = await axios.get(`${base}/search/songs`, {
    timeout: 6000,
    params: { query, limit }
  });
  return res.data?.data?.results || [];
};

// ── Search JioSaavn with multi-instance fallback + scoring ───────────
const searchJioSaavn = async (query, limit = 30) => {
  let rawResults = [];

  // Try each instance until one returns results
  for (const base of JIOSAAVN_INSTANCES) {
    try {
      console.log(`[JioSaavn] Trying: ${base} for "${query}"`);
      rawResults = await callJioSaavnInstance(base, query, limit);
      if (rawResults.length > 0) {
        console.log(`[JioSaavn] Got ${rawResults.length} results from ${base}`);
        break;
      }
    } catch (err) {
      console.warn(`[JioSaavn] Instance ${base} failed: ${err.message}`);
    }
  }

  if (rawResults.length === 0) return [];

  // Score and sort
  const scored = rawResults
    .map(item => ({ item, score: scoreJioSaavnResult(item, query) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[JioSaavn] Top 3: ${scored.slice(0,3).map(s => `"${s.item.name}" (score:${s.score}, plays:${s.item.playCount})`).join(' | ')}`);

  return scored.map(({ item }) => {
    const downloadUrls = item.downloadUrl || [];
    const bestStream   = downloadUrls[downloadUrls.length - 1]?.url
      || downloadUrls[0]?.url || null;

    const images    = item.image || [];
    const bestImage = images[images.length - 1]?.url
      || images[0]?.url
      || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop';

    const artistNames = item.artists?.primary?.map(a => a.name).join(', ')
      || item.artists?.all?.map(a => a.name).join(', ')
      || 'Unknown Artist';

    return {
      source:      'jiosaavn',
      jiosaavn_id: item.id,
      title:       item.name,
      artist:      artistNames,
      image_url:   bestImage,
      duration:    formatSeconds(item.duration),
      stream_url:  bestStream,
      language:    item.language || '',
      play_count:  item.playCount || 0,
      year:        item.year || null
    };
  }).filter(s => s.stream_url);
};

// ── Search YouTube ────────────────────────────────────────────────────
const searchYouTube = async (query) => {
  try {
    const apiKey = getApiKey();
    const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      timeout: 8000,
      params: { key: apiKey, part: 'snippet', q: `${query} song`, type: 'video', videoCategoryId: '10', maxResults: 15 }
    });

    const items = searchRes.data.items || [];
    if (items.length === 0) return [];

    const videoIds   = items.map(i => i.id.videoId).join(',');
    const detailsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      timeout: 8000,
      params: { key: apiKey, part: 'contentDetails', id: videoIds }
    });

    const durationMap = {};
    (detailsRes.data.items || []).forEach(v => {
      durationMap[v.id] = parseISO8601Duration(v.contentDetails.duration);
    });

    return items.map(item => ({
      source:     'youtube',
      youtube_id: item.id.videoId,
      title:      item.snippet.title,
      artist:     item.snippet.channelTitle,
      image_url:  item.snippet.thumbnails?.medium?.url
        || item.snippet.thumbnails?.default?.url
        || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
      duration:   durationMap[item.id.videoId] || '0:00'
    }));
  } catch (ytError) {
    if (ytError.response?.status === 403) throw { quotaExceeded: true };
    console.warn('[YouTube] Search error:', ytError.message);
    return [];
  }
};

// ── Save to DB in background (never blocks response) ─────────────────
const saveToDbBackground = (songs, keyField) => {
  Promise.all(
    songs.map(song =>
      Song.findOneAndUpdate(
        { [keyField]: song[keyField] },
        { $set: song },
        { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
      ).catch(err => console.warn(`[DB upsert] ${err.message}`))
    )
  ).then(saved => {
    const count = saved.filter(Boolean).length;
    console.log(`[DB cache] saved ${count}/${songs.length} songs`);
  }).catch(() => {});
};

// ── Filter instrumentals/covers when originals exist ─────────────────
const filterBadResults = (songs) => {
  const clean = songs.filter(s => {
    const t = s.title.toLowerCase();
    const l = (s.language || '').toLowerCase();
    return l !== 'instrumental'
      && !t.includes('karaoke')
      && !t.includes('ringtone')
      && !t.includes('bgm')
      && !t.includes(' cover)');
  });
  return clean.length > 0 ? clean : songs; // never return empty if originals didn't exist
};

// ── Detect if top result looks like a sequel/wrong version ───────────
const looksWrong = (topResult, query) => {
  if (!topResult) return false;
  const t = topResult.title.toLowerCase();
  const plays = topResult.play_count || 0;
  return (
    /\bii\b/.test(t) ||
    t.includes('part 2') ||
    t.includes('awarapan 2') ||
    (plays < 200_000 && query.split(' ').length <= 4) // short query + low plays = likely wrong
  );
};

// ────────────────────────────────────────────────────────────────────────
// DEBUG endpoint — test any JioSaavn instance directly
// https://your-render-url.onrender.com/api/search/debug-jiosaavn?q=toh phir aao
// ────────────────────────────────────────────────────────────────────────
router.get('/debug-jiosaavn', async (req, res) => {
  const query = req.query.q || 'toh phir aao';
  const results = {};

  for (const base of JIOSAAVN_INSTANCES) {
    try {
      const raw = await callJioSaavnInstance(base, query, 5);
      results[base] = {
        ok: true,
        count: raw.length,
        top: raw[0] ? { name: raw[0].name, artist: raw[0].artists?.primary?.[0]?.name, year: raw[0].year, plays: raw[0].playCount } : null
      };
    } catch (err) {
      results[base] = { ok: false, error: err.message };
    }
  }

  res.json({ query, instances: results });
});

// ────────────────────────────────────────────────────────────────────────
// MAIN SEARCH
// Flow: DB cache → JioSaavn (multi-instance, scored) → retry refined → YouTube
// ────────────────────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  const query = req.query.q?.trim();
  if (!query) return res.json([]);

  try {
    // ── Track search history for logged-in users ──────────────────
    if (req.user && query.length > 1) {
      User.findByIdAndUpdate(req.user._id, {
        $push: { searchHistory: { $each: [{ query: query.toLowerCase() }], $slice: -50 } }
      }).catch(() => {});
    }

    // ── Step 1: DB cache ──────────────────────────────────────────
    const localSongs = await Song.find({
      $or: [
        { title:  { $regex: query, $options: 'i' } },
        { artist: { $regex: query, $options: 'i' } }
      ]
    }).limit(20);

    if (localSongs.length > 0) {
      console.log(`[Cache] hit for "${query}" — ${localSongs.length} songs`);
      return res.json(localSongs);
    }

    // ── Step 2: JioSaavn ─────────────────────────────────────────
    let jiosaavnResults = await searchJioSaavn(query);

    if (jiosaavnResults.length > 0) {
      // If top result looks like a sequel/wrong version, retry with refined query
      if (looksWrong(jiosaavnResults[0], query)) {
        console.log(`[JioSaavn] Top result looks wrong ("${jiosaavnResults[0].title}"), retrying with refined query`);
        const refined = await searchJioSaavn(`${query} original song`);
        if (refined.length > 0 && (refined[0].play_count || 0) > (jiosaavnResults[0].play_count || 0)) {
          console.log(`[JioSaavn] Refined query gave better result: "${refined[0].title}" (${refined[0].play_count} plays)`);
          // Merge: put refined results first, deduplicate
          const seenIds = new Set(refined.map(s => s.jiosaavn_id));
          jiosaavnResults = [
            ...refined,
            ...jiosaavnResults.filter(s => !seenIds.has(s.jiosaavn_id))
          ];
        }
      }

      const finalResults = filterBadResults(jiosaavnResults);
      console.log(`[JioSaavn] Returning ${finalResults.length} songs for "${query}" (top: "${finalResults[0]?.title}")`);

      res.json(finalResults);
      saveToDbBackground(finalResults, 'jiosaavn_id');
      return;
    }

    // ── Step 3: YouTube fallback ──────────────────────────────────
    console.log(`[YouTube] JioSaavn empty for "${query}", trying YouTube`);
    try {
      const youtubeResults = await searchYouTube(query);
      if (youtubeResults.length === 0) return res.json([]);

      console.log(`[YouTube] ${youtubeResults.length} results for "${query}"`);
      res.json(youtubeResults);
      saveToDbBackground(youtubeResults, 'youtube_id');
      return;
    } catch (ytErr) {
      if (ytErr.quotaExceeded) {
        return res.status(429).json({ message: 'Search quota exceeded. Please try again tomorrow.' });
      }
      return res.json([]);
    }

  } catch (error) {
    console.error('[Search] Error:', error.message);
    res.status(500).json({ message: 'Search failed', detail: error.message });
  }
});

// ── Resolve YouTube video ID for a JioSaavn song (lazy, on video-click) ──
router.get('/youtube-id/:songId', optionalAuth, async (req, res) => {
  try {
    const song = await Song.findById(req.params.songId);
    if (!song) return res.status(404).json({ message: 'Song not found' });

    if (song.resolved_youtube_id) return res.json({ youtube_id: song.resolved_youtube_id });
    if (song.source === 'youtube' && song.youtube_id) return res.json({ youtube_id: song.youtube_id });

    const apiKey    = getApiKey();
    const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      timeout: 8000,
      params: { key: apiKey, part: 'snippet', q: `${song.title} ${song.artist} official`, type: 'video', videoCategoryId: '10', maxResults: 1 }
    });

    const items = searchRes.data.items || [];
    if (items.length === 0) return res.status(404).json({ message: 'No matching video found' });

    const youtubeId = items[0].id.videoId;
    song.resolved_youtube_id = youtubeId;
    await song.save();

    return res.json({ youtube_id: youtubeId });
  } catch (error) {
    if (error.response?.status === 403) return res.status(429).json({ message: 'YouTube quota exceeded.' });
    console.error('[YouTube ID] Error:', error.message);
    res.status(500).json({ message: 'Could not resolve video' });
  }
});

// ── Suggestions ───────────────────────────────────────────────────────
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

    const fullUser       = await User.findById(req.user._id).populate('recentlyPlayed');
    const recentlyPlayed = fullUser.recentlyPlayed || [];
    const searchHistory  = (fullUser.searchHistory || []).slice(-50);
    const playedArtists  = [...new Set(recentlyPlayed.map(s => s.artist).filter(Boolean))];
    const searchKeywords = [...new Set(searchHistory.map(s => s.query).filter(Boolean))].slice(-15);
    const excludeIds     = [...recentlyPlayed.map(s => s._id.toString()), ...excludeParam];

    if (playedArtists.length === 0 && searchKeywords.length === 0) {
      const songs = await Song.aggregate([
        { $match: excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {} },
        { $sample: { size: 12 } }
      ]);
      return res.json({ type: 'random', songs });
    }

    const escape       = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    console.error('[Suggestions] Error:', error.message);
    res.status(500).json({ message: 'Could not fetch suggestions' });
  }
});

// ── Smart playlist ─────────────────────────────────────────────────────
router.get('/smart-playlist', optionalAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Login required' });

    const fullUser       = await User.findById(req.user._id).populate('recentlyPlayed');
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

    const allSongs   = combined.sort(() => Math.random() - 0.5);
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
    console.error('[Smart playlist] Error:', error.message);
    res.status(500).json({ message: 'Could not generate playlist' });
  }
});

module.exports = router;



// 23july


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

// // ── DNS fix for some hosting providers (e.g. Render) that fail to
// // resolve certain TLDs like .dev through their default resolver ────────
// const dns = require('dns');
// try {
//   dns.setDefaultResultOrder('ipv4first');
//   dns.setServers(['8.8.8.8', '1.1.1.1']); // Google + Cloudflare public DNS
// } catch (e) {
//   console.warn('Could not set custom DNS servers:', e.message);
// }

// // ── Score a JioSaavn result for relevance ─────────────────────────────
// const scoreJioSaavnResult = (item, query) => {
//   const q       = query.toLowerCase().trim();
//   const title   = (item.name || '').toLowerCase();
//   const lang    = (item.language || '').toLowerCase();
//   const label   = (item.label || '').toLowerCase();
//   const allArtists = [
//     ...(item.artists?.primary || []),
//     ...(item.artists?.all     || [])
//   ].map(a => a.name.toLowerCase()).join(' ');

//   let score = 0;

//   // ── Title match ──────────────────────────────────────────────────
//   if (title === q)                        score += 100;
//   else if (title.startsWith(q))           score += 70;
//   else if (title.includes(q))             score += 40;

//   // ── Hard penalize: covers / instrumentals / karaoke ─────────────
//   if (lang === 'instrumental')            score -= 80;
//   if (item.hasLyrics === false)           score -= 40;
//   if (title.includes('cover'))            score -= 50;
//   if (title.includes('karaoke'))          score -= 80;
//   if (title.includes('tribute'))          score -= 50;
//   if (title.includes('ringtone'))         score -= 80;
//   if (title.includes('bgm'))             score -= 60;
//   if (title.includes('lofi'))            score -= 20;
//   if (title.includes('remix'))           score -= 15;

//   // ── Boost: Hindi / high playcount = original popular release ────
//   if (lang === 'hindi')                   score += 15;
//   if (lang === 'punjabi')                 score += 10;
//   const plays = item.playCount || 0;
//   if (plays > 100_000)                    score += 10;
//   if (plays > 1_000_000)                  score += 20;
//   if (plays > 10_000_000)                 score += 30;
//   if (plays > 100_000_000)               score += 20; // mega-hit bonus

//   // ── Boost: major Bollywood / Indian labels ───────────────────────
//   const MAJOR_LABELS = [
//     't-series', 'sony music', 'zee music', 'saregama',
//     'tips music', 'eros', 'yrf', 'dharma', 'speed records',
//     'lahari music', 'aditya music', 'venus'
//   ];
//   if (MAJOR_LABELS.some(l => label.includes(l)))  score += 25;

//   // ── Boost: has lyrics (real song, not instrumental) ──────────────
//   if (item.hasLyrics === true)            score += 20;

//   return score;
// };

// // ── Search JioSaavn — returns scored, filtered, normalized songs ──────
// const searchJioSaavn = async (query) => {
//   try {
//     console.log(`[JioSaavn] Searching: "${query}"`);
//     const res = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 6000,
//       params: { query, limit: 30 }  // fetch 30 so scoring has enough to work with
//     });

//     const results = res.data?.data?.results || [];
//     console.log(`[JioSaavn] Raw results: ${results.length}`);
//     if (results.length === 0) return [];

//     // Score + sort
//     const scored = results
//       .map(item => ({ item, score: scoreJioSaavnResult(item, query) }))
//       .sort((a, b) => b.score - a.score);

//     console.log(`[JioSaavn] Top scores: ${scored.slice(0,3).map(s => `"${s.item.name}" (${s.score})`).join(' | ')}`);

//     return scored
//       .map(({ item }) => {
//         const downloadUrls = item.downloadUrl || [];
//         const bestStream   = downloadUrls[downloadUrls.length - 1]?.url
//           || downloadUrls[0]?.url
//           || null;

//         const images    = item.image || [];
//         const bestImage = images[images.length - 1]?.url
//           || images[0]?.url
//           || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop';

//         const artistNames = item.artists?.primary?.map(a => a.name).join(', ')
//           || item.artists?.all?.map(a => a.name).join(', ')
//           || 'Unknown Artist';

//         return {
//           source:      'jiosaavn',
//           jiosaavn_id: item.id,
//           title:       item.name,
//           artist:      artistNames,
//           image_url:   bestImage,
//           duration:    formatSeconds(item.duration),
//           stream_url:  bestStream,
//           language:    item.language || '',
//           play_count:  item.playCount || 0
//         };
//       })
//       .filter(s => s.stream_url);

//   } catch (err) {
//     console.error('[JioSaavn] FAILED:', err.message);
//     console.error('[JioSaavn] Code:', err.code, '| Status:', err.response?.status);
//     return [];
//   }
// };

// // ── Debug endpoint — test JioSaavn connectivity directly ───────────────
// // Visit: https://your-render-url.onrender.com/api/search/debug-jiosaavn?q=black swan
// router.get('/debug-jiosaavn', async (req, res) => {
//   const query = req.query.q || 'black swan';
//   try {
//     const apiRes = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 8000,
//       params: { query, limit: 5 }
//     });
//     res.json({
//       success: true,
//       apiBase: JIOSAAVN_API_BASE,
//       query,
//       status: apiRes.status,
//       resultCount: apiRes.data?.data?.results?.length || 0,
//       sampleResult: apiRes.data?.data?.results?.[0] || null,
//       rawDataKeys: Object.keys(apiRes.data || {})
//     });
//   } catch (err) {
//     res.json({
//       success: false,
//       apiBase: JIOSAAVN_API_BASE,
//       query,
//       error: err.message,
//       code: err.code,
//       responseStatus: err.response?.status,
//       responseData: err.response?.data || null
//     });
//   }
// });

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
//       // ── Strip instrumentals/covers if real songs exist ─────────────
//       const realSongs = jiosaavnResults.filter(s => {
//         const t = s.title.toLowerCase();
//         const l = (s.language || '').toLowerCase();
//         return l !== 'instrumental'
//           && !t.includes('karaoke')
//           && !t.includes('ringtone')
//           && !t.includes('bgm')
//           && !t.includes('cover');
//       });
//       const finalResults = realSongs.length > 0 ? realSongs : jiosaavnResults;

//       // ✅ Return immediately — don't block on DB save
//       console.log(`JioSaavn hit for "${query}" — ${finalResults.length} songs (${jiosaavnResults.length - finalResults.length} filtered)`);
//       res.json(finalResults);

//       // 🔥 Save to DB in background (fire-and-forget, never blocks response)
//       Promise.all(
//         finalResults.map(song =>
//           Song.findOneAndUpdate(
//             { jiosaavn_id: song.jiosaavn_id },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           ).catch(err => console.warn(`[DB upsert] skipped: ${err.message}`))
//         )
//       ).then(saved => {
//         const count = saved.filter(Boolean).length;
//         console.log(`[DB cache] saved ${count}/${finalResults.length} JioSaavn songs for "${query}"`);
//       }).catch(() => {});

//       return; // response already sent
//     }

//     // ── Step 2: Fallback to YouTube — same logic as before, untouched ──
//     try {
//       const youtubeResults = await searchYouTube(query);
//       if (youtubeResults.length === 0) return res.json([]);

//       // ✅ Return YouTube results immediately too
//       console.log(`YouTube fallback for "${query}" — ${youtubeResults.length} songs (returning immediately)`);
//       res.json(youtubeResults);

//       // 🔥 Save to DB in background
//       Promise.all(
//         youtubeResults.map(song =>
//           Song.findOneAndUpdate(
//             { youtube_id: song.youtube_id },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           ).catch(err => console.warn(`[DB upsert YT] skipped: ${err.message}`))
//         )
//       ).then(saved => {
//         const count = saved.filter(Boolean).length;
//         console.log(`[DB cache] saved ${count}/${youtubeResults.length} YouTube songs for "${query}"`);
//       }).catch(() => {});

//       return;
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




// // jiosavan 






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





// filter songs






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

// // ── DNS fix for some hosting providers (e.g. Render) that fail to
// // resolve certain TLDs like .dev through their default resolver ────────
// const dns = require('dns');
// try {
//   dns.setDefaultResultOrder('ipv4first');
//   dns.setServers(['8.8.8.8', '1.1.1.1']); // Google + Cloudflare public DNS
// } catch (e) {
//   console.warn('Could not set custom DNS servers:', e.message);
// }

// // ── Search JioSaavn — returns normalized song objects or [] on failure ──
// const searchJioSaavn = async (query) => {
//   try {
//     console.log(`[JioSaavn] Searching for: "${query}" via ${JIOSAAVN_API_BASE}/search/songs`);
//     const res = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 6000,
//       params: { query, limit: 15 }
//     });

//     console.log(`[JioSaavn] Response status: ${res.status}, success: ${res.data?.success}`);
//     const results = res.data?.data?.results || [];
//     console.log(`[JioSaavn] Found ${results.length} results`);
//     if (results.length === 0) {
//       console.log('[JioSaavn] Raw response data:', JSON.stringify(res.data).slice(0, 500));
//       return [];
//     }

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
//     console.error('[JioSaavn] FAILED:', err.message);
//     console.error('[JioSaavn] Error code:', err.code);
//     console.error('[JioSaavn] Response status:', err.response?.status);
//     console.error('[JioSaavn] Response data:', JSON.stringify(err.response?.data || {}).slice(0, 300));
//     return [];
//   }
// };

// // ── Debug endpoint — test JioSaavn connectivity directly ───────────────
// // Visit: https://your-render-url.onrender.com/api/search/debug-jiosaavn?q=black swan
// router.get('/debug-jiosaavn', async (req, res) => {
//   const query = req.query.q || 'black swan';
//   try {
//     const apiRes = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 8000,
//       params: { query, limit: 5 }
//     });
//     res.json({
//       success: true,
//       apiBase: JIOSAAVN_API_BASE,
//       query,
//       status: apiRes.status,
//       resultCount: apiRes.data?.data?.results?.length || 0,
//       sampleResult: apiRes.data?.data?.results?.[0] || null,
//       rawDataKeys: Object.keys(apiRes.data || {})
//     });
//   } catch (err) {
//     res.json({
//       success: false,
//       apiBase: JIOSAAVN_API_BASE,
//       query,
//       error: err.message,
//       code: err.code,
//       responseStatus: err.response?.status,
//       responseData: err.response?.data || null
//     });
//   }
// });

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
//       // ✅ Return raw results immediately — don't block on DB save
//       console.log(`JioSaavn hit for "${query}" — ${jiosaavnResults.length} songs (returning immediately)`);
//       res.json(jiosaavnResults);

//       // 🔥 Save to DB in background (fire-and-forget, never blocks response)
//       Promise.all(
//         jiosaavnResults.map(song =>
//           Song.findOneAndUpdate(
//             { jiosaavn_id: song.jiosaavn_id },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           ).catch(err => console.warn(`[DB upsert] skipped: ${err.message}`))
//         )
//       ).then(saved => {
//         const count = saved.filter(Boolean).length;
//         console.log(`[DB cache] saved ${count}/${jiosaavnResults.length} JioSaavn songs for "${query}"`);
//       }).catch(() => {});

//       return; // response already sent
//     }

//     // ── Step 2: Fallback to YouTube — same logic as before, untouched ──
//     try {
//       const youtubeResults = await searchYouTube(query);
//       if (youtubeResults.length === 0) return res.json([]);

//       // ✅ Return YouTube results immediately too
//       console.log(`YouTube fallback for "${query}" — ${youtubeResults.length} songs (returning immediately)`);
//       res.json(youtubeResults);

//       // 🔥 Save to DB in background
//       Promise.all(
//         youtubeResults.map(song =>
//           Song.findOneAndUpdate(
//             { youtube_id: song.youtube_id },
//             { $set: song },
//             { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
//           ).catch(err => console.warn(`[DB upsert YT] skipped: ${err.message}`))
//         )
//       ).then(saved => {
//         const count = saved.filter(Boolean).length;
//         console.log(`[DB cache] saved ${count}/${youtubeResults.length} YouTube songs for "${query}"`);
//       }).catch(() => {});

//       return;
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




// // jiosavan 






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



// 2233cloude


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

// // ── DNS fix for some hosting providers (e.g. Render) that fail to
// // resolve certain TLDs like .dev through their default resolver ────────
// const dns = require('dns');
// try {
//   dns.setDefaultResultOrder('ipv4first');
//   dns.setServers(['8.8.8.8', '1.1.1.1']); // Google + Cloudflare public DNS
// } catch (e) {
//   console.warn('Could not set custom DNS servers:', e.message);
// }

// // ── Search JioSaavn — returns normalized song objects or [] on failure ──
// const searchJioSaavn = async (query) => {
//   try {
//     console.log(`[JioSaavn] Searching for: "${query}" via ${JIOSAAVN_API_BASE}/search/songs`);
//     const res = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 6000,
//       params: { query, limit: 15 }
//     });

//     console.log(`[JioSaavn] Response status: ${res.status}, success: ${res.data?.success}`);
//     const results = res.data?.data?.results || [];
//     console.log(`[JioSaavn] Found ${results.length} results`);
//     if (results.length === 0) {
//       console.log('[JioSaavn] Raw response data:', JSON.stringify(res.data).slice(0, 500));
//       return [];
//     }

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
//     console.error('[JioSaavn] FAILED:', err.message);
//     console.error('[JioSaavn] Error code:', err.code);
//     console.error('[JioSaavn] Response status:', err.response?.status);
//     console.error('[JioSaavn] Response data:', JSON.stringify(err.response?.data || {}).slice(0, 300));
//     return [];
//   }
// };

// // ── Debug endpoint — test JioSaavn connectivity directly ───────────────
// // Visit: https://your-render-url.onrender.com/api/search/debug-jiosaavn?q=black swan
// router.get('/debug-jiosaavn', async (req, res) => {
//   const query = req.query.q || 'black swan';
//   try {
//     const apiRes = await axios.get(`${JIOSAAVN_API_BASE}/search/songs`, {
//       timeout: 8000,
//       params: { query, limit: 5 }
//     });
//     res.json({
//       success: true,
//       apiBase: JIOSAAVN_API_BASE,
//       query,
//       status: apiRes.status,
//       resultCount: apiRes.data?.data?.results?.length || 0,
//       sampleResult: apiRes.data?.data?.results?.[0] || null,
//       rawDataKeys: Object.keys(apiRes.data || {})
//     });
//   } catch (err) {
//     res.json({
//       success: false,
//       apiBase: JIOSAAVN_API_BASE,
//       query,
//       error: err.message,
//       code: err.code,
//       responseStatus: err.response?.status,
//       responseData: err.response?.data || null
//     });
//   }
// });

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




// // jiosavan 






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
