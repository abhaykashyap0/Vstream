const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const Playlist = require('../models/Playlist');
const User = require('../models/User');
const Song = require('../models/Song');

// Get all user playlists
router.get('/my-library', protect, async (req, res) => {
  try {
    const playlists = await Playlist.find({ owner: req.user._id }).populate('songs');
    res.json(playlists);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add song to playlist (create playlist if it doesn't exist)
router.post('/add', protect, async (req, res) => {
  const { songId, playlistTitle } = req.body;
  try {
    let playlist = await Playlist.findOne({
      owner: req.user._id,
      title: playlistTitle || 'My Favorites'
    });

    if (!playlist) {
      playlist = await Playlist.create({
        title: playlistTitle || 'My Favorites',
        owner: req.user._id,
        songs: [songId]
      });
      await User.findByIdAndUpdate(req.user._id, { $push: { playlists: playlist._id } });
    } else {
      if (!playlist.songs.includes(songId)) {
        playlist.songs.push(songId);
        await playlist.save();
      }
    }

    const populatedPlaylist = await Playlist.findById(playlist._id).populate('songs');
    res.status(200).json(populatedPlaylist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Create a new named playlist
router.post('/create', protect, async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: 'Playlist title is required' });
  try {
    const existing = await Playlist.findOne({ owner: req.user._id, title: title.trim() });
    if (existing) return res.status(400).json({ message: 'Playlist with this name already exists' });

    const playlist = await Playlist.create({
      title: title.trim(),
      owner: req.user._id,
      songs: []
    });
    await User.findByIdAndUpdate(req.user._id, { $push: { playlists: playlist._id } });
    res.status(201).json(playlist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Remove a song from a playlist
router.delete('/remove-song', protect, async (req, res) => {
  const { playlistId, songId } = req.body;
  try {
    const playlist = await Playlist.findOne({ _id: playlistId, owner: req.user._id });
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    playlist.songs = playlist.songs.filter(s => s.toString() !== songId);
    await playlist.save();

    const populated = await Playlist.findById(playlist._id).populate('songs');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Delete an entire playlist
router.delete('/delete/:id', protect, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, owner: req.user._id });
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    await Playlist.findByIdAndDelete(req.params.id);
    await User.findByIdAndUpdate(req.user._id, { $pull: { playlists: req.params.id } });
    res.json({ message: 'Playlist deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Get recently played (last 20 unique songs across all playlists)
router.get('/recently-played', protect, async (req, res) => {
  try {
    const recentIds = req.user.recentlyPlayed || [];
    const songs = await Song.find({ _id: { $in: recentIds } });
    // Preserve order of recentIds
    const ordered = recentIds
      .map(id => songs.find(s => s._id.toString() === id.toString()))
      .filter(Boolean);
    res.json(ordered);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Track recently played song
router.post('/recently-played', protect, async (req, res) => {
  const { songId } = req.body;
  try {
    const user = await User.findById(req.user._id);
    let recent = user.recentlyPlayed || [];
    // Remove if already exists, then add to front
    recent = [songId, ...recent.filter(id => id.toString() !== songId)].slice(0, 20);
    user.recentlyPlayed = recent;
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;



//for remove song from play list and multipke playlist 
// playlistroutes,userjs,musiccontext,librarypage ,song list are upodated 




// const express = require('express');
// const router = express.Router();
// const { protect } = require('../middleware/authMiddleware');
// const Playlist = require('../models/Playlist');
// const User = require('../models/User');

// // Get all user playlists
// router.get('/my-library', protect, async (req, res) => {
//   try {
//     const playlists = await Playlist.find({ owner: req.user._id }).populate('songs');
//     res.json(playlists);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// // Add song to playlist (create playlist if it doesn't exist)
// router.post('/add', protect, async (req, res) => {
//   const { songId, playlistTitle } = req.body;
//   try {
//     let playlist = await Playlist.findOne({ owner: req.user._id, title: playlistTitle || 'My Favorites' });

//     if (!playlist) {
//       playlist = await Playlist.create({
//         title: playlistTitle || 'My Favorites',
//         owner: req.user._id,
//         songs: [songId]
//       });
//       await User.findByIdAndUpdate(req.user._id, { $push: { playlists: playlist._id } });
//     } else {
//       if (!playlist.songs.includes(songId)) {
//         playlist.songs.push(songId);
//         await playlist.save();
//       }
//     }

//     const populatedPlaylist = await Playlist.findById(playlist._id).populate('songs');
//     res.status(200).json(populatedPlaylist);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// module.exports = router;
