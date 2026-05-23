const express    = require('express');
const router     = express.Router();
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const admin      = require('firebase-admin');
const User       = require('../models/User');

// ── Token generator ────────────────────────────────────────────────
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ── OTP generator ──────────────────────────────────────────────────
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── In-memory OTP store ────────────────────────────────────────────
const otpStore = {};
const storeOTP = (key, otp, userData = {}) => {
  otpStore[key] = { otp, expiresAt: Date.now() + 10 * 60 * 1000, userData };
};
const verifyOTPFromStore = (key, otp) => {
  const record = otpStore[key];
  if (!record) return { valid: false, message: 'OTP not found. Please request again.' };
  if (Date.now() > record.expiresAt) { delete otpStore[key]; return { valid: false, message: 'OTP expired. Please request again.' }; }
  if (record.otp !== otp) return { valid: false, message: 'Invalid OTP.' };
  const userData = record.userData;
  delete otpStore[key];
  return { valid: true, userData };
};

// ── Firebase Admin init (lazy) ─────────────────────────────────────
let firebaseInitialized = false;
const initFirebase = () => {
  if (firebaseInitialized) return;
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:    process.env.FIREBASE_PROJECT_ID,
        clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
    firebaseInitialized = true;
  } catch (e) {
    console.error('Firebase admin init failed:', e.message);
  }
};

// ── Email transporter (Brevo SMTP — more reliable than Gmail) ──────
const sendEmailOTP = async (email, otp, purpose = 'verify') => {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,   // your gmail address
      pass: process.env.BREVO_SMTP_KEY // Brevo SMTP key
    }
  });
  await transporter.sendMail({
    from: `"VStream" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: purpose === 'login' ? 'Your VStream Login OTP' : 'Verify your VStream account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1e1e1e;padding:32px;border-radius:12px;">
        <h2 style="color:#1db954;">VStream 🎵</h2>
        <p style="color:#b3b3b3;">${purpose === 'login' ? 'Your login code:' : 'Your verification code:'}</p>
        <div style="background:#121212;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
          <span style="font-size:2.5rem;font-weight:900;letter-spacing:12px;color:#1db954;">${otp}</span>
        </div>
        <p style="color:#666;font-size:0.85rem;">Expires in <strong style="color:#b3b3b3;">10 minutes</strong>. Do not share.</p>
      </div>
    `
  });
};

// ════════════════════════════════════════════════════════════════════
// EMAIL AUTH ROUTES (unchanged)
// ════════════════════════════════════════════════════════════════════

router.post('/signup/send-otp', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    if (!username || !email || !password)
      return res.status(400).json({ message: 'All fields are required' });
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ message: exists.email === email ? 'Email already registered' : 'Username already taken' });
    const otp = generateOTP();
    storeOTP(`signup:${email}`, otp, { username, email, password });
    await sendEmailOTP(email, otp, 'verify');
    res.json({ message: `OTP sent to ${email}` });
  } catch (err) {
    console.error('Signup OTP error:', err.message);
    res.status(500).json({ message: 'Failed to send OTP. Check email config.' });
  }
});

