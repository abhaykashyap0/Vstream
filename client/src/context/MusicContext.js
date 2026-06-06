// import React, { createContext, useState, useCallback } from 'react';
// import axios from 'axios';

// const API = process.env.REACT_APP_API_URL || '';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   const getToken = () => {
//     try { return JSON.parse(localStorage.getItem('musicUser'))?.token; } catch { return null; }
//   };

//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying]     = useState(false);
//   const [songKey, setSongKey]         = useState(0);
//   const [queue, setQueue]             = useState([]);
//   const [shuffle, setShuffle]         = useState(false);
//   const [repeat, setRepeat]           = useState('none'); // 'none' | 'one' | 'all'

//   // ── Internal helper: report song play to admin tracker ─────────────────
//   const reportSongPlay = (song) => {
//     try {
//       const sessionId = localStorage.getItem('vstreamSessionId');
//       if (!sessionId || !song) return;
//       axios.post(`${API}/api/admin/session/song`, {
//         sessionId,
//         songId: song._id || song.id || '',
//         title:  song.title || song.name || 'Unknown',
//         artist: song.artist || song.primaryArtists || song.singers || ''
//       }).catch(() => {}); // silent fail — never block playback
//     } catch {}
//   };

//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     if (playlistSongs.length > 0) setQueue(playlistSongs);

//     // Track recently played
//     const token = getToken();
//     if (token && song?._id) {
//       axios.post(`${API}/api/playlists/recently-played`,
//         { songId: song._id },
//         { headers: { Authorization: `Bearer ${token}` } }
//       ).catch(() => {});
//     }

//     // ✅ Track for admin dashboard
//     reportSongPlay(song);
//   };

//   const addToQueue = (song) => {
//     setQueue(prev => {
//       if (prev.some(s => s._id === song._id)) return prev;
//       return [...prev, song];
//     });
//   };

//   const getRandomIndex = useCallback((currentIndex, queueLength) => {
//     if (queueLength <= 1) return 0;
//     let rand;
//     do { rand = Math.floor(Math.random() * queueLength); }
//     while (rand === currentIndex);
//     return rand;
//   }, []);

//   const playNext = useCallback(() => {
//     if (!queue.length) return;
//     if (repeat === 'one') {
//       setCurrentSong(prev => prev);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);
//     let nextIndex;
//     if (shuffle) {
//       nextIndex = getRandomIndex(currentIndex, queue.length);
//     } else if (currentIndex < queue.length - 1) {
//       nextIndex = currentIndex + 1;
//     } else if (repeat === 'all') {
//       nextIndex = 0;
//     } else {
//       return;
//     }
//     setCurrentSong(queue[nextIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     reportSongPlay(queue[nextIndex]);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   const playPrev = useCallback(() => {
//     if (!queue.length) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);
//     let prevIndex;
//     if (shuffle) {
//       prevIndex = getRandomIndex(currentIndex, queue.length);
//     } else if (currentIndex > 0) {
//       prevIndex = currentIndex - 1;
//     } else if (repeat === 'all') {
//       prevIndex = queue.length - 1;
//     } else {
//       return;
//     }
//     setCurrentSong(queue[prevIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     reportSongPlay(queue[prevIndex]);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   const cycleRepeat = () => {
//     setRepeat(prev =>
//       prev === 'none' ? 'one' :
//       prev === 'one'  ? 'all' : 'none'
//     );
//   };

//   const toggleShuffle = () => setShuffle(prev => !prev);
//   const togglePlay    = () => setIsPlaying(prev => !prev);

//   const resetPlayer = () => {
//     setCurrentSong(null);
//     setIsPlaying(false);
//     setSongKey(0);
//     setQueue([]);
//     setShuffle(false);
//     setRepeat('none');
//   };

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, shuffle, repeat,
//       playSong, playNext, playPrev, addToQueue,
//       togglePlay, toggleShuffle, cycleRepeat, setIsPlaying,
//       resetPlayer
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };

//ADMIN 

// import React, { createContext, useState, useCallback } from 'react';
// import axios from 'axios';

