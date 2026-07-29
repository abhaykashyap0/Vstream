const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
  // ── Source identification ─────────────────────────────────────────
  source: {
    type: String,
    enum: ['jiosaavn', 'youtube'],
    default: 'youtube',
    index: true
  },

  // ── YouTube fields ────────────────────────────────────────────────
  youtube_id: {
    type:   String,
    unique: true,
    sparse: true,
    index:  true
  },

  // ── JioSaavn fields ───────────────────────────────────────────────
  jiosaavn_id: {
    type:   String,
    unique: true,
    sparse: true,
    index:  true
  },
  stream_url: {
    type: String // direct JioSaavn CDN URL
  },

  // ── Common fields ─────────────────────────────────────────────────
  title: {
    type:     String,
    required: true,
    index:    true
  },
  artist: {
    type:     String,
    required: true
  },
  image_url: {
    type:    String,
    default: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop'
  },
  duration: {
    type:    String,
    default: '0:00'
  },
  language: {
    type: String,
    default: ''
  },
  play_count: {
    type:    Number,
    default: 0
  },
  year: {
    type: String,
    default: null
  },

  // ── Lazy-resolved YouTube ID for JioSaavn songs ───────────────────
  // Set when user taps Video button on a JioSaavn song
  resolved_youtube_id: {
    type:    String,
    default: null
  },

  // ── yt-dlp resolved audio URL for YouTube songs ───────────────────
  // Cached so same video never hits yt-dlp twice
  // YouTube signed URLs expire ~6hrs, we cache for 5hrs
  resolved_audio_url: {
    type:    String,
    default: null
  },
  audio_url_expires_at: {
    type:    Number, // Unix timestamp ms
    default: null
  }

}, { timestamps: true });

module.exports = mongoose.model('Song', songSchema);



// const mongoose = require('mongoose');

// const songSchema = new mongoose.Schema({
//   // ── Source identification ──────────────────────────────────────────
//   source: {
//     type: String,
//     enum: ['jiosaavn', 'youtube'],
//     default: 'youtube',
//     index: true
//   },

//   // ── YouTube fields (used when source = 'youtube', or for video playback) ──
//   youtube_id: {
//     type: String,
//     unique: true,
//     sparse: true, // allows multiple docs without youtube_id (JioSaavn-only songs)
//     index: true
//   },

//   // ── JioSaavn fields (used when source = 'jiosaavn') ──────────────────
//   jiosaavn_id: {
//     type: String,
//     unique: true,
//     sparse: true,
//     index: true
//   },
//   stream_url: {
//     type: String, // direct JioSaavn audio CDN URL
//   },

//   // ── Common fields ─────────────────────────────────────────────────
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
//   },

//   // ── Lazy-resolved YouTube ID for JioSaavn songs (video button) ──────
//   // Populated only when user taps "Video" on a JioSaavn-sourced song
//   resolved_youtube_id: {
//     type: String,
//     default: null
//   }
// }, { timestamps: true });

// module.exports = mongoose.model('Song', songSchema);





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

