import React, { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import SearchBar from '../components/SearchBar';
import SongList from '../components/SongList';
import { MusicContext } from '../context/MusicContext';
import { AuthContext } from '../context/AuthContext';
import { Sparkles, TrendingUp, Plus, X, RefreshCw } from 'lucide-react';

// ── Save Playlist Modal ────────────────────────────────────────────
const SaveModal = ({ songs, defaultName, onClose, onSave }) => {
  const [name, setName]       = useState(defaultName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSave = async () => {
    if (!name.trim()) return setError('Enter a playlist name');
    setLoading(true);
    try { await onSave(name.trim(), songs); onClose(); }
    catch (err) { setError(err.message || 'Failed to save'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
    }}>
      <div style={{
        background: '#1e1e1e', borderRadius: '12px',
        padding: '28px', width: '100%', maxWidth: '360px',
        border: '1px solid #333', position: 'relative'
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '14px', right: '14px',
          background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer'
        }}><X size={18} /></button>

        <h3 style={{ margin: '0 0 8px' }}>Save as Playlist</h3>
        <p style={{ color: '#b3b3b3', fontSize: '0.85rem', margin: '0 0 18px' }}>
          {songs.length} songs will be added
        </p>
        {error && <p style={{ color: '#ff4444', fontSize: '0.82rem', margin: '0 0 10px' }}>{error}</p>}
        <input
          autoFocus type="text" value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Playlist name..."
          style={{
            width: '100%', padding: '11px', borderRadius: '8px',
            border: '1px solid #444', background: '#121212',
            color: 'white', fontSize: '0.95rem',
            boxSizing: 'border-box', marginBottom: '14px', outline: 'none'
          }}
        />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '11px', borderRadius: '8px',
            background: 'transparent', border: '1px solid #333',
            color: '#b3b3b3', cursor: 'pointer', fontWeight: 600
          }}>Cancel</button>
          <button onClick={handleSave} disabled={loading} style={{
            flex: 2, padding: '11px', borderRadius: '8px',
            background: '#1db954', border: 'none',
            color: 'white', cursor: 'pointer', fontWeight: 700
          }}>
            {loading ? 'Saving...' : 'Save to Library'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Section header ─────────────────────────────────────────────────
const SectionHeader = ({ icon, title, subtitle, subtitleShort, songs, onSave, onRefresh, loading }) => (
  <div style={{ marginBottom: '16px' }}>
    {/* Title row */}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {icon}
        <h2 style={{
          margin: 0,
          fontSize: 'clamp(0.95rem, 3vw, 1.25rem)',
          fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{title}</h2>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading} style={{
            background: 'transparent', border: '1px solid #333', borderRadius: '20px',
            padding: '5px 10px', color: '#b3b3b3', cursor: 'pointer', fontSize: '0.72rem',
            display: 'flex', alignItems: 'center', gap: '3px'
          }}>
            <RefreshCw size={11} /> Refresh
          </button>
        )}
        {onSave && songs?.length > 0 && (
          <button onClick={onSave} style={{
            background: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.4)',
            borderRadius: '20px', padding: '5px 10px', color: '#1db954',
            cursor: 'pointer', fontSize: '0.72rem',
            display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600
          }}>
            <Plus size={11} /> Save
          </button>
        )}
      </div>
    </div>
    {/* Subtitle — short version on small screens, full on larger */}
    {(subtitle || subtitleShort) && (
      <p style={{
        margin: '4px 0 0 28px', color: '#b3b3b3',
        fontSize: '0.78rem', lineHeight: 1.4,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
      }}>
        {subtitle || subtitleShort}
      </p>
    )}
  </div>
);

// ── Main HomePage ──────────────────────────────────────────────────
const HomePage = () => {
  const [results, setResults]         = useState([]);
  const [suggestions, setSuggestions] = useState({ type: 'random', songs: [] });
  const [smartPlaylist, setSmartPlaylist] = useState(null); // { title, songs, reason }
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [loadingSmart, setLoadingSmart] = useState(false);
  const [saveModal, setSaveModal]     = useState(null);
  const [saveSuccess, setSaveSuccess] = useState('');

  const [showFullPlaylist, setShowFullPlaylist] = useState(false);
  const { user }                      = useContext(AuthContext);

  // Use ref to always access latest user token — avoids stale closures on refresh
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const getHeaders = () => {
    const u = userRef.current;
    return u ? { Authorization: `Bearer ${u.token}` } : {};
  };

  const fetchSuggestions = async (refresh = false) => {
    setLoadingSugg(true);
    try {
      // On refresh, exclude currently shown songs so user gets different ones
      const params = {};
      if (refresh) {
        setSuggestions(prev => {
          if (prev.songs?.length > 0) {
            params.exclude = prev.songs.map(s => s._id).join(',');
          }
          return prev;
        });
      }
      const { data } = await axios.get('/api/search/suggestions', {
        headers: getHeaders(),
        params
      });
      setSuggestions(data);
    } catch (err) {
      console.error('Suggestions error:', err);
    } finally { setLoadingSugg(false); }
  };

  const fetchSmartPlaylist = async () => {
    if (!userRef.current) return;
    setLoadingSmart(true);
    try {
      const { data } = await axios.get('/api/search/smart-playlist', { headers: getHeaders() });
      setSmartPlaylist(data);
    } catch (err) {
      console.error('Smart playlist error:', err);
    } finally { setLoadingSmart(false); }
  };

  useEffect(() => {
    fetchSuggestions();
    fetchSmartPlaylist();
  }, [user]); // eslint-disable-line

  // Save playlist to library
  const handleSavePlaylist = async (name, songs) => {
    if (!user) throw new Error('Please login to save playlists');
    await axios.post('/api/playlists/create', { title: name }, { headers: getHeaders() });
    await Promise.all(songs.map(song =>
      axios.post('/api/playlists/add',
        { songId: song._id, playlistTitle: name },
        { headers: getHeaders() }
      )
    ));
    setSaveSuccess(`"${name}" saved to your Library! ✅`);
    setTimeout(() => setSaveSuccess(''), 4000);
  };

  const showingSuggestions = results.length === 0;

  return (
    <div className="main-content">
      <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '20px', fontWeight: 800 }}>
        Discover Music
      </h1>

      <SearchBar onResults={setResults} />

      {/* Save success toast */}
      {saveSuccess && (
        <div style={{
          position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
          background: '#1db954', color: 'white', padding: '12px 24px',
          borderRadius: '24px', fontWeight: 600, fontSize: '0.9rem',
          zIndex: 2999, boxShadow: '0 4px 20px rgba(29,185,84,0.4)'
        }}>
          {saveSuccess}
        </div>
      )}

      {/* ── Search results ── */}
      {results.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <SectionHeader
            icon={<TrendingUp size={20} color="#1db954" />}
            title="Search Results"
            songs={results}
            onSave={user ? () => setSaveModal({ songs: results, defaultName: 'My Search Mix' }) : null}
          />
          <SongList songs={results} queue={results} />
        </div>
      )}

      {/* ── Suggestions (shown when no search results) ── */}
      {showingSuggestions && (
        <>
          {/* Smart Playlist — logged-in users only */}
          {user && smartPlaylist?.songs?.length > 0 && (
            <div style={{ marginBottom: '40px' }}>
              <SectionHeader
                icon={<Sparkles size={20} color="#1db954" />}
                title={smartPlaylist.title}
                subtitle={smartPlaylist.reason}
                subtitleShort={`${smartPlaylist.songs?.length} songs based on your history`}
                songs={smartPlaylist.songs}
                onSave={() => setSaveModal({ songs: smartPlaylist.songs, defaultName: smartPlaylist.title })}
                onRefresh={() => { fetchSmartPlaylist(); setShowFullPlaylist(false); }}
                loading={loadingSmart}
              />
              {/* Show only 8 songs initially */}
              <SongList
                songs={showFullPlaylist ? smartPlaylist.songs : smartPlaylist.songs.slice(0, 8)}
                queue={smartPlaylist.songs}
              />
              {/* Show more / less button */}
              {smartPlaylist.songs.length > 8 && (
                <button
                  onClick={() => setShowFullPlaylist(prev => !prev)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    margin: '14px auto 0', padding: '9px 24px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid #333', borderRadius: '20px',
                    color: '#b3b3b3', cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 600,
                    transition: 'background 0.2s'
                  }}
                >
                  {showFullPlaylist
                    ? `Show Less`
                    : `Show ${smartPlaylist.songs.length - 8} More Songs`
                  }
                </button>
              )}
            </div>
          )}

          {/* Suggestions section */}
          <div style={{ marginBottom: '40px' }}>
            <SectionHeader
              icon={<TrendingUp size={20} color="#1db954" />}
              title={
                !user ? 'Suggested For You' :
                suggestions.type === 'personalized' ? 'More You Might Like' :
                'Trending Now'
              }
              subtitle={
                user && suggestions.type === 'personalized'
                  ? 'Based on your listening history'
                  : undefined
              }
              songs={suggestions.songs}
              onRefresh={() => fetchSuggestions(true)}
              loading={loadingSugg}
              onSave={user && suggestions.songs?.length > 0
                ? () => setSaveModal({ songs: suggestions.songs, defaultName: 'Suggested Mix' })
                : null
              }
            />
            {suggestions.songs?.length > 0
              ? <SongList songs={suggestions.songs} queue={suggestions.songs} />
              : <p style={{ color: '#b3b3b3' }}>
                  {loadingSugg ? 'Loading...' : 'No suggestions yet. Search for songs to get started!'}
                </p>
            }
          </div>

          {/* Login prompt for guests */}
          {!user && (
            <div style={{
              textAlign: 'center', padding: '28px 20px',
              background: 'rgba(29,185,84,0.05)',
              border: '1px solid rgba(29,185,84,0.15)',
              borderRadius: '12px', marginTop: '8px'
            }}>
              <Sparkles size={28} color="#1db954" style={{ marginBottom: '10px' }} />
              <p style={{ color: '#fff', fontWeight: 700, margin: '0 0 6px' }}>
                Get personalized recommendations
              </p>
              <p style={{ color: '#b3b3b3', margin: '0 0 16px', fontSize: '0.88rem' }}>
                Log in and we'll suggest songs based on what you search and play
              </p>
              <a href="/login" style={{
                background: '#1db954', color: 'white',
                padding: '10px 28px', borderRadius: '20px',
                textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem'
              }}>Log In Free</a>
            </div>
          )}
        </>
      )}

      {/* Save modal */}
      {saveModal && (
        <SaveModal
          songs={saveModal.songs}
          defaultName={saveModal.defaultName}
          onClose={() => setSaveModal(null)}
          onSave={handleSavePlaylist}
        />
      )}
    </div>
  );
};

