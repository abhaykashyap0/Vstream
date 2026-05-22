const dotenv = require('dotenv');
dotenv.config(); // ✅ Must be FIRST

const express = require('express');
const cors    = require('cors');
const connectDB = require('./config/db');
const { startKeepAlive } = require('./keepAlive');

// Routes
const authRoutes     = require('./routes/authRoutes');
const searchRoutes   = require('./routes/searchRoutes');
const playlistRoutes = require('./routes/playlistRoutes');

connectDB();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// ✅ Email test endpoint — visit this URL to test Gmail
app.get('/test-email', async (req, res) => {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    await transporter.verify();
    res.json({ 
      status: 'Gmail connected ✅',
      user: process.env.EMAIL_USER,
      passLength: process.env.EMAIL_PASS?.length
    });
  } catch (err) {
    res.json({ 
      status: 'Gmail FAILED ❌',
      error: err.message,
      user: process.env.EMAIL_USER,
      passLength: process.env.EMAIL_PASS?.length
    });
  }
});

app.use('/api/auth',      authRoutes);
app.use('/api/search',    searchRoutes);
app.use('/api/playlists', playlistRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`VStream server running on port ${PORT}`);
  startKeepAlive(); // ✅ Start keep-alive pings (only active on Render)
});


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