// const API = process.env.REACT_APP_API_URL || '';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   // Get auth token from localStorage to track recently played
//   const getToken = () => {
//     try { return JSON.parse(localStorage.getItem('musicUser'))?.token; } catch { return null; }
//   };
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying]     = useState(false);
//   const [songKey, setSongKey]         = useState(0);
//   const [queue, setQueue]             = useState([]);
//   const [shuffle, setShuffle]         = useState(false);
//   const [repeat, setRepeat]           = useState('none'); // 'none' | 'one' | 'all'

//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     if (playlistSongs.length > 0) setQueue(playlistSongs);
//     // Track recently played if user is logged in
//     const token = getToken();
//     if (token && song?._id) {
//       axios.post(`${API}/api/playlists/recently-played`,
//         { songId: song._id },
//         { headers: { Authorization: `Bearer ${token}` } }
//       ).catch(() => {}); // silent fail
//     }
//   };

//   const addToQueue = (song) => {
//     setQueue(prev => {
//       if (prev.some(s => s._id === song._id)) return prev;
//       return [...prev, song];
//     });
//   };

//   // Get a random index from queue excluding current
//   const getRandomIndex = useCallback((currentIndex, queueLength) => {
//     if (queueLength <= 1) return 0;
//     let rand;
//     do { rand = Math.floor(Math.random() * queueLength); }
//     while (rand === currentIndex);
//     return rand;
//   }, []);

//   const playNext = useCallback(() => {
//     if (queue.length === 0) {
//       // No queue — repeat one restarts same song
//       if (repeat === 'one') {
//         setCurrentSong(prev => prev);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//         return;
//       }
//       return;
//     }
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Repeat one — restart the CURRENT song explicitly
//     if (repeat === 'one') {
//       setCurrentSong(prev => prev); // keep same song reference
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1); // increment key to force re-init in PlayerBar
//       return;
//     }

//     // Shuffle — pick random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const nextIndex = currentIndex + 1;

//     // Repeat all — loop back to start
//     if (nextIndex >= queue.length) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[0]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       } else {
//         setIsPlaying(false); // end of queue, no repeat
//       }
//       return;
//     }

//     // Normal next
//     setCurrentSong(queue[nextIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   const playPrev = useCallback(() => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Shuffle — go to random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const prevIndex = currentIndex - 1;

//     // Repeat all — wrap to last song
//     if (prevIndex < 0) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[queue.length - 1]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       }
//       return;
//     }

//     setCurrentSong(queue[prevIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   // Cycle repeat: none → one → all → none
//   const cycleRepeat = () => {
//     setRepeat(prev =>
//       prev === 'none' ? 'one' :
//       prev === 'one'  ? 'all' : 'none'
//     );
//   };

//   const toggleShuffle = () => setShuffle(prev => !prev);
//   const togglePlay    = () => setIsPlaying(prev => !prev);

//   // ✅ Called on logout — stops music and clears all player state
//   const resetPlayer = () => {
//     setCurrentSong(null);
//     setIsPlaying(false);
//     setSongKey(0);
//     setQueue([]);
//     setShuffle(false);
//     setRepeat('none');
//   };

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, shuffle, repeat,
//       playSong, playNext, playPrev, addToQueue,
//       togglePlay, toggleShuffle, cycleRepeat, setIsPlaying,
//       resetPlayer
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };



import React, { createContext, useState, useCallback } from 'react';
import axios from 'axios';

export const MusicContext = createContext();