export default HomePage;

// refresh  button

// import React, { useState, useEffect, useContext, useRef } from 'react';
// import axios from 'axios';
// import SearchBar from '../components/SearchBar';
// import SongList from '../components/SongList';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Sparkles, TrendingUp, Plus, X, RefreshCw } from 'lucide-react';

// // ── Save Playlist Modal ────────────────────────────────────────────
// const SaveModal = ({ songs, defaultName, onClose, onSave }) => {
//   const [name, setName]       = useState(defaultName || '');
//   const [loading, setLoading] = useState(false);
//   const [error, setError]     = useState('');

//   const handleSave = async () => {
//     if (!name.trim()) return setError('Enter a playlist name');
//     setLoading(true);
//     try { await onSave(name.trim(), songs); onClose(); }
//     catch (err) { setError(err.message || 'Failed to save'); }
//     finally { setLoading(false); }
//   };

//   return (
//     <div style={{
//       position: 'fixed', inset: 0, zIndex: 3000,
//       background: 'rgba(0,0,0,0.8)',
//       display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
//     }}>
//       <div style={{
//         background: '#1e1e1e', borderRadius: '12px',
//         padding: '28px', width: '100%', maxWidth: '360px',
//         border: '1px solid #333', position: 'relative'
//       }}>
//         <button onClick={onClose} style={{
//           position: 'absolute', top: '14px', right: '14px',
//           background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer'
//         }}><X size={18} /></button>

//         <h3 style={{ margin: '0 0 8px' }}>Save as Playlist</h3>
//         <p style={{ color: '#b3b3b3', fontSize: '0.85rem', margin: '0 0 18px' }}>
//           {songs.length} songs will be added
//         </p>
//         {error && <p style={{ color: '#ff4444', fontSize: '0.82rem', margin: '0 0 10px' }}>{error}</p>}
//         <input
//           autoFocus type="text" value={name}
//           onChange={e => { setName(e.target.value); setError(''); }}
//           onKeyDown={e => e.key === 'Enter' && handleSave()}
//           placeholder="Playlist name..."
//           style={{
//             width: '100%', padding: '11px', borderRadius: '8px',
//             border: '1px solid #444', background: '#121212',
//             color: 'white', fontSize: '0.95rem',
//             boxSizing: 'border-box', marginBottom: '14px', outline: 'none'
//           }}
//         />
//         <div style={{ display: 'flex', gap: '10px' }}>
//           <button onClick={onClose} style={{
//             flex: 1, padding: '11px', borderRadius: '8px',
//             background: 'transparent', border: '1px solid #333',
//             color: '#b3b3b3', cursor: 'pointer', fontWeight: 600
//           }}>Cancel</button>
//           <button onClick={handleSave} disabled={loading} style={{
//             flex: 2, padding: '11px', borderRadius: '8px',
//             background: '#1db954', border: 'none',
//             color: 'white', cursor: 'pointer', fontWeight: 700
//           }}>
//             {loading ? 'Saving...' : 'Save to Library'}
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// // ── Section header ─────────────────────────────────────────────────
// const SectionHeader = ({ icon, title, subtitle, subtitleShort, songs, onSave, onRefresh, loading }) => (
//   <div style={{ marginBottom: '16px' }}>
//     {/* Title row */}
//     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
//       <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
//         {icon}
//         <h2 style={{
//           margin: 0,
//           fontSize: 'clamp(0.95rem, 3vw, 1.25rem)',
//           fontWeight: 700,
//           whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
//         }}>{title}</h2>
//       </div>
//       <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
//         {onRefresh && (
//           <button onClick={onRefresh} disabled={loading} style={{
//             background: 'transparent', border: '1px solid #333', borderRadius: '20px',
//             padding: '5px 10px', color: '#b3b3b3', cursor: 'pointer', fontSize: '0.72rem',
//             display: 'flex', alignItems: 'center', gap: '3px'
//           }}>
//             <RefreshCw size={11} /> Refresh
//           </button>
//         )}
//         {onSave && songs?.length > 0 && (
//           <button onClick={onSave} style={{
//             background: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.4)',
//             borderRadius: '20px', padding: '5px 10px', color: '#1db954',
//             cursor: 'pointer', fontSize: '0.72rem',
//             display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600
//           }}>
//             <Plus size={11} /> Save
//           </button>
//         )}
//       </div>
//     </div>
//     {/* Subtitle — short version on small screens, full on larger */}
//     {(subtitle || subtitleShort) && (
//       <p style={{
//         margin: '4px 0 0 28px', color: '#b3b3b3',
//         fontSize: '0.78rem', lineHeight: 1.4,
//         overflow: 'hidden', textOverflow: 'ellipsis',
//         display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
//       }}>
//         {subtitle || subtitleShort}
//       </p>
//     )}
//   </div>
// );

