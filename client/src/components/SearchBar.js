
import React, { useState, useContext } from 'react';
import axios from 'axios';
import { Search } from 'lucide-react';
import { AuthContext } from '../context/AuthContext';

const SearchBar = ({ onResults }) => {
  const [query, setQuery]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [quotaError, setQuotaError] = useState(false);
  const { user }                  = useContext(AuthContext);

  const performSearch = async (searchQuery) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setQuotaError(false);
    try {
      const headers = user ? { Authorization: `Bearer ${user.token}` } : {};
      const { data } = await axios.get(`/api/search?q=${encodeURIComponent(searchQuery)}`, { headers });
      // Ensure always array — search returns array, suggestions returns {type,songs}
      onResults(Array.isArray(data) ? data : (data.songs || []));
    } catch (err) {
      if (err.response?.status === 429) { setQuotaError(true); onResults([]); }
      console.error(err);
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') performSearch(query); };

  const handleClear = () => { setQuery(''); onResults([]); setQuotaError(false); };

  return (
    <div className="search-container">
      <div style={{ position: 'relative' }}>
        <Search
          onClick={() => performSearch(query)}
          style={{
            position: 'absolute', left: '15px', top: '12px',
            color: loading ? '#1db954' : '#b3b3b3', cursor: 'pointer', transition: 'color 0.2s'
          }}
          size={20}
        />
        <input
          type="text"
          className="search-input"
          placeholder="Search for songs or artists... (press Enter)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setQuotaError(false); if (!e.target.value) handleClear(); }}
          onKeyDown={handleKeyDown}
          style={{ paddingLeft: '45px', paddingRight: query ? '40px' : '16px' }}
        />
        {query && (
          <button onClick={handleClear} style={{
            position: 'absolute', right: '14px', top: '10px',
            background: 'transparent', border: 'none',
            color: '#b3b3b3', cursor: 'pointer', fontSize: '18px', lineHeight: 1
          }}>✕</button>
        )}
        {loading && (
          <span style={{ position: 'absolute', right: '40px', top: '12px', color: '#1db954', fontSize: '0.8rem' }}>
            Searching...
          </span>
        )}
      </div>
      <div style={{ marginTop: '8px', color: '#666', fontSize: '0.78rem', paddingLeft: '4px' }}>
        Tip: Press <kbd style={{ background: '#333', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem', color: '#ccc' }}>Enter</kbd> to search
      </div>
      {quotaError && (
        <div style={{
          marginTop: '10px', padding: '10px 16px',
          background: '#2a1a1a', border: '1px solid #ff4444',
          borderRadius: '8px', color: '#ff6666', fontSize: '0.85rem'
        }}>
          ⚠️ Daily search limit reached. Try again tomorrow, or play from your Library.
        </div>
      )}
    </div>
  );
};

export default SearchBar;
//AFTER DEPLOYMENT MANIFEST.JS CREATING PREBLEM SERACHBAR.JS AND SONGLIST.JS CHANGE

// import React, { useState, useContext } from 'react';
// import axios from 'axios';
// import { Search } from 'lucide-react';
// import { AuthContext } from '../context/AuthContext';

// const SearchBar = ({ onResults }) => {
//   const [query, setQuery]         = useState('');
//   const [loading, setLoading]     = useState(false);
//   const [quotaError, setQuotaError] = useState(false);
//   const { user }                  = useContext(AuthContext);

//   const performSearch = async (searchQuery) => {
//     if (!searchQuery.trim()) return;
//     setLoading(true);
//     setQuotaError(false);
//     try {
//       const headers = user ? { Authorization: `Bearer ${user.token}` } : {};
//       const { data } = await axios.get(`/api/search?q=${encodeURIComponent(searchQuery)}`, { headers });
//       onResults(data);
//     } catch (err) {
//       if (err.response?.status === 429) { setQuotaError(true); onResults([]); }
//       console.error(err);
//     } finally { setLoading(false); }
//   };

//   const handleKeyDown = (e) => { if (e.key === 'Enter') performSearch(query); };

//   const handleClear = () => { setQuery(''); onResults([]); setQuotaError(false); };

//   return (
//     <div className="search-container">
//       <div style={{ position: 'relative' }}>
//         <Search
//           onClick={() => performSearch(query)}
//           style={{
//             position: 'absolute', left: '15px', top: '12px',
//             color: loading ? '#1db954' : '#b3b3b3', cursor: 'pointer', transition: 'color 0.2s'
//           }}
//           size={20}
//         />
//         <input
//           type="text"
//           className="search-input"
//           placeholder="Search for songs or artists... (press Enter)"
//           value={query}
//           onChange={(e) => { setQuery(e.target.value); setQuotaError(false); if (!e.target.value) handleClear(); }}
//           onKeyDown={handleKeyDown}
//           style={{ paddingLeft: '45px', paddingRight: query ? '40px' : '16px' }}
//         />
//         {query && (
//           <button onClick={handleClear} style={{
//             position: 'absolute', right: '14px', top: '10px',
//             background: 'transparent', border: 'none',
//             color: '#b3b3b3', cursor: 'pointer', fontSize: '18px', lineHeight: 1
//           }}>✕</button>
//         )}
//         {loading && (
//           <span style={{ position: 'absolute', right: '40px', top: '12px', color: '#1db954', fontSize: '0.8rem' }}>
//             Searching...
//           </span>
//         )}
//       </div>
//       <div style={{ marginTop: '8px', color: '#666', fontSize: '0.78rem', paddingLeft: '4px' }}>
//         Tip: Press <kbd style={{ background: '#333', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem', color: '#ccc' }}>Enter</kbd> to search
//       </div>
//       {quotaError && (
//         <div style={{
//           marginTop: '10px', padding: '10px 16px',
//           background: '#2a1a1a', border: '1px solid #ff4444',
//           borderRadius: '8px', color: '#ff6666', fontSize: '0.85rem'
//         }}>
//           ⚠️ Daily search limit reached. Try again tomorrow, or play from your Library.
//         </div>
//       )}
//     </div>
//   );
// };

// export default SearchBar;



//  HomePage.js,searchroutes,searchbar for vts suggestion


// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import { Search, TrendingUp } from 'lucide-react';
// import { MusicContext } from '../context/MusicContext';

// const SearchBar = ({ onResults }) => {
//   const [query, setQuery]               = useState('');
//   const [loading, setLoading]           = useState(false);
//   const [quotaError, setQuotaError]     = useState(false);
//   const [suggestions, setSuggestions]   = useState([]);
//   const [showSuggestions, setShowSuggestions] = useState(true);
//   const { playSong } = useContext(MusicContext);

//   // Fetch suggestions on mount
//   useEffect(() => {
//     const fetchSuggestions = async () => {
//       try {
//         const { data } = await axios.get('/api/search/suggestions');
//         setSuggestions(data);
//       } catch (err) {
//         console.error('Suggestions error:', err);
//       }
//     };
//     fetchSuggestions();
//   }, []);

//   const performSearch = async (searchQuery) => {
//     if (!searchQuery.trim()) return;
//     setLoading(true);
//     setQuotaError(false);
//     setShowSuggestions(false); // hide suggestions when showing results
//     try {
//       const { data } = await axios.get(`/api/search?q=${encodeURIComponent(searchQuery)}`);
//       onResults(data);
//     } catch (err) {
//       if (err.response?.status === 429) { setQuotaError(true); onResults([]); }
//       console.error(err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === 'Enter') performSearch(query);
//   };

//   const handleClear = () => {
//     setQuery('');
//     onResults([]);
//     setShowSuggestions(true); // show suggestions again when cleared
//     setQuotaError(false);
//   };

//   return (
//     <div className="search-container">
//       {/* Search input */}
//       <div style={{ position: 'relative' }}>
//         <Search
//           onClick={() => performSearch(query)}
//           style={{
//             position: 'absolute', left: '15px', top: '12px',
//             color: loading ? '#1db954' : '#b3b3b3', cursor: 'pointer'
//           }}
//           size={20}
//         />
//         <input
//           type="text"
//           className="search-input"
//           placeholder="Search for songs or artists... (press Enter)"
//           value={query}
//           onChange={(e) => {
//             setQuery(e.target.value);
//             setQuotaError(false);
//             if (!e.target.value) handleClear();
//           }}
//           onKeyDown={handleKeyDown}
//           style={{ paddingLeft: '45px', paddingRight: query ? '40px' : '16px' }}
//         />
//         {/* Clear button */}
//         {query && (
//           <button
//             onClick={handleClear}
//             style={{
//               position: 'absolute', right: '14px', top: '10px',
//               background: 'transparent', border: 'none',
//               color: '#b3b3b3', cursor: 'pointer', fontSize: '18px', lineHeight: 1
//             }}
//           >✕</button>
//         )}
//         {loading && (
//           <span style={{
//             position: 'absolute', right: '40px', top: '12px',
//             color: '#1db954', fontSize: '0.8rem'
//           }}>Searching...</span>
//         )}
//       </div>

//       {/* Hint */}
//       <div style={{ marginTop: '8px', color: '#666', fontSize: '0.78rem', paddingLeft: '4px' }}>
//         Tip: Press <kbd style={{
//           background: '#333', padding: '1px 6px',
//           borderRadius: '4px', fontSize: '0.75rem', color: '#ccc'
//         }}>Enter</kbd> to search
//       </div>

//       {/* Quota error */}
//       {quotaError && (
//         <div style={{
//           marginTop: '10px', padding: '10px 16px',
//           background: '#2a1a1a', border: '1px solid #ff4444',
//           borderRadius: '8px', color: '#ff6666', fontSize: '0.85rem'
//         }}>
//           ⚠️ Daily search limit reached. Try again tomorrow, or play songs from your Library.
//         </div>
//       )}

//       {/* Suggestions — shown when search bar is empty */}
//       {showSuggestions && suggestions.length > 0 && (
//         <div style={{ marginTop: '28px' }}>
//           <div style={{
//             display: 'flex', alignItems: 'center', gap: '8px',
//             marginBottom: '16px', color: '#b3b3b3'
//           }}>
//             <TrendingUp size={18} color="#1db954" />
//             <span style={{ fontWeight: '600', fontSize: '1rem', color: '#fff' }}>
//               Suggested For You
//             </span>
//             {/* Refresh button */}
//             <button
//               onClick={async () => {
//                 try {
//                   const { data } = await axios.get('/api/search/suggestions');
//                   setSuggestions(data);
//                 } catch {}
//               }}
//               style={{
//                 marginLeft: 'auto', background: 'transparent',
//                 border: '1px solid #333', borderRadius: '20px',
//                 padding: '4px 12px', color: '#b3b3b3',
//                 cursor: 'pointer', fontSize: '0.78rem'
//               }}
//             >
//               Refresh
//             </button>
//           </div>

//           {/* Song cards grid */}
//           <div className="song-grid">
//             {suggestions.map(song => (
//               <div
//                 key={song._id}
//                 className="song-card"
//                 onClick={() => {
//                   playSong(song, suggestions);
//                 }}
//               >
//                 <img src={song.image_url} alt={song.title} />
//                 <div className="song-title">{song.title}</div>
//                 <div className="song-artist">{song.artist}</div>
//                 {song.duration && (
//                   <div style={{ fontSize: '11px', color: '#b3b3b3', marginTop: '4px' }}>
//                     {song.duration}
//                   </div>
//                 )}
//               </div>
//             ))}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default SearchBar;


//searchroutes and searchbar are updated for suggestion below search bar 



// import React, { useState } from 'react';
// import axios from 'axios';
// import { Search } from 'lucide-react';

// const SearchBar = ({ onResults }) => {
//   const [query, setQuery] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [quotaError, setQuotaError] = useState(false);

//   // ✅ Search only on Enter key press — saves ~80% of API quota
//   // No more auto-search on every keystroke
//   const performSearch = async (searchQuery) => {
//     if (!searchQuery.trim()) return;
//     setLoading(true);
//     setQuotaError(false);
//     try {
//       const { data } = await axios.get(`/api/search?q=${encodeURIComponent(searchQuery)}`);
//       onResults(data);
//     } catch (err) {
//       if (err.response?.status === 429) {
//         setQuotaError(true);
//         onResults([]);
//       }
//       console.error(err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === 'Enter') performSearch(query);
//   };

//   // Also allow clicking the search icon to trigger search
//   const handleIconClick = () => performSearch(query);

//   return (
//     <div className="search-container">
//       <div style={{ position: 'relative' }}>
//         {/* Clickable search icon */}
//         <Search
//           onClick={handleIconClick}
//           style={{
//             position: 'absolute', left: '15px', top: '12px',
//             color: loading ? '#1db954' : '#b3b3b3',
//             cursor: 'pointer',
//             transition: 'color 0.2s'
//           }}
//           size={20}
//         />
//         <input
//           type="text"
//           className="search-input"
//           placeholder="Search for songs or artists... (press Enter)"
//           value={query}
//           onChange={(e) => {
//             setQuery(e.target.value);
//             setQuotaError(false);
//           }}
//           onKeyDown={handleKeyDown}
//           style={{ paddingLeft: '45px' }}
//         />
//         {/* Loading spinner text */}
//         {loading && (
//           <span style={{
//             position: 'absolute', right: '15px', top: '12px',
//             color: '#1db954', fontSize: '0.8rem'
//           }}>
//             Searching...
//           </span>
//         )}
//       </div>

//       {/* Quota exceeded warning */}
//       {quotaError && (
//         <div style={{
//           marginTop: '10px', padding: '10px 16px',
//           background: '#2a1a1a', border: '1px solid #ff4444',
//           borderRadius: '8px', color: '#ff6666', fontSize: '0.85rem'
//         }}>
//           ⚠️ Daily search limit reached. Try again tomorrow, or play songs from your Library.
//         </div>
//       )}

//       {/* Hint text */}
//       <div style={{ marginTop: '8px', color: '#666', fontSize: '0.78rem', paddingLeft: '4px' }}>
//         Tip: Press <kbd style={{
//           background: '#333', padding: '1px 6px',
//           borderRadius: '4px', fontSize: '0.75rem', color: '#ccc'
//         }}>Enter</kbd> to search
//       </div>
//     </div>
//   );
// };

// export default SearchBar;


// searchroute.js and searchabr and .evn updated for youtube api and search functionality

// import React, { useState, useEffect } from 'react';
// import axios from 'axios';
// import { Search } from 'lucide-react';

// const SearchBar = ({ onResults }) => {
//   const [query, setQuery] = useState('');

//   useEffect(() => {
//     const delayDebounceFn = setTimeout(() => {
//       if (query) {
//         performSearch();
//       }
//     }, 500);

//     return () => clearTimeout(delayDebounceFn);
//   }, [query]);

//   const performSearch = async () => {
//     try {
//       const { data } = await axios.get(`/api/search?q=${query}`);
//       onResults(data);
//     } catch (err) {
//       console.error(err);
//     }
//   };

//   return (
//     <div className="search-container">
//       <div style={{ position: 'relative' }}>
//         <Search style={{ position: 'absolute', left: '15px', top: '12px', color: '#b3b3b3' }} size={20} />
//         <input
//           type="text"
//           className="search-input"
//           placeholder="Search for songs or artists..."
//           value={query}
//           onChange={(e) => setQuery(e.target.value)}
//           style={{ paddingLeft: '45px' }}
//         />
//       </div>
//     </div>
//   );
// };

// export default SearchBar;