export const MusicProvider = ({ children }) => {
  // Get auth token from localStorage to track recently played
  const getToken = () => {
    try { return JSON.parse(localStorage.getItem('musicUser'))?.token; } catch { return null; }
  };
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [songKey, setSongKey]         = useState(0);
  const [queue, setQueue]             = useState([]);
  const [shuffle, setShuffle]         = useState(false);
  const [repeat, setRepeat]           = useState('none'); // 'none' | 'one' | 'all'

  const playSong = (song, playlistSongs = []) => {
    setCurrentSong(song);
    setIsPlaying(true);
    setSongKey(prev => prev + 1);
    if (playlistSongs.length > 0) setQueue(playlistSongs);
    // Track recently played if user is logged in
    const token = getToken();
    if (token && song?._id) {
      axios.post('/api/playlists/recently-played',
        { songId: song._id },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => {}); // silent fail
    }
  };

  const addToQueue = (song) => {
    setQueue(prev => {
      if (prev.some(s => s._id === song._id)) return prev;
      return [...prev, song];
    });
  };

  // Get a random index from queue excluding current
  const getRandomIndex = useCallback((currentIndex, queueLength) => {
    if (queueLength <= 1) return 0;
    let rand;
    do { rand = Math.floor(Math.random() * queueLength); }
    while (rand === currentIndex);
    return rand;
  }, []);

  const playNext = useCallback(() => {
    if (queue.length === 0) {
      // No queue — repeat one restarts same song
      if (repeat === 'one') {
        setCurrentSong(prev => prev);
        setIsPlaying(true);
        setSongKey(prev => prev + 1);
        return;
      }
      return;
    }
    const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

    // Repeat one — restart the CURRENT song explicitly
    if (repeat === 'one') {
      setCurrentSong(prev => prev); // keep same song reference
      setIsPlaying(true);
      setSongKey(prev => prev + 1); // increment key to force re-init in PlayerBar
      return;
    }

    // Shuffle — pick random song
    if (shuffle) {
      const randIndex = getRandomIndex(currentIndex, queue.length);
      setCurrentSong(queue[randIndex]);
      setIsPlaying(true);
      setSongKey(prev => prev + 1);
      return;
    }

    const nextIndex = currentIndex + 1;

    // Repeat all — loop back to start
    if (nextIndex >= queue.length) {
      if (repeat === 'all') {
        setCurrentSong(queue[0]);
        setIsPlaying(true);
        setSongKey(prev => prev + 1);
      } else {
        setIsPlaying(false); // end of queue, no repeat
      }
      return;
    }

    // Normal next
    setCurrentSong(queue[nextIndex]);
    setIsPlaying(true);
    setSongKey(prev => prev + 1);
  }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

    // Shuffle — go to random song
    if (shuffle) {
      const randIndex = getRandomIndex(currentIndex, queue.length);
      setCurrentSong(queue[randIndex]);
      setIsPlaying(true);
      setSongKey(prev => prev + 1);
      return;
    }

    const prevIndex = currentIndex - 1;

    // Repeat all — wrap to last song
    if (prevIndex < 0) {
      if (repeat === 'all') {
        setCurrentSong(queue[queue.length - 1]);
        setIsPlaying(true);
        setSongKey(prev => prev + 1);
      }
      return;
    }

    setCurrentSong(queue[prevIndex]);
    setIsPlaying(true);
    setSongKey(prev => prev + 1);
  }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

  // Cycle repeat: none → one → all → none
  const cycleRepeat = () => {
    setRepeat(prev =>
      prev === 'none' ? 'one' :
      prev === 'one'  ? 'all' : 'none'
    );
  };

  const toggleShuffle = () => setShuffle(prev => !prev);
  const togglePlay    = () => setIsPlaying(prev => !prev);

  // ✅ Called on logout — stops music and clears all player state
  const resetPlayer = () => {
    setCurrentSong(null);
    setIsPlaying(false);
    setSongKey(0);
    setQueue([]);
    setShuffle(false);
    setRepeat('none');
  };

  return (
    <MusicContext.Provider value={{
      currentSong, songKey, isPlaying,
      queue, shuffle, repeat,
      playSong, playNext, playPrev, addToQueue,
      togglePlay, toggleShuffle, cycleRepeat, setIsPlaying,
      resetPlayer
    }}>
      {children}
    </MusicContext.Provider>
  );
};




// playerbar ,musiccontext,app.css homepage for show more option and repeat fix and phone size video


// import React, { createContext, useState, useCallback } from 'react';
// import axios from 'axios';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   // Get auth token from localStorage to track recently played
//   const getToken = () => {
//     try { return JSON.parse(localStorage.getItem('musicUser'))?.token; } catch { return null; }
//   };
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying]     = useState(false);
//   const [songKey, setSongKey]         = useState(0);
//   const [queue, setQueue]             = useState([]);
//   const [shuffle, setShuffle]         = useState(false);
//   const [repeat, setRepeat]           = useState('none'); // 'none' | 'one' | 'all'