// // ── Main HomePage ──────────────────────────────────────────────────
// const HomePage = () => {
//   const [results, setResults]         = useState([]);
//   const [suggestions, setSuggestions] = useState({ type: 'random', songs: [] });
//   const [smartPlaylist, setSmartPlaylist] = useState(null); // { title, songs, reason }
//   const [loadingSugg, setLoadingSugg] = useState(false);
//   const [loadingSmart, setLoadingSmart] = useState(false);
//   const [saveModal, setSaveModal]     = useState(null);
//   const [saveSuccess, setSaveSuccess] = useState('');
//   const [showFullPlaylist, setShowFullPlaylist] = useState(false);
//   const { user }                      = useContext(AuthContext);

//   // Use ref to always access latest user token — avoids stale closures on refresh
//   const userRef = useRef(user);
//   useEffect(() => { userRef.current = user; }, [user]);

//   const getHeaders = () => {
//     const u = userRef.current;
//     return u ? { Authorization: `Bearer ${u.token}` } : {};
//   };

//   const fetchSuggestions = async () => {
//     setLoadingSugg(true);
//     try {
//       const { data } = await axios.get('/api/search/suggestions', { headers: getHeaders() });
//       setSuggestions(data);
//     } catch (err) {
//       console.error('Suggestions error:', err);
//     } finally { setLoadingSugg(false); }
//   };

//   const fetchSmartPlaylist = async () => {
//     if (!userRef.current) return;
//     setLoadingSmart(true);
//     try {
//       const { data } = await axios.get('/api/search/smart-playlist', { headers: getHeaders() });
//       setSmartPlaylist(data);
//     } catch (err) {
//       console.error('Smart playlist error:', err);
//     } finally { setLoadingSmart(false); }
//   };

//   useEffect(() => {
//     fetchSuggestions();
//     fetchSmartPlaylist();
//   }, [user]); // eslint-disable-line

//   // Save playlist to library
//   const handleSavePlaylist = async (name, songs) => {
//     if (!user) throw new Error('Please login to save playlists');
//     await axios.post('/api/playlists/create', { title: name }, { headers: getHeaders() });
//     await Promise.all(songs.map(song =>
//       axios.post('/api/playlists/add',
//         { songId: song._id, playlistTitle: name },
//         { headers: getHeaders() }
//       )
//     ));
//     setSaveSuccess(`"${name}" saved to your Library! ✅`);
//     setTimeout(() => setSaveSuccess(''), 4000);
//   };

//   const showingSuggestions = results.length === 0;

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '20px', fontWeight: 800 }}>
//         Discover Music
//       </h1>

//       <SearchBar onResults={setResults} />

//       {/* Save success toast */}
//       {saveSuccess && (
//         <div style={{
//           position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
//           background: '#1db954', color: 'white', padding: '12px 24px',
//           borderRadius: '24px', fontWeight: 600, fontSize: '0.9rem',
//           zIndex: 2999, boxShadow: '0 4px 20px rgba(29,185,84,0.4)'
//         }}>
//           {saveSuccess}
//         </div>
//       )}

//       {/* ── Search results ── */}
//       {results.length > 0 && (
//         <div style={{ marginBottom: '32px' }}>
//           <SectionHeader
//             icon={<TrendingUp size={20} color="#1db954" />}
//             title="Search Results"
//             songs={results}
//             onSave={user ? () => setSaveModal({ songs: results, defaultName: 'My Search Mix' }) : null}
//           />
//           <SongList songs={results} queue={results} />
//         </div>
//       )}

//       {/* ── Suggestions (shown when no search results) ── */}
//       {showingSuggestions && (
//         <>
//           {/* Smart Playlist — logged-in users only */}
//           {user && smartPlaylist?.songs?.length > 0 && (
//             <div style={{ marginBottom: '40px' }}>
//               <SectionHeader
//                 icon={<Sparkles size={20} color="#1db954" />}
//                 title={smartPlaylist.title}
//                 subtitle={smartPlaylist.reason}
//                 subtitleShort={`${smartPlaylist.songs?.length} songs based on your history`}
//                 songs={smartPlaylist.songs}
//                 onSave={() => setSaveModal({ songs: smartPlaylist.songs, defaultName: smartPlaylist.title })}
//                 onRefresh={() => { fetchSmartPlaylist(); setShowFullPlaylist(false); }}
//                 loading={loadingSmart}
//               />
//               {/* Show only 8 songs initially */}
//               <SongList
//                 songs={showFullPlaylist ? smartPlaylist.songs : smartPlaylist.songs.slice(0, 8)}
//                 queue={smartPlaylist.songs}
//               />
//               {/* Show more / less button */}
//               {smartPlaylist.songs.length > 8 && (
//                 <button
//                   onClick={() => setShowFullPlaylist(prev => !prev)}
//                   style={{
//                     display: 'flex', alignItems: 'center', gap: '8px',
//                     margin: '14px auto 0', padding: '9px 24px',
//                     background: 'rgba(255,255,255,0.06)',
//                     border: '1px solid #333', borderRadius: '20px',
//                     color: '#b3b3b3', cursor: 'pointer',
//                     fontSize: '0.85rem', fontWeight: 600,
//                     transition: 'background 0.2s'
//                   }}
//                 >
//                   {showFullPlaylist
//                     ? `Show Less`
//                     : `Show ${smartPlaylist.songs.length - 8} More Songs`
//                   }
//                 </button>
//               )}
//             </div>
//           )}

//           {/* Suggestions section */}
//           <div style={{ marginBottom: '40px' }}>
//             <SectionHeader
//               icon={<TrendingUp size={20} color="#1db954" />}
//               title={
//                 !user ? 'Suggested For You' :
//                 suggestions.type === 'personalized' ? 'More You Might Like' :
//                 'Trending Now'
//               }
//               subtitle={
//                 user && suggestions.type === 'personalized'
//                   ? 'Based on your listening history'
//                   : undefined
//               }
//               songs={suggestions.songs}
//               onRefresh={fetchSuggestions}
//               loading={loadingSugg}
//               onSave={user && suggestions.songs?.length > 0
//                 ? () => setSaveModal({ songs: suggestions.songs, defaultName: 'Suggested Mix' })
//                 : null
//               }
//             />
//             {suggestions.songs?.length > 0
//               ? <SongList songs={suggestions.songs} queue={suggestions.songs} />
//               : <p style={{ color: '#b3b3b3' }}>
//                   {loadingSugg ? 'Loading...' : 'No suggestions yet. Search for songs to get started!'}
//                 </p>
//             }
//           </div>

