const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
  youtube_id: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
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
  }
}, { timestamps: true });

module.exports = mongoose.model('Song', songSchema);

