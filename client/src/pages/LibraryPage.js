import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { MusicContext } from '../context/MusicContext';
import SongList from '../components/SongList';
import { Plus, Trash2, X, Clock } from 'lucide-react';

const API = process.env.REACT_APP_API_URL || '';

const LibraryPage = () => {
  const [playlists, setPlaylists]         = useState([]);
  const [recentSongs, setRecentSongs]     = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [createError, setCreateError]     = useState('');
  const [activeSection, setActiveSection] = useState('recent'); // 'recent' | playlistId
  const { user } = useContext(AuthContext);
  const { playSong } = useContext(MusicContext);

  const headers = { Authorization: `Bearer ${user?.token}` };

  const fetchLibrary = async () => {
    try {
      const { data } = await axios.get(`${API}/api/playlists/my-library`, { headers });
      setPlaylists(data);
    } catch (err) { console.error(err); }
  };

  const fetchRecent = async () => {
    try {
      const { data } = await axios.get(`${API}/api/playlists/recently-played`, { headers });
      setRecentSongs(data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (user) { fetchLibrary(); fetchRecent(); }
  }, [user]);

  // ── Create playlist ───────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newPlaylistName.trim()) return setCreateError('Please enter a playlist name');
    try {
      await axios.post(`${API}/api/playlists/create`, { title: newPlaylistName }, { headers });
      setNewPlaylistName('');
      setShowCreateModal(false);
      setCreateError('');
      fetchLibrary();
    } catch (err) {
      console.error('Create playlist error:', err.response?.data || err.message);
      setCreateError(err.response?.data?.message || `Error: ${err.message}`);
    }
  };

  // ── Delete playlist ───────────────────────────────────────────────────
  const handleDeletePlaylist = async (playlistId) => {
    if (!window.confirm('Delete this playlist?')) return;
    try {
      await axios.delete(`${API}/api/playlists/delete/${playlistId}`, { headers });
      setPlaylists(prev => prev.filter(p => p._id !== playlistId));
      if (activeSection === playlistId) setActiveSection('recent');
    } catch (err) { console.error(err); }
  };

  // ── Remove song from playlist ─────────────────────────────────────────
  const handleRemoveSong = async (playlistId, songId) => {
    try {
      const { data } = await axios.delete(`${API}/api/playlists/remove-song`,
        { data: { playlistId, songId }, headers }
      );
      setPlaylists(prev => prev.map(p => p._id === playlistId ? data : p));
    } catch (err) { console.error(err); }
  };

  if (!user) return (
    <div className="main-content">
      <p style={{ color: '#b3b3b3' }}>Please login to view your library</p>
    </div>
  );

  const activePlaylist = playlists.find(p => p._id === activeSection);

  return (
    <div className="main-content library-layout" style={{
      display: 'flex',
      gap: '20px',
      padding: '16px',
      alignItems: 'flex-start'
    }}>
      <style>{`
        @media (max-width: 768px) {
          .library-sidebar { width: 100% !important; flex-direction: row !important; flex-wrap: wrap; }
          .library-sidebar > div { flex: 1; min-width: 140px; }
          .library-layout { flex-direction: column !important; }
        }
      `}</style>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
      <div className="library-sidebar" style={{
        width: '220px', flexShrink: 0,
        background: '#1e1e1e', borderRadius: '12px',
        padding: '16px', height: 'fit-content'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Your Library</span>
          <button
            onClick={() => setShowCreateModal(true)}
            title="Create playlist"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#b3b3b3', display: 'flex', alignItems: 'center'
            }}>
            <Plus size={18} />
          </button>
        </div>

        {/* Recently Played */}
        <div
          onClick={() => setActiveSection('recent')}
          style={{
            padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
            background: activeSection === 'recent' ? '#2a2a2a' : 'transparent',
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px'
          }}
        >
          <Clock size={16} color="#1db954" />
          <span style={{ fontSize: '0.9rem' }}>Recently Played</span>
        </div>

        {/* Playlists */}
        {playlists.map(playlist => (
          <div
            key={playlist._id}
            onClick={() => setActiveSection(playlist._id)}
            style={{
              padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
              background: activeSection === playlist._id ? '#2a2a2a' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '4px', gap: '8px'
            }}
          >
            <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {playlist.title}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeletePlaylist(playlist._id); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', flexShrink: 0 }}
              title="Delete playlist"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {playlists.length === 0 && (
          <p style={{ color: '#555', fontSize: '0.8rem', marginTop: '8px' }}>No playlists yet</p>
        )}
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <div style={{ flex: 1 }}>

        {/* Recently Played Section */}
        {activeSection === 'recent' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
              <Clock size={24} color="#1db954" />
              <h2 style={{ margin: 0 }}>Recently Played</h2>
            </div>
            {recentSongs.length === 0 ? (
              <p style={{ color: '#b3b3b3' }}>No recently played songs yet. Start listening!</p>
            ) : (
              <SongList songs={recentSongs} queue={recentSongs} />
            )}
          </div>
        )}

        {/* Playlist Section */}
        {activePlaylist && (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '24px', borderBottom: '1px solid #333', paddingBottom: '16px'
            }}>
              <div>
                <h2 style={{ margin: 0 }}>{activePlaylist.title}</h2>
                <span style={{ color: '#b3b3b3', fontSize: '0.85rem' }}>
                  {activePlaylist.songs.length} songs
                </span>
              </div>
              <button
                onClick={() => handleDeletePlaylist(activePlaylist._id)}
                style={{
                  background: '#2a2a2a', border: 'none', borderRadius: '8px',
                  padding: '8px 14px', cursor: 'pointer', color: '#ff4444',
                  display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem'
                }}
              >
                <Trash2 size={14} /> Delete Playlist
              </button>
            </div>
            {activePlaylist.songs.length === 0 ? (
              <p style={{ color: '#b3b3b3' }}>This playlist is empty. Add songs from the search page!</p>
            ) : (
              <SongList
                songs={activePlaylist.songs}
                queue={activePlaylist.songs}
                playlistId={activePlaylist._id}
                onRemoveSong={handleRemoveSong}
              />
            )}
          </div>
        )}
      </div>

      {/* ── CREATE PLAYLIST MODAL ─────────────────────────────────── */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#1e1e1e', borderRadius: '12px',
            padding: '28px', width: '360px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Create Playlist</h3>
              <button onClick={() => { setShowCreateModal(false); setCreateError(''); setNewPlaylistName(''); }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'white' }}>
                <X size={20} />
              </button>
            </div>
            <input
              type="text"
              placeholder="Playlist name..."
              value={newPlaylistName}
              onChange={e => { setNewPlaylistName(e.target.value); setCreateError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
              style={{
                width: '100%', padding: '12px', borderRadius: '8px',
                border: '1px solid #444', background: '#121212',
                color: 'white', fontSize: '1rem', boxSizing: 'border-box',
                marginBottom: '8px'
              }}
            />
            {createError && (
              <p style={{ color: '#ff4444', fontSize: '0.85rem', margin: '4px 0 12px' }}>{createError}</p>
            )}
            <button
              onClick={handleCreate}
              style={{
                width: '100%', padding: '12px', borderRadius: '8px',
                background: '#1db954', border: 'none', color: 'white',
                fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer',
                marginTop: '8px'
              }}
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryPage;


// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import { AuthContext } from '../context/AuthContext';
// import { MusicContext } from '../context/MusicContext';
// import SongList from '../components/SongList';
// import { Plus, Trash2, X, Clock } from 'lucide-react';

// const LibraryPage = () => {
//   const [playlists, setPlaylists]         = useState([]);
//   const [recentSongs, setRecentSongs]     = useState([]);
//   const [showCreateModal, setShowCreateModal] = useState(false);
//   const [newPlaylistName, setNewPlaylistName] = useState('');
//   const [createError, setCreateError]     = useState('');
//   const [activeSection, setActiveSection] = useState('recent'); // 'recent' | playlistId
//   const { user } = useContext(AuthContext);
//   const { playSong } = useContext(MusicContext);

//   const headers = { Authorization: `Bearer ${user?.token}` };

//   const fetchLibrary = async () => {
//     try {
//       const { data } = await axios.get('/api/playlists/my-library', { headers });
//       setPlaylists(data);
//     } catch (err) { console.error(err); }
//   };

//   const fetchRecent = async () => {
//     try {
//       const { data } = await axios.get('/api/playlists/recently-played', { headers });
//       setRecentSongs(data);
//     } catch (err) { console.error(err); }
//   };

//   useEffect(() => {
//     if (user) { fetchLibrary(); fetchRecent(); }
//   }, [user]);

//   // ── Create playlist ───────────────────────────────────────────────────
//   const handleCreate = async () => {
//     if (!newPlaylistName.trim()) return setCreateError('Please enter a playlist name');
//     try {
//       await axios.post('/api/playlists/create', { title: newPlaylistName }, { headers });
//       setNewPlaylistName('');
//       setShowCreateModal(false);
//       setCreateError('');
//       fetchLibrary();
//     } catch (err) {
//       console.error('Create playlist error:', err.response?.data || err.message);
//       setCreateError(err.response?.data?.message || `Error: ${err.message}`);
//     }
//   };

//   // ── Delete playlist ───────────────────────────────────────────────────
//   const handleDeletePlaylist = async (playlistId) => {
//     if (!window.confirm('Delete this playlist?')) return;
//     try {
//       await axios.delete(`/api/playlists/delete/${playlistId}`, { headers });
//       setPlaylists(prev => prev.filter(p => p._id !== playlistId));
//       if (activeSection === playlistId) setActiveSection('recent');
//     } catch (err) { console.error(err); }
//   };

//   // ── Remove song from playlist ─────────────────────────────────────────
//   const handleRemoveSong = async (playlistId, songId) => {
//     try {
//       const { data } = await axios.delete('/api/playlists/remove-song',
//         { data: { playlistId, songId }, headers }
//       );
//       setPlaylists(prev => prev.map(p => p._id === playlistId ? data : p));
//     } catch (err) { console.error(err); }
//   };

//   if (!user) return (
//     <div className="main-content">
//       <p style={{ color: '#b3b3b3' }}>Please login to view your library</p>
//     </div>
//   );

//   const activePlaylist = playlists.find(p => p._id === activeSection);

//   return (
//     <div className="main-content library-layout" style={{
//       display: 'flex',
//       gap: '20px',
//       padding: '16px',
//       alignItems: 'flex-start'
//     }}>
//       <style>{`
//         @media (max-width: 768px) {
//           .library-sidebar { width: 100% !important; flex-direction: row !important; flex-wrap: wrap; }
//           .library-sidebar > div { flex: 1; min-width: 140px; }
//           .library-layout { flex-direction: column !important; }
//         }
//       `}</style>

//       {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
//       <div className="library-sidebar" style={{
//         width: '220px', flexShrink: 0,
//         background: '#1e1e1e', borderRadius: '12px',
//         padding: '16px', height: 'fit-content'
//       }}>
//         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
//           <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Your Library</span>
//           <button
//             onClick={() => setShowCreateModal(true)}
//             title="Create playlist"
//             style={{
//               background: 'transparent', border: 'none', cursor: 'pointer',
//               color: '#b3b3b3', display: 'flex', alignItems: 'center'
//             }}>
//             <Plus size={18} />
//           </button>
//         </div>

//         {/* Recently Played */}
//         <div
//           onClick={() => setActiveSection('recent')}
//           style={{
//             padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
//             background: activeSection === 'recent' ? '#2a2a2a' : 'transparent',
//             display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px'
//           }}
//         >
//           <Clock size={16} color="#1db954" />
//           <span style={{ fontSize: '0.9rem' }}>Recently Played</span>
//         </div>

//         {/* Playlists */}
//         {playlists.map(playlist => (
//           <div
//             key={playlist._id}
//             onClick={() => setActiveSection(playlist._id)}
//             style={{
//               padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
//               background: activeSection === playlist._id ? '#2a2a2a' : 'transparent',
//               display: 'flex', alignItems: 'center', justifyContent: 'space-between',
//               marginBottom: '4px', gap: '8px'
//             }}
//           >
//             <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
//               {playlist.title}
//             </span>
//             <button
//               onClick={(e) => { e.stopPropagation(); handleDeletePlaylist(playlist._id); }}
//               style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', flexShrink: 0 }}
//               title="Delete playlist"
//             >
//               <Trash2 size={14} />
//             </button>
//           </div>
//         ))}

//         {playlists.length === 0 && (
//           <p style={{ color: '#555', fontSize: '0.8rem', marginTop: '8px' }}>No playlists yet</p>
//         )}
//       </div>

//       {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
//       <div style={{ flex: 1 }}>

//         {/* Recently Played Section */}
//         {activeSection === 'recent' && (
//           <div>
//             <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
//               <Clock size={24} color="#1db954" />
//               <h2 style={{ margin: 0 }}>Recently Played</h2>
//             </div>
//             {recentSongs.length === 0 ? (
//               <p style={{ color: '#b3b3b3' }}>No recently played songs yet. Start listening!</p>
//             ) : (
//               <SongList songs={recentSongs} queue={recentSongs} />
//             )}
//           </div>
//         )}

//         {/* Playlist Section */}
//         {activePlaylist && (
//           <div>
//             <div style={{
//               display: 'flex', alignItems: 'center', justifyContent: 'space-between',
//               marginBottom: '24px', borderBottom: '1px solid #333', paddingBottom: '16px'
//             }}>
//               <div>
//                 <h2 style={{ margin: 0 }}>{activePlaylist.title}</h2>
//                 <span style={{ color: '#b3b3b3', fontSize: '0.85rem' }}>
//                   {activePlaylist.songs.length} songs
//                 </span>
//               </div>
//               <button
//                 onClick={() => handleDeletePlaylist(activePlaylist._id)}
//                 style={{
//                   background: '#2a2a2a', border: 'none', borderRadius: '8px',
//                   padding: '8px 14px', cursor: 'pointer', color: '#ff4444',
//                   display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem'
//                 }}
//               >
//                 <Trash2 size={14} /> Delete Playlist
//               </button>
//             </div>
//             {activePlaylist.songs.length === 0 ? (
//               <p style={{ color: '#b3b3b3' }}>This playlist is empty. Add songs from the search page!</p>
//             ) : (
//               <SongList
//                 songs={activePlaylist.songs}
//                 queue={activePlaylist.songs}
//                 playlistId={activePlaylist._id}
//                 onRemoveSong={handleRemoveSong}
//               />
//             )}
//           </div>
//         )}
//       </div>

//       {/* ── CREATE PLAYLIST MODAL ─────────────────────────────────── */}
//       {showCreateModal && (
//         <div style={{
//           position: 'fixed', inset: 0, zIndex: 3000,
//           background: 'rgba(0,0,0,0.7)',
//           display: 'flex', alignItems: 'center', justifyContent: 'center'
//         }}>
//           <div style={{
//             background: '#1e1e1e', borderRadius: '12px',
//             padding: '28px', width: '360px'
//           }}>
//             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
//               <h3 style={{ margin: 0 }}>Create Playlist</h3>
//               <button onClick={() => { setShowCreateModal(false); setCreateError(''); setNewPlaylistName(''); }}
//                 style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'white' }}>
//                 <X size={20} />
//               </button>
//             </div>
//             <input
//               type="text"
//               placeholder="Playlist name..."
//               value={newPlaylistName}
//               onChange={e => { setNewPlaylistName(e.target.value); setCreateError(''); }}
//               onKeyDown={e => e.key === 'Enter' && handleCreate()}
//               autoFocus
//               style={{
//                 width: '100%', padding: '12px', borderRadius: '8px',
//                 border: '1px solid #444', background: '#121212',
//                 color: 'white', fontSize: '1rem', boxSizing: 'border-box',
//                 marginBottom: '8px'
//               }}
//             />
//             {createError && (
//               <p style={{ color: '#ff4444', fontSize: '0.85rem', margin: '4px 0 12px' }}>{createError}</p>
//             )}
//             <button
//               onClick={handleCreate}
//               style={{
//                 width: '100%', padding: '12px', borderRadius: '8px',
//                 background: '#1db954', border: 'none', color: 'white',
//                 fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer',
//                 marginTop: '8px'
//               }}
//             >
//               Create
//             </button>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default LibraryPage;





///*updated app.css,homepage.librarypage,navbar,login page, signin page ,playebar
//for responsiveness*/


// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import { AuthContext } from '../context/AuthContext';
// import { MusicContext } from '../context/MusicContext';
// import SongList from '../components/SongList';
// import { Plus, Trash2, X, Clock } from 'lucide-react';

// const LibraryPage = () => {
//   const [playlists, setPlaylists]         = useState([]);
//   const [recentSongs, setRecentSongs]     = useState([]);
//   const [showCreateModal, setShowCreateModal] = useState(false);
//   const [newPlaylistName, setNewPlaylistName] = useState('');
//   const [createError, setCreateError]     = useState('');
//   const [activeSection, setActiveSection] = useState('recent'); // 'recent' | playlistId
//   const { user } = useContext(AuthContext);
//   const { playSong } = useContext(MusicContext);

//   const headers = { Authorization: `Bearer ${user?.token}` };

//   const fetchLibrary = async () => {
//     try {
//       const { data } = await axios.get('/api/playlists/my-library', { headers });
//       setPlaylists(data);
//     } catch (err) { console.error(err); }
//   };

//   const fetchRecent = async () => {
//     try {
//       const { data } = await axios.get('/api/playlists/recently-played', { headers });
//       setRecentSongs(data);
//     } catch (err) { console.error(err); }
//   };

//   useEffect(() => {
//     if (user) { fetchLibrary(); fetchRecent(); }
//   }, [user]);

//   // ── Create playlist ───────────────────────────────────────────────────
//   const handleCreate = async () => {
//     if (!newPlaylistName.trim()) return setCreateError('Please enter a playlist name');
//     try {
//       await axios.post('/api/playlists/create', { title: newPlaylistName }, { headers });
//       setNewPlaylistName('');
//       setShowCreateModal(false);
//       setCreateError('');
//       fetchLibrary();
//     } catch (err) {
//       setCreateError(err.response?.data?.message || 'Could not create playlist');
//     }
//   };

//   // ── Delete playlist ───────────────────────────────────────────────────
//   const handleDeletePlaylist = async (playlistId) => {
//     if (!window.confirm('Delete this playlist?')) return;
//     try {
//       await axios.delete(`/api/playlists/delete/${playlistId}`, { headers });
//       setPlaylists(prev => prev.filter(p => p._id !== playlistId));
//       if (activeSection === playlistId) setActiveSection('recent');
//     } catch (err) { console.error(err); }
//   };

//   // ── Remove song from playlist ─────────────────────────────────────────
//   const handleRemoveSong = async (playlistId, songId) => {
//     try {
//       const { data } = await axios.delete('/api/playlists/remove-song',
//         { data: { playlistId, songId }, headers }
//       );
//       setPlaylists(prev => prev.map(p => p._id === playlistId ? data : p));
//     } catch (err) { console.error(err); }
//   };

//   if (!user) return (
//     <div className="main-content">
//       <p style={{ color: '#b3b3b3' }}>Please login to view your library</p>
//     </div>
//   );

//   const activePlaylist = playlists.find(p => p._id === activeSection);

//   return (
//     <div className="main-content" style={{ display: 'flex', gap: '24px', padding: '20px' }}>

//       {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
//       <div style={{
//         width: '220px', flexShrink: 0,
//         background: '#1e1e1e', borderRadius: '12px',
//         padding: '16px', height: 'fit-content'
//       }}>
//         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
//           <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Your Library</span>
//           <button
//             onClick={() => setShowCreateModal(true)}
//             title="Create playlist"
//             style={{
//               background: 'transparent', border: 'none', cursor: 'pointer',
//               color: '#b3b3b3', display: 'flex', alignItems: 'center'
//             }}>
//             <Plus size={18} />
//           </button>
//         </div>

//         {/* Recently Played */}
//         <div
//           onClick={() => setActiveSection('recent')}
//           style={{
//             padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
//             background: activeSection === 'recent' ? '#2a2a2a' : 'transparent',
//             display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px'
//           }}
//         >
//           <Clock size={16} color="#1db954" />
//           <span style={{ fontSize: '0.9rem' }}>Recently Played</span>
//         </div>

//         {/* Playlists */}
//         {playlists.map(playlist => (
//           <div
//             key={playlist._id}
//             onClick={() => setActiveSection(playlist._id)}
//             style={{
//               padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
//               background: activeSection === playlist._id ? '#2a2a2a' : 'transparent',
//               display: 'flex', alignItems: 'center', justifyContent: 'space-between',
//               marginBottom: '4px', gap: '8px'
//             }}
//           >
//             <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
//               {playlist.title}
//             </span>
//             <button
//               onClick={(e) => { e.stopPropagation(); handleDeletePlaylist(playlist._id); }}
//               style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', flexShrink: 0 }}
//               title="Delete playlist"
//             >
//               <Trash2 size={14} />
//             </button>
//           </div>
//         ))}

//         {playlists.length === 0 && (
//           <p style={{ color: '#555', fontSize: '0.8rem', marginTop: '8px' }}>No playlists yet</p>
//         )}
//       </div>

//       {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
//       <div style={{ flex: 1 }}>

//         {/* Recently Played Section */}
//         {activeSection === 'recent' && (
//           <div>
//             <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
//               <Clock size={24} color="#1db954" />
//               <h2 style={{ margin: 0 }}>Recently Played</h2>
//             </div>
//             {recentSongs.length === 0 ? (
//               <p style={{ color: '#b3b3b3' }}>No recently played songs yet. Start listening!</p>
//             ) : (
//               <SongList songs={recentSongs} queue={recentSongs} />
//             )}
//           </div>
//         )}

//         {/* Playlist Section */}
//         {activePlaylist && (
//           <div>
//             <div style={{
//               display: 'flex', alignItems: 'center', justifyContent: 'space-between',
//               marginBottom: '24px', borderBottom: '1px solid #333', paddingBottom: '16px'
//             }}>
//               <div>
//                 <h2 style={{ margin: 0 }}>{activePlaylist.title}</h2>
//                 <span style={{ color: '#b3b3b3', fontSize: '0.85rem' }}>
//                   {activePlaylist.songs.length} songs
//                 </span>
//               </div>
//               <button
//                 onClick={() => handleDeletePlaylist(activePlaylist._id)}
//                 style={{
//                   background: '#2a2a2a', border: 'none', borderRadius: '8px',
//                   padding: '8px 14px', cursor: 'pointer', color: '#ff4444',
//                   display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem'
//                 }}
//               >
//                 <Trash2 size={14} /> Delete Playlist
//               </button>
//             </div>
//             {activePlaylist.songs.length === 0 ? (
//               <p style={{ color: '#b3b3b3' }}>This playlist is empty. Add songs from the search page!</p>
//             ) : (
//               <SongList
//                 songs={activePlaylist.songs}
//                 queue={activePlaylist.songs}
//                 playlistId={activePlaylist._id}
//                 onRemoveSong={handleRemoveSong}
//               />
//             )}
//           </div>
//         )}
//       </div>

//       {/* ── CREATE PLAYLIST MODAL ─────────────────────────────────── */}
//       {showCreateModal && (
//         <div style={{
//           position: 'fixed', inset: 0, zIndex: 3000,
//           background: 'rgba(0,0,0,0.7)',
//           display: 'flex', alignItems: 'center', justifyContent: 'center'
//         }}>
//           <div style={{
//             background: '#1e1e1e', borderRadius: '12px',
//             padding: '28px', width: '360px'
//           }}>
//             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
//               <h3 style={{ margin: 0 }}>Create Playlist</h3>
//               <button onClick={() => { setShowCreateModal(false); setCreateError(''); setNewPlaylistName(''); }}
//                 style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'white' }}>
//                 <X size={20} />
//               </button>
//             </div>
//             <input
//               type="text"
//               placeholder="Playlist name..."
//               value={newPlaylistName}
//               onChange={e => { setNewPlaylistName(e.target.value); setCreateError(''); }}
//               onKeyDown={e => e.key === 'Enter' && handleCreate()}
//               autoFocus
//               style={{
//                 width: '100%', padding: '12px', borderRadius: '8px',
//                 border: '1px solid #444', background: '#121212',
//                 color: 'white', fontSize: '1rem', boxSizing: 'border-box',
//                 marginBottom: '8px'
//               }}
//             />
//             {createError && (
//               <p style={{ color: '#ff4444', fontSize: '0.85rem', margin: '4px 0 12px' }}>{createError}</p>
//             )}
//             <button
//               onClick={handleCreate}
//               style={{
//                 width: '100%', padding: '12px', borderRadius: '8px',
//                 background: '#1db954', border: 'none', color: 'white',
//                 fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer',
//                 marginTop: '8px'
//               }}
//             >
//               Create
//             </button>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default LibraryPage;


//for remove song from play list and multipke playlist 
// playlistroutes,userjs,musiccontext,librarypage ,song list are upodated 

// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import { AuthContext } from '../context/AuthContext';
// import SongList from '../components/SongList';

// const LibraryPage = () => {
//   const [playlists, setPlaylists] = useState([]);
//   const { user } = useContext(AuthContext);

//   useEffect(() => {
//     const fetchLibrary = async () => {
//       try {
//         const { data } = await axios.get('/api/playlists/my-library', {
//           headers: { Authorization: `Bearer ${user.token}` }
//         });
//         setPlaylists(data);
//       } catch (err) {
//         console.error(err);
//       }
//     };
//     if (user) fetchLibrary();
//   }, [user]);

//   if (!user) return <div className="main-content">Please login to view your library</div>;

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: '2rem', marginBottom: '30px' }}>Your Library</h1>
//       {playlists.length === 0 ? (
//         <p style={{ color: '#b3b3b3' }}>Your library is empty. Start adding some songs!</p>
//       ) : (
//         playlists.map(playlist => (
//           <div key={playlist._id} className="playlist-section">
//             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>
//               <h2>{playlist.title}</h2>
//               <span style={{ color: '#b3b3b3', fontSize: '0.9rem' }}>{playlist.songs.length} songs</span>
//             </div>
//             {/* ✅ Pass playlist.songs as queue so clicking any song auto-queues the whole playlist */}
//             <SongList songs={playlist.songs} queue={playlist.songs} />
//           </div>
//         ))
//       )}
//     </div>
//   );
// };

// export default LibraryPage;


// MusicContext.js — add a queue state (the active playlist songs) and a playNext function
// LibraryPage.js — when user clicks a song, pass the full playlist as the queue
// SongList.js — pass queue to playSong when inside a playlist
// PlayerBar.js — call playNext when a song ends instead of just stopping



// import React, { useState, useEffect, useContext } from 'react';
// import axios from 'axios';
// import { AuthContext } from '../context/AuthContext';
// import SongList from '../components/SongList';

// const LibraryPage = () => {
//   const [playlists, setPlaylists] = useState([]);
//   const { user } = useContext(AuthContext);

//   useEffect(() => {
//     const fetchLibrary = async () => {
//       try {
//         const { data } = await axios.get('/api/playlists/my-library', {
//           headers: { Authorization: `Bearer ${user.token}` }
//         });
//         setPlaylists(data);
//       } catch (err) {
//         console.error(err);
//       }
//     };

//     if (user) fetchLibrary();
//   }, [user]);

//   if (!user) return <div className="main-content">Please login to view your library</div>;

//   return (
//     <div className="main-content">
//       <h1 style={{ fontSize: '2rem', marginBottom: '30px' }}>Your Library</h1>
//       {playlists.length === 0 ? (
//         <p>Your library is empty. Start adding some songs!</p>
//       ) : (
//         playlists.map(playlist => (
//           <div key={playlist._id} className="playlist-section">
//             <h2 style={{ borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>{playlist.title}</h2>
//             <SongList songs={playlist.songs} />
//           </div>
//         ))
//       )}
//     </div>
//   );
// };

// export default LibraryPage;