//           {/* Login prompt for guests */}
//           {!user && (
//             <div style={{
//               textAlign: 'center', padding: '28px 20px',
//               background: 'rgba(29,185,84,0.05)',
//               border: '1px solid rgba(29,185,84,0.15)',
//               borderRadius: '12px', marginTop: '8px'
//             }}>
//               <Sparkles size={28} color="#1db954" style={{ marginBottom: '10px' }} />
//               <p style={{ color: '#fff', fontWeight: 700, margin: '0 0 6px' }}>
//                 Get personalized recommendations
//               </p>
//               <p style={{ color: '#b3b3b3', margin: '0 0 16px', fontSize: '0.88rem' }}>
//                 Log in and we'll suggest songs based on what you search and play
//               </p>
//               <a href="/login" style={{
//                 background: '#1db954', color: 'white',
//                 padding: '10px 28px', borderRadius: '20px',
//                 textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem'
//               }}>Log In Free</a>
//             </div>
//           )}
//         </>
//       )}

//       {/* Save modal */}
//       {saveModal && (
//         <SaveModal
//           songs={saveModal.songs}
//           defaultName={saveModal.defaultName}
//           onClose={() => setSaveModal(null)}
//           onSave={handleSavePlaylist}
//         />
//       )}
//     </div>
//   );
// };

// export default HomePage;


//refresh and repeat button



// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import SearchBar from '../components/SearchBar';
// import SongList from '../components/SongList';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Sparkles, TrendingUp, Plus, X, RefreshCw } from 'lucide-react';

// // ── Save Playlist Modal ────────────────────────────────────────────
// const SaveModal = ({ songs, defaultName, onClose, onSave }) => {
//   const [name, setName]       = useState(defaultName || '');
//   const [loading, setLoading] = useState(false);
//   const [error, setError]     = useState('');
// //  const [showFullPlaylist, setShowFullPlaylist] = useState(false);
//   const handleSave = async () => {
//     if (!name.trim()) return setError('Enter a playlist name');
//     setLoading(true);
//     try { await onSave(name.trim(), songs); onClose(); }
//     catch (err) { setError(err.message || 'Failed to save'); }
//     finally { setLoading(false); }
//   };

//   return (
//     <div style={{
//       position: 'fixed', inset: 0, zIndex: 3000,
//       background: 'rgba(0,0,0,0.8)',
//       display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
//     }}>
//       <div style={{
//         background: '#1e1e1e', borderRadius: '12px',
//         padding: '28px', width: '100%', maxWidth: '360px',
//         border: '1px solid #333', position: 'relative'
//       }}>
//         <button onClick={onClose} style={{
//           position: 'absolute', top: '14px', right: '14px',
//           background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer'
//         }}><X size={18} /></button>

//         <h3 style={{ margin: '0 0 8px' }}>Save as Playlist</h3>
//         <p style={{ color: '#b3b3b3', fontSize: '0.85rem', margin: '0 0 18px' }}>
//           {songs.length} songs will be added
//         </p>
//         {error && <p style={{ color: '#ff4444', fontSize: '0.82rem', margin: '0 0 10px' }}>{error}</p>}
//         <input
//           autoFocus type="text" value={name}
//           onChange={e => { setName(e.target.value); setError(''); }}
//           onKeyDown={e => e.key === 'Enter' && handleSave()}
//           placeholder="Playlist name..."
//           style={{
//             width: '100%', padding: '11px', borderRadius: '8px',
//             border: '1px solid #444', background: '#121212',
//             color: 'white', fontSize: '0.95rem',
//             boxSizing: 'border-box', marginBottom: '14px', outline: 'none'
//           }}
//         />
//         <div style={{ display: 'flex', gap: '10px' }}>
//           <button onClick={onClose} style={{
//             flex: 1, padding: '11px', borderRadius: '8px',
//             background: 'transparent', border: '1px solid #333',
//             color: '#b3b3b3', cursor: 'pointer', fontWeight: 600
//           }}>Cancel</button>
//           <button onClick={handleSave} disabled={loading} style={{
//             flex: 2, padding: '11px', borderRadius: '8px',
//             background: '#1db954', border: 'none',
//             color: 'white', cursor: 'pointer', fontWeight: 700
//           }}>
//             {loading ? 'Saving...' : 'Save to Library'}
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// // ── Section header ─────────────────────────────────────────────────
// const SectionHeader = ({ icon, title, subtitle, subtitleShort, songs, onSave, onRefresh, loading }) => (
//   <div style={{ marginBottom: '16px' }}>
//     {/* Title row */}
//     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
//       <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
//         {icon}
//         <h2 style={{
//           margin: 0,
//           fontSize: 'clamp(0.95rem, 3vw, 1.25rem)',
//           fontWeight: 700,
//           whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
//         }}>{title}</h2>
//       </div>
//       <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
//         {onRefresh && (
//           <button onClick={onRefresh} disabled={loading} style={{
//             background: 'transparent', border: '1px solid #333', borderRadius: '20px',
//             padding: '5px 10px', color: '#b3b3b3', cursor: 'pointer', fontSize: '0.72rem',
//             display: 'flex', alignItems: 'center', gap: '3px'
//           }}>
//             <RefreshCw size={11} /> Refresh
//           </button>
//         )}
//         {onSave && songs?.length > 0 && (
//           <button onClick={onSave} style={{
//             background: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.4)',
//             borderRadius: '20px', padding: '5px 10px', color: '#1db954',
//             cursor: 'pointer', fontSize: '0.72rem',
//             display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600
//           }}>
//             <Plus size={11} /> Save
//           </button>
//         )}
//       </div>
//     </div>
//     {/* Subtitle — short version on small screens, full on larger */}
//     {(subtitle || subtitleShort) && (
//       <p style={{
//         margin: '4px 0 0 28px', color: '#b3b3b3',
//         fontSize: '0.78rem', lineHeight: 1.4,
//         overflow: 'hidden', textOverflow: 'ellipsis',
//         display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
//       }}>
//         {subtitle || subtitleShort}
//       </p>
//     )}
//   </div>
// );

// // ── Main HomePage ──────────────────────────────────────────────────
// const HomePage = () => {
//   const [results, setResults]         = useState([]);
//   const [suggestions, setSuggestions] = useState({ type: 'random', songs: [] });
//   const [smartPlaylist, setSmartPlaylist] = useState(null); // { title, songs, reason }
//   const [loadingSugg, setLoadingSugg] = useState(false);
//   const [loadingSmart, setLoadingSmart] = useState(false);
//   const [saveModal, setSaveModal]     = useState(null);
//   const [saveSuccess, setSaveSuccess] = useState('');
//   const [showFullPlaylist, setShowFullPlaylist] = useState(false);
//   const { user }                      = useContext(AuthContext);
  

//   // Simple header getter — not memoized to avoid stale closures
//   const getHeaders = () => user ? { Authorization: `Bearer ${user.token}` } : {};

//   // Fetch suggestions
//   const fetchSuggestions = async () => {
//     setLoadingSugg(true);
//     try {
//       const { data } = await axios.get('/api/search/suggestions', { headers: getHeaders() });
//       setSuggestions(data);
//     } catch (err) {
//       console.error('Suggestions error:', err);
//     } finally { setLoadingSugg(false); }
//   };

//   // Fetch smart playlist (logged-in only)
//   const fetchSmartPlaylist = async () => {
//     if (!user) return;
//     setLoadingSmart(true);
//     try {
//       const { data } = await axios.get('/api/search/smart-playlist', { headers: getHeaders() });
//       setSmartPlaylist(data);
//     } catch (err) {
//       console.error('Smart playlist error:', err);
//     } finally { setLoadingSmart(false); }
//   };

