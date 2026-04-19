import React, { createContext, useState, useEffect, useContext } from 'react';
import { MusicContext } from './MusicContext';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const { resetPlayer }       = useContext(MusicContext);

  useEffect(() => {
    const storedUser = localStorage.getItem('musicUser');
    if (storedUser) setUser(JSON.parse(storedUser));
    setLoading(false);
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem('musicUser', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('musicUser');
    resetPlayer(); // ✅ Stop music and clear player bar on logout
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};


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