//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     if (playlistSongs.length > 0) setQueue(playlistSongs);
//     // Track recently played if user is logged in
//     const token = getToken();
//     if (token && song?._id) {
//       axios.post('/api/playlists/recently-played',
//         { songId: song._id },
//         { headers: { Authorization: `Bearer ${token}` } }
//       ).catch(() => {}); // silent fail
//     }
//   };

//   const addToQueue = (song) => {
//     setQueue(prev => {
//       if (prev.some(s => s._id === song._id)) return prev;
//       return [...prev, song];
//     });
//   };

//   // Get a random index from queue excluding current
//   const getRandomIndex = useCallback((currentIndex, queueLength) => {
//     if (queueLength <= 1) return 0;
//     let rand;
//     do { rand = Math.floor(Math.random() * queueLength); }
//     while (rand === currentIndex);
//     return rand;
//   }, []);

//   const playNext = useCallback(() => {
//     if (queue.length === 0) {
//       // No queue — repeat one still works
//       if (repeat === 'one') { setSongKey(prev => prev + 1); return; }
//       return;
//     }
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Repeat one — restart same song
//     if (repeat === 'one') {
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     // Shuffle — pick random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const nextIndex = currentIndex + 1;

//     // Repeat all — loop back to start
//     if (nextIndex >= queue.length) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[0]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       } else {
//         setIsPlaying(false); // end of queue, no repeat
//       }
//       return;
//     }

//     // Normal next
//     setCurrentSong(queue[nextIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   const playPrev = useCallback(() => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Shuffle — go to random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const prevIndex = currentIndex - 1;

//     // Repeat all — wrap to last song
//     if (prevIndex < 0) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[queue.length - 1]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       }
//       return;
//     }

//     setCurrentSong(queue[prevIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   // Cycle repeat: none → one → all → none
//   const cycleRepeat = () => {
//     setRepeat(prev =>
//       prev === 'none' ? 'one' :
//       prev === 'one'  ? 'all' : 'none'
//     );
//   };

//   const toggleShuffle = () => setShuffle(prev => !prev);
//   const togglePlay    = () => setIsPlaying(prev => !prev);

//   // ✅ Called on logout — stops music and clears all player state
//   const resetPlayer = () => {
//     setCurrentSong(null);
//     setIsPlaying(false);
//     setSongKey(0);
//     setQueue([]);
//     setShuffle(false);
//     setRepeat('none');
//   };

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, shuffle, repeat,
//       playSong, playNext, playPrev, addToQueue,
//       togglePlay, toggleShuffle, cycleRepeat, setIsPlaying,
//       resetPlayer
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };



//Good point — two things needed:

//On logout → stop music, clear player bar
//On login → restore recently played so user sees their history

//Only 2 files need changes — MusicContext.js (add a reset function) and AuthContext.js (call reset on logout, restore on login):


// import React, { createContext, useState, useCallback } from 'react';
// import axios from 'axios';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   // Get auth token from localStorage to track recently played
//   const getToken = () => {
//     try { return JSON.parse(localStorage.getItem('musicUser'))?.token; } catch { return null; }
//   };
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying]     = useState(false);
//   const [songKey, setSongKey]         = useState(0);
//   const [queue, setQueue]             = useState([]);
//   const [shuffle, setShuffle]         = useState(false);
//   const [repeat, setRepeat]           = useState('none'); // 'none' | 'one' | 'all'

//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     if (playlistSongs.length > 0) setQueue(playlistSongs);
//     // Track recently played if user is logged in
//     const token = getToken();
//     if (token && song?._id) {
//       axios.post('/api/playlists/recently-played',
//         { songId: song._id },
//         { headers: { Authorization: `Bearer ${token}` } }
//       ).catch(() => {}); // silent fail
//     }
//   };

//   const addToQueue = (song) => {
//     setQueue(prev => {
//       if (prev.some(s => s._id === song._id)) return prev;
//       return [...prev, song];
//     });
//   };

//   // Get a random index from queue excluding current
//   const getRandomIndex = useCallback((currentIndex, queueLength) => {
//     if (queueLength <= 1) return 0;
//     let rand;
//     do { rand = Math.floor(Math.random() * queueLength); }
//     while (rand === currentIndex);
//     return rand;
//   }, []);