//   useEffect(() => {
//     fetchSuggestions();
//     fetchSmartPlaylist();
//   }, [user]); // eslint-disable-line

//   // Save playlist to library
//   const handleSavePlaylist = async (name, songs) => {
//     if (!user) throw new Error('Please login to save playlists');
//     await axios.post('/api/playlists/create', { title: name }, { headers: getHeaders() });
//     await Promise.all(songs.map(song =>
//       axios.post('/api/playlists/add',
//         { songId: song._id, playlistTitle: name },
//         { headers: getHeaders() }
//       )
//     ));
//     setSaveSuccess(`"${name}" saved to your Library! ✅`);
//     setTimeout(() => setSaveSuccess(''), 4000);
//   };

//   const showingSuggestions = results.length === 0;

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '20px', fontWeight: 800 }}>
//         Discover Music
//       </h1>

//       <SearchBar onResults={setResults} />

//       {/* Save success toast */}
//       {saveSuccess && (
//         <div style={{
//           position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
//           background: '#1db954', color: 'white', padding: '12px 24px',
//           borderRadius: '24px', fontWeight: 600, fontSize: '0.9rem',
//           zIndex: 2999, boxShadow: '0 4px 20px rgba(29,185,84,0.4)'
//         }}>
//           {saveSuccess}
//         </div>
//       )}

//       {/* ── Search results ── */}
//       {results.length > 0 && (
//         <div style={{ marginBottom: '32px' }}>
//           <SectionHeader
//             icon={<TrendingUp size={20} color="#1db954" />}
//             title="Search Results"
//             songs={results}
//             onSave={user ? () => setSaveModal({ songs: results, defaultName: 'My Search Mix' }) : null}
//           />
//           <SongList songs={results} queue={results} />
//         </div>
//       )}

//       {/* ── Suggestions (shown when no search results) ── */}
//       {showingSuggestions && (
//         <>
//           {/* Smart Playlist — logged-in users only */}
//           {user && smartPlaylist?.songs?.length > 0 && (
//             <div style={{ marginBottom: '40px' }}>
//               <SectionHeader
//                 icon={<Sparkles size={20} color="#1db954" />}
//                 title={smartPlaylist.title}
//                 subtitle={smartPlaylist.reason}
//                 subtitleShort={`${smartPlaylist.songs?.length} songs based on your history`}
//                 songs={smartPlaylist.songs}
//                 onSave={() => setSaveModal({ songs: smartPlaylist.songs, defaultName: smartPlaylist.title })}
//                 onRefresh={() => { fetchSmartPlaylist(); setShowFullPlaylist(false); }}
//                 loading={loadingSmart}
//               />
//               {/* Show only 8 songs initially */}
//               <SongList
//                 songs={showFullPlaylist ? smartPlaylist.songs : smartPlaylist.songs.slice(0, 8)}
//                 queue={smartPlaylist.songs}
//               />
//               {/* Show more / less button */}
//               {smartPlaylist.songs.length > 8 && (
//                 <button
//                   onClick={() => setShowFullPlaylist(prev => !prev)}
//                   style={{
//                     display: 'flex', alignItems: 'center', gap: '8px',
//                     margin: '14px auto 0', padding: '9px 24px',
//                     background: 'rgba(255,255,255,0.06)',
//                     border: '1px solid #333', borderRadius: '20px',
//                     color: '#b3b3b3', cursor: 'pointer',
//                     fontSize: '0.85rem', fontWeight: 600,
//                     transition: 'background 0.2s'
//                   }}
//                 >
//                   {showFullPlaylist
//                     ? `Show Less`
//                     : `Show ${smartPlaylist.songs.length - 8} More Songs`
//                   }
//                 </button>
//               )}
//             </div>
//           )}

//           {/* Suggestions section */}
//           <div style={{ marginBottom: '40px' }}>
//             <SectionHeader
//               icon={<TrendingUp size={20} color="#1db954" />}
//               title={
//                 !user ? 'Suggested For You' :
//                 suggestions.type === 'personalized' ? 'More You Might Like' :
//                 'Trending Now'
//               }
//               subtitle={
//                 user && suggestions.type === 'personalized'
//                   ? 'Based on your listening history'
//                   : undefined
//               }
//               songs={suggestions.songs}
//               onRefresh={fetchSuggestions}
//               loading={loadingSugg}
//               onSave={user && suggestions.songs?.length > 0
//                 ? () => setSaveModal({ songs: suggestions.songs, defaultName: 'Suggested Mix' })
//                 : null
//               }
//             />
//             {suggestions.songs?.length > 0
//               ? <SongList songs={suggestions.songs} queue={suggestions.songs} />
//               : <p style={{ color: '#b3b3b3' }}>
//                   {loadingSugg ? 'Loading...' : 'No suggestions yet. Search for songs to get started!'}
//                 </p>
//             }
//           </div>

//           {/* Login prompt for guests */}
//           {!user && (
//             <div style={{
//               textAlign: 'center', padding: '28px 20px',
//               background: 'rgba(29,185,84,0.05)',
//               border: '1px solid rgba(29,185,84,0.15)',
//               borderRadius: '12px', marginTop: '8px'
//             }}>
//               <Sparkles size={28} color="#1db954" style={{ marginBottom: '10px' }} />
//               <p style={{ color: '#fff', fontWeight: 700, margin: '0 0 6px' }}>
//                 Get personalized recommendations
//               </p>
//               <p style={{ color: '#b3b3b3', margin: '0 0 16px', fontSize: '0.88rem' }}>
//                 Log in and we'll suggest songs based on what you search and play
//               </p>
//               <a href="/login" style={{
//                 background: '#1db954', color: 'white',
//                 padding: '10px 28px', borderRadius: '20px',
//                 textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem'
//               }}>Log In Free</a>
//             </div>
//           )}
//         </>
//       )}

//       {/* Save modal */}
//       {saveModal && (
//         <SaveModal
//           songs={saveModal.songs}
//           defaultName={saveModal.defaultName}
//           onClose={() => setSaveModal(null)}
//           onSave={handleSavePlaylist}
//         />
//       )}
//     </div>
//   );
// };

// export default HomePage;



// playerbar ,musiccontext,app.css homepage for show more option and repeat fix and phone size video



// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import SearchBar from '../components/SearchBar';
// import SongList from '../components/SongList';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Sparkles, TrendingUp, Plus, X, RefreshCw } from 'lucide-react';

// // ── Save Playlist Modal ────────────────────────────────────────────
// const SaveModal = ({ songs, defaultName, onClose, onSave }) => {
//   const [name, setName]       = useState(defaultName || '');
//   const [loading, setLoading] = useState(false);
//   const [error, setError]     = useState('');

//   const handleSave = async () => {
//     if (!name.trim()) return setError('Enter a playlist name');
//     setLoading(true);
//     try { await onSave(name.trim(), songs); onClose(); }
//     catch (err) { setError(err.message || 'Failed to save'); }
//     finally { setLoading(false); }
//   };

//   return (
//     <div style={{
//       position: 'fixed', inset: 0, zIndex: 3000,
//       background: 'rgba(0,0,0,0.8)',
//       display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
//     }}>
//       <div style={{
//         background: '#1e1e1e', borderRadius: '12px',
//         padding: '28px', width: '100%', maxWidth: '360px',
//         border: '1px solid #333', position: 'relative'
//       }}>
//         <button onClick={onClose} style={{
//           position: 'absolute', top: '14px', right: '14px',
//           background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer'
//         }}><X size={18} /></button>

