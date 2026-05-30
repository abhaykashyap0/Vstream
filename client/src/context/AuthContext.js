import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { MusicContext } from './MusicContext';

export const AuthContext = createContext();

const API = process.env.REACT_APP_API_URL || '';

export const AuthProvider = ({ children }) => {
  const [user, setUser]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('vstreamSessionId') || null);
  const { resetPlayer } = useContext(MusicContext);

  useEffect(() => {
    const storedUser = localStorage.getItem('musicUser');
    if (storedUser) setUser(JSON.parse(storedUser));
    setLoading(false);
  }, []);

  const login = async (userData) => {
    setUser(userData);
    localStorage.setItem('musicUser', JSON.stringify(userData));

    // Record session start for admin tracking
    try {
      const res = await axios.post(`${API}/api/admin/session/start`, {
        userId:    userData._id || userData.id,
        username:  userData.username,
        email:     userData.email,
        userAgent: navigator.userAgent,
      });
      const sid = res.data.sessionId;
      setSessionId(sid);
      localStorage.setItem('vstreamSessionId', sid);
    } catch (err) {
      // Non-critical — don't block login if tracking fails
      console.warn('Session tracking start failed:', err.message);
    }
  };

  const logout = async () => {
    // End session in admin tracker
    try {
      const sid = sessionId || localStorage.getItem('vstreamSessionId');
      if (sid) {
        await axios.post(`${API}/api/admin/session/end`, { sessionId: sid });
      }
    } catch (err) {
      console.warn('Session tracking end failed:', err.message);
    }

    setUser(null);
    setSessionId(null);
    localStorage.removeItem('musicUser');
    localStorage.removeItem('vstreamSessionId');
    resetPlayer();
  };

  // Exposed so MusicContext / PlayerBar can track song plays
  const trackSong = async (songId, title, artist) => {
    try {
      const sid = sessionId || localStorage.getItem('vstreamSessionId');
      if (!sid) return;
      await axios.post(`${API}/api/admin/session/song`, { sessionId: sid, songId, title, artist });
    } catch (err) {
      // Non-critical
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, sessionId, trackSong }}>
      {children}
    </AuthContext.Provider>
  );
};


//admin

// import React, { createContext, useState, useEffect, useContext } from 'react';
// import { MusicContext } from './MusicContext';

// export const AuthContext = createContext();

// export const AuthProvider = ({ children }) => {
//   const [user, setUser]       = useState(null);
//   const [loading, setLoading] = useState(true);
//   const { resetPlayer }       = useContext(MusicContext);

//   useEffect(() => {
//     const storedUser = localStorage.getItem('musicUser');
//     if (storedUser) setUser(JSON.parse(storedUser));
//     setLoading(false);
//   }, []);

//   const login = (userData) => {
//     setUser(userData);
//     localStorage.setItem('musicUser', JSON.stringify(userData));
//   };

//   const logout = () => {
//     setUser(null);
//     localStorage.removeItem('musicUser');
//     resetPlayer(); // ✅ Stop music and clear player bar on logout
//   };

//   return (
//     <AuthContext.Provider value={{ user, login, logout, loading }}>
//       {children}
//     </AuthContext.Provider>
//   );
// };


// On logout → stop music, clear player bar
// On login → restore recently played so user sees their history

// Only 2 files need changes — MusicContext.js (add a reset function) and AuthContext.js.app.js
//  (call reset on logout, restore on login):


// import React, { createContext, useState, useEffect } from 'react';

// export const AuthContext = createContext();

// export const AuthProvider = ({ children }) => {
//   const [user, setUser] = useState(null);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     const storedUser = localStorage.getItem('musicUser');
//     if (storedUser) {
//       setUser(JSON.parse(storedUser));
//     }
//     setLoading(false);
//   }, []);

//   const login = (userData) => {
//     setUser(userData);
//     localStorage.setItem('musicUser', JSON.stringify(userData));
//   };

//   const logout = () => {
//     setUser(null);
//     localStorage.removeItem('musicUser');
//   };

//   return (
//     <AuthContext.Provider value={{ user, login, logout, loading }}>
//       {children}
//     </AuthContext.Provider>
//   );
// };