router.post('/signup/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = verifyOTPFromStore(`signup:${email}`, otp);
    if (!result.valid) return res.status(400).json({ message: result.message });
    const { username, password } = result.userData;
    const user = await User.create({ username, email, password });
    res.status(201).json({ _id: user._id, username: user.username, email: user.email, token: generateToken(user._id) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      res.json({ _id: user._id, username: user.username, email: user.email, token: generateToken(user._id) });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login/send-otp', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No account found with this email' });
    const otp = generateOTP();
    storeOTP(`login:${email}`, otp);
    await sendEmailOTP(email, otp, 'login');
    res.json({ message: `OTP sent to ${email}` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

router.post('/login/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = verifyOTPFromStore(`login:${email}`, otp);
    if (!result.valid) return res.status(400).json({ message: result.message });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ _id: user._id, username: user.username, email: user.email, token: generateToken(user._id) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// PHONE AUTH via FIREBASE (frontend handles OTP, backend just verifies)
// ════════════════════════════════════════════════════════════════════

// ── Verify Firebase token and login/signup ─────────────────────────
router.post('/phone/firebase-verify', async (req, res) => {
  const { firebaseToken, username } = req.body;
  if (!firebaseToken) return res.status(400).json({ message: 'Firebase token required' });

  try {
    initFirebase();

    // Verify the Firebase ID token
    const decoded = await admin.auth().verifyIdToken(firebaseToken);
    const phone   = decoded.phone_number;

    if (!phone) return res.status(400).json({ message: 'Phone number not found in token' });

    // Check if user exists
    let user = await User.findOne({ phone });

    if (user) {
      // Existing user — login
      return res.json({
        _id: user._id, username: user.username,
        phone: user.phone, token: generateToken(user._id)
      });
    }

    // New user — need username
    if (!username) {
      return res.status(200).json({ needsUsername: true, phone });
    }

    // Check username not taken
    const usernameTaken = await User.findOne({ username });
    if (usernameTaken) return res.status(400).json({ message: 'Username already taken' });

    // Create new user
    user = await User.create({
      username,
      phone,
      password: `firebase_${phone}_${Date.now()}`
    });

    res.status(201).json({
      _id: user._id, username: user.username,
      phone: user.phone, token: generateToken(user._id)
    });

  } catch (err) {
    console.error('Firebase verify error:', err.message);
    if (err.code === 'auth/id-token-expired')
      return res.status(401).json({ message: 'Session expired. Please try again.' });
    res.status(500).json({ message: 'Verification failed. Try again.' });
  }
});

module.exports = router;


//authrout.js and index.js server email


// const express    = require('express');
// const router     = express.Router();
// const jwt        = require('jsonwebtoken');
// const nodemailer = require('nodemailer');
// const admin      = require('firebase-admin');
// const User       = require('../models/User');

// // ── Token generator ────────────────────────────────────────────────
// const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// // ── OTP generator ──────────────────────────────────────────────────
// const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// // ── In-memory OTP store ────────────────────────────────────────────
// const otpStore = {};
// const storeOTP = (key, otp, userData = {}) => {
//   otpStore[key] = { otp, expiresAt: Date.now() + 10 * 60 * 1000, userData };
// };
// const verifyOTPFromStore = (key, otp) => {
//   const record = otpStore[key];
//   if (!record) return { valid: false, message: 'OTP not found. Please request again.' };
//   if (Date.now() > record.expiresAt) { delete otpStore[key]; return { valid: false, message: 'OTP expired. Please request again.' }; }
//   if (record.otp !== otp) return { valid: false, message: 'Invalid OTP.' };
//   const userData = record.userData;
//   delete otpStore[key];
//   return { valid: true, userData };
// };

// // ── Firebase Admin init (lazy) ─────────────────────────────────────
// let firebaseInitialized = false;
// const initFirebase = () => {
//   if (firebaseInitialized) return;
//   try {
//     admin.initializeApp({
//       credential: admin.credential.cert({
//         projectId:    process.env.FIREBASE_PROJECT_ID,
//         clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
//         privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
//       })
//     });
//     firebaseInitialized = true;
//   } catch (e) {
//     console.error('Firebase admin init failed:', e.message);
//   }
// };

// // ── Email transporter ──────────────────────────────────────────────
// const sendEmailOTP = async (email, otp, purpose = 'verify') => {
//   const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
//   });
//   await transporter.sendMail({
//     from: `"Vstream" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: purpose === 'login' ? 'Your Vstream Login OTP' : 'Verify your Vstream account',
//     html: `
//       <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1e1e1e;padding:32px;border-radius:12px;">
//         <h2 style="color:#1db954;">Vstream 🎵</h2>
//         <p style="color:#b3b3b3;">${purpose === 'login' ? 'Your login code:' : 'Your verification code:'}</p>
//         <div style="background:#121212;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
//           <span style="font-size:2.5rem;font-weight:900;letter-spacing:12px;color:#1db954;">${otp}</span>
//         </div>
//         <p style="color:#666;font-size:0.85rem;">Expires in <strong style="color:#b3b3b3;">10 minutes</strong>. Do not share.</p>
//       </div>
//     `
//   });
// };

// // ════════════════════════════════════════════════════════════════════
// // EMAIL AUTH ROUTES (unchanged)
// // ════════════════════════════════════════════════════════════════════

// router.post('/signup/send-otp', async (req, res) => {
//   const { username, email, password } = req.body;
//   try {
//     if (!username || !email || !password)
//       return res.status(400).json({ message: 'All fields are required' });
//     const exists = await User.findOne({ $or: [{ email }, { username }] });
//     if (exists) return res.status(400).json({ message: exists.email === email ? 'Email already registered' : 'Username already taken' });
//     const otp = generateOTP();
//     storeOTP(`signup:${email}`, otp, { username, email, password });
//     await sendEmailOTP(email, otp, 'verify');
//     res.json({ message: `OTP sent to ${email}` });
//   } catch (err) {
//     console.error('Signup OTP error:', err.message);
//     res.status(500).json({ message: 'Failed to send OTP. Check email config.' });
//   }
// });

// router.post('/signup/verify-otp', async (req, res) => {
//   const { email, otp } = req.body;
//   try {
//     const result = verifyOTPFromStore(`signup:${email}`, otp);
//     if (!result.valid) return res.status(400).json({ message: result.message });
//     const { username, password } = result.userData;
//     const user = await User.create({ username, email, password });
//     res.status(201).json({ _id: user._id, username: user.username, email: user.email, token: generateToken(user._id) });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// router.post('/login', async (req, res) => {
//   const { email, password } = req.body;
//   try {
//     const user = await User.findOne({ email });
//     if (user && (await user.matchPassword(password))) {
//       res.json({ _id: user._id, username: user.username, email: user.email, token: generateToken(user._id) });
//     } else {
//       res.status(401).json({ message: 'Invalid email or password' });
//     }
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// router.post('/login/send-otp', async (req, res) => {
//   const { email } = req.body;
//   try {
//     const user = await User.findOne({ email });
//     if (!user) return res.status(404).json({ message: 'No account found with this email' });
//     const otp = generateOTP();
//     storeOTP(`login:${email}`, otp);
//     await sendEmailOTP(email, otp, 'login');
//     res.json({ message: `OTP sent to ${email}` });
//   } catch (err) {
//     res.status(500).json({ message: 'Failed to send OTP' });
//   }
// });

// router.post('/login/verify-otp', async (req, res) => {
//   const { email, otp } = req.body;
//   try {
//     const result = verifyOTPFromStore(`login:${email}`, otp);
//     if (!result.valid) return res.status(400).json({ message: result.message });
//     const user = await User.findOne({ email });
//     if (!user) return res.status(404).json({ message: 'User not found' });
//     res.json({ _id: user._id, username: user.username, email: user.email, token: generateToken(user._id) });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// // ════════════════════════════════════════════════════════════════════
// // PHONE AUTH via FIREBASE (frontend handles OTP, backend just verifies)
// // ════════════════════════════════════════════════════════════════════

// // ── Verify Firebase token and login/signup ─────────────────────────
// router.post('/phone/firebase-verify', async (req, res) => {
//   const { firebaseToken, username } = req.body;
//   if (!firebaseToken) return res.status(400).json({ message: 'Firebase token required' });

//   try {
//     initFirebase();

//     // Verify the Firebase ID token
//     const decoded = await admin.auth().verifyIdToken(firebaseToken);
//     const phone   = decoded.phone_number;

//     if (!phone) return res.status(400).json({ message: 'Phone number not found in token' });

//     // Check if user exists
//     let user = await User.findOne({ phone });

//     if (user) {
//       // Existing user — login
//       return res.json({
//         _id: user._id, username: user.username,
//         phone: user.phone, token: generateToken(user._id)
//       });
//     }

//     // New user — need username
//     if (!username) {
//       return res.status(200).json({ needsUsername: true, phone });
//     }

//     // Check username not taken
//     const usernameTaken = await User.findOne({ username });
//     if (usernameTaken) return res.status(400).json({ message: 'Username already taken' });

//     // Create new user
//     user = await User.create({
//       username,
//       phone,
//       password: `firebase_${phone}_${Date.now()}`
//     });

//     res.status(201).json({
//       _id: user._id, username: user.username,
//       phone: user.phone, token: generateToken(user._id)
//     });

//   } catch (err) {
//     console.error('Firebase verify error:', err.message);
//     if (err.code === 'auth/id-token-expired')
//       return res.status(401).json({ message: 'Session expired. Please try again.' });
//     res.status(500).json({ message: 'Verification failed. Try again.' });
//   }
// });

// module.exports = router;



//login, authroute,signin,login,firebase,client env,server env


// const express = require('express');
// const router = express.Router();
// const jwt = require('jsonwebtoken');
// const User = require('../models/User');

// const generateToken = (id) => {
//   return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
// };

// router.post('/signup', async (req, res) => {
//   const { username, email, password } = req.body;
//   try {
//     const userExists = await User.findOne({ email });
//     if (userExists) return res.status(400).json({ message: 'User already exists' });

//     const user = await User.create({ username, email, password });
//     res.status(201).json({
//       _id: user._id,
//       username: user.username,
//       email: user.email,
//       token: generateToken(user._id)
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// router.post('/login', async (req, res) => {
//   const { email, password } = req.body;
//   try {
//     const user = await User.findOne({ email });
//     if (user && (await user.matchPassword(password))) {
//       res.json({
//         _id: user._id,
//         username: user.username,
//         email: user.email,
//         token: generateToken(user._id)
//       });
//     } else {
//       res.status(401).json({ message: 'Invalid email or password' });
//     }
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// module.exports = router;