//         <h3 style={{ margin: '0 0 8px' }}>Save as Playlist</h3>
//         <p style={{ color: '#b3b3b3', fontSize: '0.85rem', margin: '0 0 18px' }}>
//           {songs.length} songs will be added
//         </p>
//         {error && <p style={{ color: '#ff4444', fontSize: '0.82rem', margin: '0 0 10px' }}>{error}</p>}
//         <input
//           autoFocus type="text" value={name}
//           onChange={e => { setName(e.target.value); setError(''); }}
//           onKeyDown={e => e.key === 'Enter' && handleSave()}
//           placeholder="Playlist name..."
//           style={{
//             width: '100%', padding: '11px', borderRadius: '8px',
//             border: '1px solid #444', background: '#121212',
//             color: 'white', fontSize: '0.95rem',
//             boxSizing: 'border-box', marginBottom: '14px', outline: 'none'
//           }}
//         />
//         <div style={{ display: 'flex', gap: '10px' }}>
//           <button onClick={onClose} style={{
//             flex: 1, padding: '11px', borderRadius: '8px',
//             background: 'transparent', border: '1px solid #333',
//             color: '#b3b3b3', cursor: 'pointer', fontWeight: 600
//           }}>Cancel</button>
//           <button onClick={handleSave} disabled={loading} style={{
//             flex: 2, padding: '11px', borderRadius: '8px',
//             background: '#1db954', border: 'none',
//             color: 'white', cursor: 'pointer', fontWeight: 700
//           }}>
//             {loading ? 'Saving...' : 'Save to Library'}
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// // ── Section header ─────────────────────────────────────────────────
// const SectionHeader = ({ icon, title, subtitle, subtitleShort, songs, onSave, onRefresh, loading }) => (
//   <div style={{ marginBottom: '16px' }}>
//     {/* Title row */}
//     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
//       <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
//         {icon}
//         <h2 style={{
//           margin: 0,
//           fontSize: 'clamp(0.95rem, 3vw, 1.25rem)',
//           fontWeight: 700,
//           whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
//         }}>{title}</h2>
//       </div>
//       <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
//         {onRefresh && (
//           <button onClick={onRefresh} disabled={loading} style={{
//             background: 'transparent', border: '1px solid #333', borderRadius: '20px',
//             padding: '5px 10px', color: '#b3b3b3', cursor: 'pointer', fontSize: '0.72rem',
//             display: 'flex', alignItems: 'center', gap: '3px'
//           }}>
//             <RefreshCw size={11} /> Refresh
//           </button>
//         )}
//         {onSave && songs?.length > 0 && (
//           <button onClick={onSave} style={{
//             background: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.4)',
//             borderRadius: '20px', padding: '5px 10px', color: '#1db954',
//             cursor: 'pointer', fontSize: '0.72rem',
//             display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600
//           }}>
//             <Plus size={11} /> Save
//           </button>
//         )}
//       </div>
//     </div>
//     {/* Subtitle — short version on small screens, full on larger */}
//     {(subtitle || subtitleShort) && (
//       <p style={{
//         margin: '4px 0 0 28px', color: '#b3b3b3',
//         fontSize: '0.78rem', lineHeight: 1.4,
//         overflow: 'hidden', textOverflow: 'ellipsis',
//         display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
//       }}>
//         {subtitle || subtitleShort}
//       </p>
//     )}
//   </div>
// );

// // ── Main HomePage ──────────────────────────────────────────────────
// const HomePage = () => {
//   const [results, setResults]         = useState([]);
//   const [suggestions, setSuggestions] = useState({ type: 'random', songs: [] });
//   const [smartPlaylist, setSmartPlaylist] = useState(null); // { title, songs, reason }
//   const [loadingSugg, setLoadingSugg] = useState(false);
//   const [loadingSmart, setLoadingSmart] = useState(false);
//   const [saveModal, setSaveModal]     = useState(null);
//   const [saveSuccess, setSaveSuccess] = useState('');
//   const { user }                      = useContext(AuthContext);

//   // Simple header getter — not memoized to avoid stale closures
//   const getHeaders = () => user ? { Authorization: `Bearer ${user.token}` } : {};

//   // Fetch suggestions
//   const fetchSuggestions = async () => {
//     setLoadingSugg(true);
//     try {
//       const { data } = await axios.get('/api/search/suggestions', { headers: getHeaders() });
//       setSuggestions(data);
//     } catch (err) {
//       console.error('Suggestions error:', err);
//     } finally { setLoadingSugg(false); }
//   };

//   // Fetch smart playlist (logged-in only)
//   const fetchSmartPlaylist = async () => {
//     if (!user) return;
//     setLoadingSmart(true);
//     try {
//       const { data } = await axios.get('/api/search/smart-playlist', { headers: getHeaders() });
//       setSmartPlaylist(data);
//     } catch (err) {
//       console.error('Smart playlist error:', err);
//     } finally { setLoadingSmart(false); }
//   };

//   useEffect(() => {
//     fetchSuggestions();
//     fetchSmartPlaylist();
//   }, [user]); // eslint-disable-line

//   // Save playlist to library
//   const handleSavePlaylist = async (name, songs) => {
//     if (!user) throw new Error('Please login to save playlists');
//     await axios.post('/api/playlists/create', { title: name }, { headers: getHeaders() });
//     await Promise.all(songs.map(song =>
//       axios.post('/api/playlists/add',
//         { songId: song._id, playlistTitle: name },
//         { headers: getHeaders() }
//       )
//     ));
//     setSaveSuccess(`"${name}" saved to your Library! ✅`);
//     setTimeout(() => setSaveSuccess(''), 4000);
//   };

//   const showingSuggestions = results.length === 0;

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '20px', fontWeight: 800 }}>
//         Discover Music
//       </h1>

//       <SearchBar onResults={setResults} />

//       {/* Save success toast */}
//       {saveSuccess && (
//         <div style={{
//           position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
//           background: '#1db954', color: 'white', padding: '12px 24px',
//           borderRadius: '24px', fontWeight: 600, fontSize: '0.9rem',
//           zIndex: 2999, boxShadow: '0 4px 20px rgba(29,185,84,0.4)'
//         }}>
//           {saveSuccess}
//         </div>
//       )}

//       {/* ── Search results ── */}
//       {results.length > 0 && (
//         <div style={{ marginBottom: '32px' }}>
//           <SectionHeader
//             icon={<TrendingUp size={20} color="#1db954" />}
//             title="Search Results"
//             songs={results}
//             onSave={user ? () => setSaveModal({ songs: results, defaultName: 'My Search Mix' }) : null}
//           />
//           <SongList songs={results} queue={results} />
//         </div>
//       )}

//       {/* ── Suggestions (shown when no search results) ── */}
//       {showingSuggestions && (
//         <>
//           {/* Smart Playlist — logged-in users only */}
//           {user && smartPlaylist?.songs?.length > 0 && (
//             <div style={{ marginBottom: '40px' }}>
//               <SectionHeader
//                 icon={<Sparkles size={20} color="#1db954" />}
//                 title={smartPlaylist.title}
//                 subtitle={smartPlaylist.reason}
//                 subtitleShort={`${smartPlaylist.songs?.length} songs based on your history`}
//                 songs={smartPlaylist.songs}
//                 onSave={() => setSaveModal({ songs: smartPlaylist.songs, defaultName: smartPlaylist.title })}
//                 onRefresh={fetchSmartPlaylist}
//                 loading={loadingSmart}
//               />
//               <SongList songs={smartPlaylist.songs} queue={smartPlaylist.songs} />
//             </div>
//           )}

