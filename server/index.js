import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import youtubeDl from 'youtube-dl-exec'; // ── Native Audio Extractor Engine ──

// ── 1. IMPORT YOUR ROUTE MODULES ─────────────────────────────────────
import authRoutes from './routes/authRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';

dotenv.config();
const app = express();

// ── 2. GLOBAL MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── 3. DATABASE CONFIGURATION ─────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/vstream')
  .then(() => console.log('MongoDB cluster connected successfully'))
  .catch((err) => console.error('Database connection critical failure:', err));

// ── 4. PRODUCTION API ROUTE MOUNTS ────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/search', searchRoutes); // 👈 Fixed the 404 error by mounting this cleanly
app.use('/api/playlists', playlistRoutes);

// ── 5. NATIVE MOBILE AUDIO BACKGROUND STREAM BRIDGE ──────────────────────
app.get('/api/songs/stream/:youtubeId', async (req, res) => {
  const { youtubeId } = req.params;

  if (!youtubeId) {
    return res.status(400).json({ error: 'YouTube Video ID parameter is required' });
  }

  try {
    // Queries yt-dlp to extract the raw, optimized background audio track stream URL from YouTube
    const output = await youtubeDl(`https://www.youtube.com/watch?v=${youtubeId}`, {
      getUrl: true,
      format: 'bestaudio[ext=m4a]/bestaudio', // Targets high-efficiency, compressed mobile audio layers
    });

    const directAudioStreamUrl = output.trim();

    // 🚀 THE UX FIX: Perform an HTTP 302 redirect directly into the raw audio binary stream.
    // This tricks mobile OS kernels (iOS & Android) into thinking it's a native audio player,
    // keeping background progression awake on mobile browsers WITHOUT forcing "Request Desktop Site".
    res.redirect(directAudioStreamUrl);
  } catch (error) {
    console.error('Mobile background audio stream bridge failure:', error);
    res.status(500).json({ error: 'Could not resolve backend background streaming media channel' });
  }
});

// ── 6. APPLICATION SYSTEM HEALTH CHECK ────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({ status: 'active', message: 'VSTREAM production API engine running' });
});

// ── 7. SERVER PORT BINDING AND INITIALIZATION ────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`VSTREAM Server cluster initializing securely on port ${PORT}`);
});




// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');
// const profileRoutes  = require('./routes/profileRoutes');
// const adminRoutes    = require('./routes/adminRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const axios = require('axios');
//     await axios.post('https://api.brevo.com/v3/smtp/email', {
//       sender: { name: 'VStream', email: process.env.EMAIL_USER },
//       to: [{ email: process.env.EMAIL_USER }],
//       subject: 'VStream Email Test',
//       htmlContent: '<h1>Email working ✅</h1>'
//     }, {
//       headers: {
//         'api-key': process.env.BREVO_API_KEY,
//         'Content-Type': 'application/json'
//       }
//     });
//     res.json({
//       status: 'Brevo HTTP API connected ✅',
//       user: process.env.EMAIL_USER,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.response?.data?.message || err.message,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);
// app.use('/api/profile',   profileRoutes);
// app.use('/api/admin',     adminRoutes);   // ← NEW

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });



//admin
// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');
// const profileRoutes  = require('./routes/profileRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const axios = require('axios');
//     // Test Brevo HTTP API by sending a real test email
//     await axios.post('https://api.brevo.com/v3/smtp/email', {
//       sender: { name: 'VStream', email: process.env.EMAIL_USER },
//       to: [{ email: process.env.EMAIL_USER }],
//       subject: 'VStream Email Test',
//       htmlContent: '<h1>Email working ✅</h1>'
//     }, {
//       headers: {
//         'api-key': process.env.BREVO_API_KEY,
//         'Content-Type': 'application/json'
//       }
//     });
//     res.json({
//       status: 'Brevo HTTP API connected ✅',
//       user: process.env.EMAIL_USER,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.response?.data?.message || err.message,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);
// app.use('/api/profile',   profileRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });




// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const axios = require('axios');
//     // Test Brevo HTTP API by sending a real test email
//     await axios.post('https://api.brevo.com/v3/smtp/email', {
//       sender: { name: 'VStream', email: process.env.EMAIL_USER },
//       to: [{ email: process.env.EMAIL_USER }],
//       subject: 'VStream Email Test',
//       htmlContent: '<h1>Email working ✅</h1>'
//     }, {
//       headers: {
//         'api-key': process.env.BREVO_API_KEY,
//         'Content-Type': 'application/json'
//       }
//     });
//     res.json({
//       status: 'Brevo HTTP API connected ✅',
//       user: process.env.EMAIL_USER,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.response?.data?.message || err.message,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });


//httpapi


// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const nodemailer = require('nodemailer');
//     const transporter = nodemailer.createTransport({
//       host: 'smtp-relay.brevo.com',
//       port: 587,
//       secure: false,
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.BREVO_SMTP_KEY
//       }
//     });
//     await transporter.verify();
//     res.json({
//       status: 'Brevo connected ✅',
//       user: process.env.EMAIL_USER,
//       passLength: process.env.BREVO_SMTP_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.message,
//       user: process.env.EMAIL_USER,
//       passLength: process.env.BREVO_SMTP_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });


// const dotenv = require('dotenv');
// dotenv.config(); // ✅ Must be FIRST

// const express = require('express');
// const cors    = require('cors');
// const connectDB = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// // Routes
// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();

// app.use(cors({ origin: '*' }));
// app.use(express.json());

// // Health check endpoint
// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// // ✅ Email test endpoint — visit this URL to test Gmail
// app.get('/test-email', async (req, res) => {
//   try {
//     const nodemailer = require('nodemailer');
//     const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS
//       }
//     });
//     await transporter.verify();
//     res.json({ 
//       status: 'Gmail connected ✅',
//       user: process.env.EMAIL_USER,
//       passLength: process.env.EMAIL_PASS?.length
//     });
//   } catch (err) {
//     res.json({ 
//       status: 'Gmail FAILED ❌',
//       error: err.message,
//       user: process.env.EMAIL_USER,
//       passLength: process.env.EMAIL_PASS?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive(); // ✅ Start keep-alive pings (only active on Render)
// });


 //email testing



// const dotenv = require('dotenv');
// dotenv.config(); // ✅ Must be FIRST

// const express = require('express');
// const cors    = require('cors');
// const connectDB = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// // Routes
// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();

// app.use(cors({ origin: '*' }));
// app.use(express.json());

// // Health check endpoint — used by keepAlive ping
// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive(); // ✅ Start keep-alive pings (only active on Render)
// });

// to keep server alive 



// const dotenv = require('dotenv');
// dotenv.config(); // ✅ Must be FIRST before any other require that uses process.env

// const express = require('express');
// const cors = require('cors');
// const connectDB = require('./config/db');

// // Routes
// const authRoutes = require('./routes/authRoutes');
// const searchRoutes = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();

// app.use(cors());
// // app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.use('/api/auth', authRoutes);
// app.use('/api/search', searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
//cluade 8
// const express = require('express');
// const dotenv = require('dotenv');
// const cors = require('cors');
// const connectDB = require('./config/db');

// // Routes
// const authRoutes = require('./routes/authRoutes');
// const searchRoutes = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// dotenv.config();
// connectDB();

// const app = express();

// app.use(cors());
// app.use(express.json());

// app.use('/api/auth', authRoutes);
// app.use('/api/search', searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