//   const playNext = useCallback(() => {
//     if (queue.length === 0) {
//       // No queue — repeat one still works
//       if (repeat === 'one') { setSongKey(prev => prev + 1); return; }
//       return;
//     }
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Repeat one — restart same song
//     if (repeat === 'one') {
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     // Shuffle — pick random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const nextIndex = currentIndex + 1;

//     // Repeat all — loop back to start
//     if (nextIndex >= queue.length) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[0]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       } else {
//         setIsPlaying(false); // end of queue, no repeat
//       }
//       return;
//     }

//     // Normal next
//     setCurrentSong(queue[nextIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   const playPrev = useCallback(() => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Shuffle — go to random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const prevIndex = currentIndex - 1;

//     // Repeat all — wrap to last song
//     if (prevIndex < 0) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[queue.length - 1]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       }
//       return;
//     }

//     setCurrentSong(queue[prevIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   // Cycle repeat: none → one → all → none
//   const cycleRepeat = () => {
//     setRepeat(prev =>
//       prev === 'none' ? 'one' :
//       prev === 'one'  ? 'all' : 'none'
//     );
//   };

//   const toggleShuffle = () => setShuffle(prev => !prev);
//   const togglePlay    = () => setIsPlaying(prev => !prev);

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, shuffle, repeat,
//       playSong, playNext, playPrev, addToQueue,
//       togglePlay, toggleShuffle, cycleRepeat, setIsPlaying
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };


//for remove song from play list and multipke playlist 
// playlistroutes,userjs,musiccontext,librarypage ,song list are upodated 




// import React, { createContext, useState, useCallback } from 'react';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying]     = useState(false);
//   const [songKey, setSongKey]         = useState(0);
//   const [queue, setQueue]             = useState([]);
//   const [shuffle, setShuffle]         = useState(false);
//   const [repeat, setRepeat]           = useState('none'); // 'none' | 'one' | 'all'

//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     if (playlistSongs.length > 0) setQueue(playlistSongs);
//   };

//   const addToQueue = (song) => {
//     setQueue(prev => {
//       if (prev.some(s => s._id === song._id)) return prev;
//       return [...prev, song];
//     });
//   };

//   // Get a random index from queue excluding current
//   const getRandomIndex = useCallback((currentIndex, queueLength) => {
//     if (queueLength <= 1) return 0;
//     let rand;
//     do { rand = Math.floor(Math.random() * queueLength); }
//     while (rand === currentIndex);
//     return rand;
//   }, []);

//   const playNext = useCallback(() => {
//     if (queue.length === 0) {
//       // No queue — repeat one still works
//       if (repeat === 'one') { setSongKey(prev => prev + 1); return; }
//       return;
//     }
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Repeat one — restart same song
//     if (repeat === 'one') {
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     // Shuffle — pick random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const nextIndex = currentIndex + 1;

//     // Repeat all — loop back to start
//     if (nextIndex >= queue.length) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[0]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       } else {
//         setIsPlaying(false); // end of queue, no repeat
//       }
//       return;
//     }

//     // Normal next
//     setCurrentSong(queue[nextIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   const playPrev = useCallback(() => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);

//     // Shuffle — go to random song
//     if (shuffle) {
//       const randIndex = getRandomIndex(currentIndex, queue.length);
//       setCurrentSong(queue[randIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//       return;
//     }

//     const prevIndex = currentIndex - 1;

//     // Repeat all — wrap to last song
//     if (prevIndex < 0) {
//       if (repeat === 'all') {
//         setCurrentSong(queue[queue.length - 1]);
//         setIsPlaying(true);
//         setSongKey(prev => prev + 1);
//       }
//       return;
//     }

//     setCurrentSong(queue[prevIndex]);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//   }, [queue, currentSong, repeat, shuffle, getRandomIndex]);

//   // Cycle repeat: none → one → all → none
//   const cycleRepeat = () => {
//     setRepeat(prev =>
//       prev === 'none' ? 'one' :
//       prev === 'one'  ? 'all' : 'none'
//     );
//   };