//           {/* Suggestions section */}
//           <div style={{ marginBottom: '40px' }}>
//             <SectionHeader
//               icon={<TrendingUp size={20} color="#1db954" />}
//               title={
//                 !user ? 'Suggested For You' :
//                 suggestions.type === 'personalized' ? 'More You Might Like' :
//                 'Trending Now'
//               }
//               subtitle={
//                 user && suggestions.type === 'personalized'
//                   ? 'Based on your listening history'
//                   : undefined
//               }
//               songs={suggestions.songs}
//               onRefresh={fetchSuggestions}
//               loading={loadingSugg}
//               onSave={user && suggestions.songs?.length > 0
//                 ? () => setSaveModal({ songs: suggestions.songs, defaultName: 'Suggested Mix' })
//                 : null
//               }
//             />
//             {suggestions.songs?.length > 0
//               ? <SongList songs={suggestions.songs} queue={suggestions.songs} />
//               : <p style={{ color: '#b3b3b3' }}>
//                   {loadingSugg ? 'Loading...' : 'No suggestions yet. Search for songs to get started!'}
//                 </p>
//             }
//           </div>

//           {/* Login prompt for guests */}
//           {!user && (
//             <div style={{
//               textAlign: 'center', padding: '28px 20px',
//               background: 'rgba(29,185,84,0.05)',
//               border: '1px solid rgba(29,185,84,0.15)',
//               borderRadius: '12px', marginTop: '8px'
//             }}>
//               <Sparkles size={28} color="#1db954" style={{ marginBottom: '10px' }} />
//               <p style={{ color: '#fff', fontWeight: 700, margin: '0 0 6px' }}>
//                 Get personalized recommendations
//               </p>
//               <p style={{ color: '#b3b3b3', margin: '0 0 16px', fontSize: '0.88rem' }}>
//                 Log in and we'll suggest songs based on what you search and play
//               </p>
//               <a href="/login" style={{
//                 background: '#1db954', color: 'white',
//                 padding: '10px 28px', borderRadius: '20px',
//                 textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem'
//               }}>Log In Free</a>
//             </div>
//           )}
//         </>
//       )}

//       {/* Save modal */}
//       {saveModal && (
//         <SaveModal
//           songs={saveModal.songs}
//           defaultName={saveModal.defaultName}
//           onClose={() => setSaveModal(null)}
//           onSave={handleSavePlaylist}
//         />
//       )}
//     </div>
//   );
// };

// export default HomePage;

//for phone size fit

// import React, { useState, useEffect, useContext, useCallback } from 'react';
// import axios from 'axios';
// import SearchBar from '../components/SearchBar';
// import SongList from '../components/SongList';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Sparkles, TrendingUp, Plus, X, RefreshCw } from 'lucide-react';

// // ── Save Playlist Modal ────────────────────────────────────────────
// const SaveModal = ({ songs, defaultName, onClose, onSave }) => {
//   const [name, setName]       = useState(defaultName || '');
//   const [loading, setLoading] = useState(false);
//   const [error, setError]     = useState('');

//   const handleSave = async () => {
//     if (!name.trim()) return setError('Enter a playlist name');
//     setLoading(true);
//     try { await onSave(name.trim(), songs); onClose(); }
//     catch (err) { setError(err.message || 'Failed to save'); }
//     finally { setLoading(false); }
//   };

//   return (
//     <div style={{
//       position: 'fixed', inset: 0, zIndex: 3000,
//       background: 'rgba(0,0,0,0.8)',
//       display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
//     }}>
//       <div style={{
//         background: '#1e1e1e', borderRadius: '12px',
//         padding: '28px', width: '100%', maxWidth: '360px',
//         border: '1px solid #333', position: 'relative'
//       }}>
//         <button onClick={onClose} style={{
//           position: 'absolute', top: '14px', right: '14px',
//           background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer'
//         }}><X size={18} /></button>

//         <h3 style={{ margin: '0 0 8px' }}>Save as Playlist</h3>
//         <p style={{ color: '#b3b3b3', fontSize: '0.85rem', margin: '0 0 18px' }}>
//           {songs.length} songs will be added
//         </p>
//         {error && <p style={{ color: '#ff4444', fontSize: '0.82rem', margin: '0 0 10px' }}>{error}</p>}
//         <input
//           autoFocus type="text" value={name}
//           onChange={e => { setName(e.target.value); setError(''); }}
//           onKeyDown={e => e.key === 'Enter' && handleSave()}
//           placeholder="Playlist name..."
//           style={{
//             width: '100%', padding: '11px', borderRadius: '8px',
//             border: '1px solid #444', background: '#121212',
//             color: 'white', fontSize: '0.95rem',
//             boxSizing: 'border-box', marginBottom: '14px', outline: 'none'
//           }}
//         />
//         <div style={{ display: 'flex', gap: '10px' }}>
//           <button onClick={onClose} style={{
//             flex: 1, padding: '11px', borderRadius: '8px',
//             background: 'transparent', border: '1px solid #333',
//             color: '#b3b3b3', cursor: 'pointer', fontWeight: 600
//           }}>Cancel</button>
//           <button onClick={handleSave} disabled={loading} style={{
//             flex: 2, padding: '11px', borderRadius: '8px',
//             background: '#1db954', border: 'none',
//             color: 'white', cursor: 'pointer', fontWeight: 700
//           }}>
//             {loading ? 'Saving...' : 'Save to Library'}
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// // ── Section header ─────────────────────────────────────────────────
// const SectionHeader = ({ icon, title, subtitle, songs, onSave, onRefresh, loading }) => (
//   <div style={{ marginBottom: '16px' }}>
//     <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
//       <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
//         {icon}
//         <div style={{ minWidth: 0 }}>
//           <h2 style={{ margin: 0, fontSize: 'clamp(1rem, 3vw, 1.25rem)', fontWeight: 700 }}>{title}</h2>
//           {subtitle && <p style={{ margin: '2px 0 0', color: '#b3b3b3', fontSize: '0.8rem' }}>{subtitle}</p>}
//         </div>
//       </div>
//       <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
//         {onRefresh && (
//           <button onClick={onRefresh} disabled={loading} style={{
//             background: 'transparent', border: '1px solid #333', borderRadius: '20px',
//             padding: '5px 11px', color: '#b3b3b3', cursor: 'pointer', fontSize: '0.75rem',
//             display: 'flex', alignItems: 'center', gap: '4px'
//           }}>
//             <RefreshCw size={12} /> Refresh
//           </button>
//         )}
//         {onSave && songs?.length > 0 && (
//           <button onClick={onSave} style={{
//             background: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.4)',
//             borderRadius: '20px', padding: '5px 12px', color: '#1db954',
//             cursor: 'pointer', fontSize: '0.75rem',
//             display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600
//           }}>
//             <Plus size={12} /> Save Playlist
//           </button>
//         )}
//       </div>
//     </div>
//   </div>
// );

// // ── Main HomePage ──────────────────────────────────────────────────
// const HomePage = () => {
//   const [results, setResults]         = useState([]);
//   const [suggestions, setSuggestions] = useState({ type: 'random', songs: [] });
//   const [smartPlaylist, setSmartPlaylist] = useState(null); // { title, songs, reason }
//   const [loadingSugg, setLoadingSugg] = useState(false);
//   const [loadingSmart, setLoadingSmart] = useState(false);
//   const [saveModal, setSaveModal]     = useState(null);
//   const [saveSuccess, setSaveSuccess] = useState('');
//   const { user }                      = useContext(AuthContext);

