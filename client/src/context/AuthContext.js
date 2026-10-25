import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { MusicContext } from './MusicContext';

export const AuthContext = createContext();

const API = process.env.REACT_APP_API_URL || '';

// Reads the "exp" claim from a JWT without any library. Returns true only when the
// token is definitely expired; anything unreadable is treated as "not expired" and
// left for the server to judge.
const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !!payload.exp && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser]                     = useState(null);
  const [loading, setLoading]               = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const { resetPlayer }                     = useContext(MusicContext);

  // Clears the login locally (no network call — the token is already dead).
  const expireSession = useCallback(() => {
    localStorage.removeItem('musicUser');
    localStorage.removeItem('vstreamSessionId');
    setUser(null);
    setSessionExpired(true);
  }, []);

  // Restore the saved login on page load — unless its token has already expired.
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('musicUser') || 'null');
      if (stored) {
        if (stored.token && isTokenExpired(stored.token)) {
          expireSession();
        } else {
          setUser(stored);
        }
      }
    } catch {
      localStorage.removeItem('musicUser');
    }
    setLoading(false);
  }, [expireSession]);

  // If the server says the token is expired/invalid during use, sign out cleanly
  // instead of leaving the user "logged in" with every request failing with 401.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      (err) => {
        const status  = err.response?.status;
        const message = String(err.response?.data?.message || err.response?.data?.error || '');
        const url     = String(err.config?.url || '');
        const isOurApi = !url.startsWith('http') || (API && url.startsWith(API));
        if (status === 401 && isOurApi && /expired|invalid token|not authorized|no token/i.test(message)
            && localStorage.getItem('musicUser')) {
          expireSession();
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, [expireSession]);

  const login = async (userData) => {
    setUser(userData);
    setSessionExpired(false);
    localStorage.setItem('musicUser', JSON.stringify(userData));

    // Start admin session tracking
    try {
      const res = await axios.post(`${API}/api/admin/session/start`, {
        userId:    userData._id || userData.id,
        username:  userData.username,
        email:     userData.email,
        userAgent: navigator.userAgent,
      });
      localStorage.setItem('vstreamSessionId', res.data.sessionId);
    } catch (err) {
      console.warn('Session tracking start failed:', err.message);
    }
  };

  const logout = async () => {
    // End admin session tracking
    try {
      const sessionId = localStorage.getItem('vstreamSessionId');
      if (sessionId) {
        await axios.post(`${API}/api/admin/session/end`, { sessionId });
      }
    } catch (err) {
      console.warn('Session tracking end failed:', err.message);
    }

    setUser(null);
    localStorage.removeItem('musicUser');
    localStorage.removeItem('vstreamSessionId');
    resetPlayer();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, sessionExpired }}>
      {sessionExpired && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 5000,
          background: '#3a2a00', color: '#ffcc66', padding: '10px 16px',
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px',
          fontSize: '0.9rem', borderBottom: '1px solid #665200'
        }}>
          <span>Your session expired. Please log in again.</span>
          <button onClick={() => setSessionExpired(false)}
            style={{ background: 'transparent', border: '1px solid #ffcc66', color: '#ffcc66', borderRadius: '12px', padding: '2px 10px', cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
};


// import React, { createContext, useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import { MusicContext } from './MusicContext';

// export const AuthContext = createContext();

// const API = process.env.REACT_APP_API_URL || '';

// export const AuthProvider = ({ children }) => {
//   const [user, setUser]       = useState(null);
//   const [loading, setLoading] = useState(true);
//   const { resetPlayer }       = useContext(MusicContext);

//   useEffect(() => {
//     const storedUser = localStorage.getItem('musicUser');
//     if (storedUser) setUser(JSON.parse(storedUser));
//     setLoading(false);
//   }, []);

//   const login = async (userData) => {
//     setUser(userData);
//     localStorage.setItem('musicUser', JSON.stringify(userData));

//     // ✅ Start admin session tracking
//     try {
//       const res = await axios.post(`${API}/api/admin/session/start`, {
//         userId:    userData._id || userData.id,
//         username:  userData.username,
//         email:     userData.email,
//         userAgent: navigator.userAgent,
//       });
//       localStorage.setItem('vstreamSessionId', res.data.sessionId);
//     } catch (err) {
//       console.warn('Session tracking start failed:', err.message);
//     }
//   };

//   const logout = async () => {
//     // ✅ End admin session tracking
//     try {
//       const sessionId = localStorage.getItem('vstreamSessionId');
//       if (sessionId) {
//         await axios.post(`${API}/api/admin/session/end`, { sessionId });
//       }
//     } catch (err) {
//       console.warn('Session tracking end failed:', err.message);
//     }

//     setUser(null);
//     localStorage.removeItem('musicUser');
//     localStorage.removeItem('vstreamSessionId');
//     resetPlayer();
//   };

//   return (
//     <AuthContext.Provider value={{ user, login, logout, loading }}>
//       {children}
//     </AuthContext.Provider>
//   );
// };


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