//   const toggleShuffle = () => setShuffle(prev => !prev);
//   const togglePlay    = () => setIsPlaying(prev => !prev);

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, shuffle, repeat,
//       playSong, playNext, playPrev, addToQueue,
//       togglePlay, toggleShuffle, cycleRepeat, setIsPlaying
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };



// adding repeat and shuffle functionality to music context, and a queue for playlist songs



// import React, { createContext, useState } from 'react';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [songKey, setSongKey] = useState(0);
//   const [queue, setQueue] = useState([]);

//   // Play a song — optionally pass a queue (playlist songs) for auto-next
//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     if (playlistSongs.length > 0) {
//       setQueue(playlistSongs);
//     }
//   };

//   // ✅ Add a single song to end of queue in real-time
//   const addToQueue = (song) => {
//     setQueue(prev => {
//       const alreadyIn = prev.some(s => s._id === song._id);
//       if (alreadyIn) return prev; // Don't add duplicates
//       return [...prev, song];
//     });
//   };

//   // Play next song in queue
//   const playNext = () => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);
//     const nextIndex = currentIndex + 1;
//     if (nextIndex < queue.length) {
//       setCurrentSong(queue[nextIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//     } else {
//       setIsPlaying(false);
//     }
//   };

//   // Play previous song in queue
//   const playPrev = () => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);
//     const prevIndex = currentIndex - 1;
//     if (prevIndex >= 0) {
//       setCurrentSong(queue[prevIndex]);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//     }
//   };

//   const togglePlay = () => {
//     setIsPlaying(prev => !prev);
//   };

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, playSong, playNext, playPrev, addToQueue,
//       togglePlay, setIsPlaying
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };

//songlist and musicecontext updated 




// import React, { createContext, useState } from 'react';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [songKey, setSongKey] = useState(0);
//   const [queue, setQueue] = useState([]); // current playlist queue

//   // Play a song — optionally pass a queue (playlist songs) for auto-next
//   const playSong = (song, playlistSongs = []) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1);
//     // Only update queue if a playlist was passed
//     if (playlistSongs.length > 0) {
//       setQueue(playlistSongs);
//     }
//   };

//   // Play next song in queue after current one ends
//   const playNext = () => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);
//     const nextIndex = currentIndex + 1;
//     if (nextIndex < queue.length) {
//       const nextSong = queue[nextIndex];
//       setCurrentSong(nextSong);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//     } else {
//       // End of playlist — stop playing
//       setIsPlaying(false);
//     }
//   };

//   // Play previous song in queue
//   const playPrev = () => {
//     if (queue.length === 0) return;
//     const currentIndex = queue.findIndex(s => s._id === currentSong?._id);
//     const prevIndex = currentIndex - 1;
//     if (prevIndex >= 0) {
//       const prevSong = queue[prevIndex];
//       setCurrentSong(prevSong);
//       setIsPlaying(true);
//       setSongKey(prev => prev + 1);
//     }
//   };

//   const togglePlay = () => {
//     setIsPlaying(prev => !prev);
//   };

//   return (
//     <MusicContext.Provider value={{
//       currentSong, songKey, isPlaying,
//       queue, playSong, playNext, playPrev,
//       togglePlay, setIsPlaying
//     }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };

//MusicContext.js — add a queue state (the active playlist songs) and a playNext function
//LibraryPage.js — when user clicks a song, pass the full playlist as the queue
// SongList.js — pass queue to playSong when inside a playlist
// PlayerBar.js — call playNext when a song ends instead of just stopping
// import React, { createContext, useState } from 'react';

// export const MusicContext = createContext();

// export const MusicProvider = ({ children }) => {
//   const [currentSong, setCurrentSong] = useState(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [songKey, setSongKey] = useState(0);

//   const playSong = (song) => {
//     setCurrentSong(song);
//     setIsPlaying(true);
//     setSongKey(prev => prev + 1); // Always increment so useEffect fires even for same song
//   };

//   const togglePlay = () => {
//     setIsPlaying(prev => !prev);
//   };

//   return (
//     <MusicContext.Provider value={{ currentSong, songKey, isPlaying, playSong, togglePlay, setIsPlaying }}>
//       {children}
//     </MusicContext.Provider>
//   );
// };
