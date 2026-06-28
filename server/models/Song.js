const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
  // ── Source identification ──────────────────────────────────────────
  source: {
    type: String,
    enum: ['jiosaavn', 'youtube'],
    default: 'youtube',
    index: true
  },

  // ── YouTube fields (used when source = 'youtube', or for video playback) ──
  youtube_id: {
    type: String,
    unique: true,
    sparse: true, // allows multiple docs without youtube_id (JioSaavn-only songs)
    index: true
  },

  // ── JioSaavn fields (used when source = 'jiosaavn') ──────────────────
  jiosaavn_id: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  stream_url: {
    type: String, // direct JioSaavn audio CDN URL
  },

  // ── Common fields ─────────────────────────────────────────────────
  title: {
    type: String,
    required: true,
    index: true
  },
  artist: {
    type: String,
    required: true
  },
  image_url: {
    type: String,
    default: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop'
  },
  duration: {
    type: String,
    default: '0:00'
  },

  // ── Lazy-resolved YouTube ID for JioSaavn songs (video button) ──────
  // Populated only when user taps "Video" on a JioSaavn-sourced song
  resolved_youtube_id: {
    type: String,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('Song', songSchema);





////song.js searcchroute, playerbar



// const mongoose = require('mongoose');

// const songSchema = new mongoose.Schema({
//   youtube_id: {
//     type: String,
//     unique: true,
//     required: true,
//     index: true
//   },
//   title: {
//     type: String,
//     required: true,
//     index: true
//   },
//   artist: {
//     type: String,
//     required: true
//   },
//   image_url: {
//     type: String,
//     default: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop'
//   },
//   duration: {
//     type: String,
//     default: '0:00'
//   }
// }, { timestamps: true });

// module.exports = mongoose.model('Song', songSchema);