//   const headers = useCallback(() =>
//     user ? { Authorization: `Bearer ${user.token}` } : {}
//   , [user]);

//   // Fetch suggestions
//   const fetchSuggestions = useCallback(async () => {
//     setLoadingSugg(true);
//     try {
//       const { data } = await axios.get('/api/search/suggestions', { headers: headers() });
//       setSuggestions(data);
//     } catch {}
//     finally { setLoadingSugg(false); }
//   }, [user]);

//   // Fetch smart playlist (logged-in only)
//   const fetchSmartPlaylist = useCallback(async () => {
//     if (!user) return;
//     setLoadingSmart(true);
//     try {
//       const { data } = await axios.get('/api/search/smart-playlist', { headers: headers() });
//       setSmartPlaylist(data);
//     } catch {}
//     finally { setLoadingSmart(false); }
//   }, [user]);

//   useEffect(() => {
//     fetchSuggestions();
//     fetchSmartPlaylist();
//   }, [user]);

//   // Save playlist to library
//   const handleSavePlaylist = async (name, songs) => {
//     if (!user) throw new Error('Please login to save playlists');
//     await axios.post('/api/playlists/create', { title: name }, { headers: headers() });
//     await Promise.all(songs.map(song =>
//       axios.post('/api/playlists/add',
//         { songId: song._id, playlistTitle: name },
//         { headers: headers() }
//       )
//     ));
//     setSaveSuccess(`"${name}" saved to your Library! ✅`);
//     setTimeout(() => setSaveSuccess(''), 4000);
//   };

//   const showingSuggestions = results.length === 0;

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '20px', fontWeight: 800 }}>
//         Discover Music
//       </h1>

//       <SearchBar onResults={setResults} />

//       {/* Save success toast */}
//       {saveSuccess && (
//         <div style={{
//           position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
//           background: '#1db954', color: 'white', padding: '12px 24px',
//           borderRadius: '24px', fontWeight: 600, fontSize: '0.9rem',
//           zIndex: 2999, boxShadow: '0 4px 20px rgba(29,185,84,0.4)'
//         }}>
//           {saveSuccess}
//         </div>
//       )}

//       {/* ── Search results ── */}
//       {results.length > 0 && (
//         <div style={{ marginBottom: '32px' }}>
//           <SectionHeader
//             icon={<TrendingUp size={20} color="#1db954" />}
//             title="Search Results"
//             songs={results}
//             onSave={user ? () => setSaveModal({ songs: results, defaultName: 'My Search Mix' }) : null}
//           />
//           <SongList songs={results} queue={results} />
//         </div>
//       )}

//       {/* ── Suggestions (shown when no search results) ── */}
//       {showingSuggestions && (
//         <>
//           {/* Smart Playlist — logged-in users only */}
//           {user && smartPlaylist?.songs?.length > 0 && (
//             <div style={{ marginBottom: '40px' }}>
//               <SectionHeader
//                 icon={<Sparkles size={20} color="#1db954" />}
//                 title={smartPlaylist.title}
//                 subtitle={smartPlaylist.reason}
//                 songs={smartPlaylist.songs}
//                 onSave={() => setSaveModal({ songs: smartPlaylist.songs, defaultName: smartPlaylist.title })}
//                 onRefresh={fetchSmartPlaylist}
//                 loading={loadingSmart}
//               />
//               <SongList songs={smartPlaylist.songs} queue={smartPlaylist.songs} />
//             </div>
//           )}

//           {/* Suggestions section */}
//           <div style={{ marginBottom: '40px' }}>
//             <SectionHeader
//               icon={<TrendingUp size={20} color="#1db954" />}
//               title={
//                 !user ? 'Suggested For You' :
//                 suggestions.type === 'personalized' ? 'More You Might Like' :
//                 'Trending Now'
//               }
//               subtitle={
//                 user && suggestions.type === 'personalized'
//                   ? 'Based on your listening history'
//                   : undefined
//               }
//               songs={suggestions.songs}
//               onRefresh={fetchSuggestions}
//               loading={loadingSugg}
//               onSave={user && suggestions.songs?.length > 0
//                 ? () => setSaveModal({ songs: suggestions.songs, defaultName: 'Suggested Mix' })
//                 : null
//               }
//             />
//             {suggestions.songs?.length > 0
//               ? <SongList songs={suggestions.songs} queue={suggestions.songs} />
//               : <p style={{ color: '#b3b3b3' }}>
//                   {loadingSugg ? 'Loading...' : 'No suggestions yet. Search for songs to get started!'}
//                 </p>
//             }
//           </div>

//           {/* Login prompt for guests */}
//           {!user && (
//             <div style={{
//               textAlign: 'center', padding: '28px 20px',
//               background: 'rgba(29,185,84,0.05)',
//               border: '1px solid rgba(29,185,84,0.15)',
//               borderRadius: '12px', marginTop: '8px'
//             }}>
//               <Sparkles size={28} color="#1db954" style={{ marginBottom: '10px' }} />
//               <p style={{ color: '#fff', fontWeight: 700, margin: '0 0 6px' }}>
//                 Get personalized recommendations
//               </p>
//               <p style={{ color: '#b3b3b3', margin: '0 0 16px', fontSize: '0.88rem' }}>
//                 Log in and we'll suggest songs based on what you search and play
//               </p>
//               <a href="/login" style={{
//                 background: '#1db954', color: 'white',
//                 padding: '10px 28px', borderRadius: '20px',
//                 textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem'
//               }}>Log In Free</a>
//             </div>
//           )}
//         </>
//       )}

//       {/* Save modal */}
//       {saveModal && (
//         <SaveModal
//           songs={saveModal.songs}
//           defaultName={saveModal.defaultName}
//           onClose={() => setSaveModal(null)}
//           onSave={handleSavePlaylist}
//         />
//       )}
//     </div>
//   );
// };

// export default HomePage;

//  HomePage.js,searchroutes,searchbar for vts suggestion



// import React, { useState } from 'react';
// import SearchBar from '../components/SearchBar';
// import SongList from '../components/SongList';

// const HomePage = () => {
//   const [results, setResults] = useState([]);

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '20px', fontWeight: 800 }}>
//         Discover Music
//       </h1>
//       <SearchBar onResults={setResults} />
//       {results.length > 0 && (
//         <>
//           <h2 style={{ fontSize: 'clamp(1rem, 3vw, 1.3rem)', marginBottom: '16px', color: 'var(--text-dim)' }}>
//             Search Results
//           </h2>
//           <SongList songs={results} />
//         </>
//       )}
//     </div>
//   );
// };

// export default HomePage;

///*updated app.css,homepage.librarypage,navbar,login page, signin page ,playebar
//for responsiveness*/


// import React, { useState } from 'react';
// import SearchBar from '../components/SearchBar';
// import SongList from '../components/SongList';

// const HomePage = () => {
//   const [results, setResults] = useState([]);

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: '2rem', marginBottom: '20px' }}>Discover Music</h1>
//       <SearchBar onResults={setResults} />
//       {results.length > 0 ? (
//         <SongList songs={results} />
//       ) : (
//         <div style={{ textAlign: 'center', marginTop: '100px', color: '#b3b3b3' }}>
//           <p>Search for your favorite tracks to start listening</p>
//         </div>
//       )}
//     </div>
//   );
// };

// export default HomePage;
