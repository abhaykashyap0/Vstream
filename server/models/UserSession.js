const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username:  { type: String },
  email:     { type: String },
  loginAt:   { type: Date, default: Date.now },
  logoutAt:  { type: Date },
  durationMs:{ type: Number }, // filled on logout
  ipAddress: { type: String },
  userAgent: { type: String },
  songsPlayed: [{
    songId:    { type: String },
    title:     { type: String },
    artist:    { type: String },
    playedAt:  { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('UserSession', sessionSchema);