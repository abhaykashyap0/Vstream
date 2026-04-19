import React, { useContext, useState } from 'react';
import { MusicContext } from '../context/MusicContext';
import { AuthContext } from '../context/AuthContext';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import axios from 'axios';

const SongList = ({ songs, queue, playlistId, onRemoveSong }) => {
  const { playSong, addToQueue, currentSong } = useContext(MusicContext);
  const { user } = useContext(AuthContext);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(null); // songId
  const [playlists, setPlaylists] = useState([]);
  const [newName, setNewName] = useState('');

  const handleSongClick = (song) => playSong(song, queue || []);

  // Fetch playlists for picker dropdown
  const openPicker = async (e, songId) => {
    e.stopPropagation();
    if (!user) return alert('Please login to save songs');
    try {
      const { data } = await axios.get('/api/playlists/my-library', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setPlaylists(data);
      setShowPlaylistPicker(songId);
    } catch { alert('Could not load playlists'); }
  };

  // Add to existing playlist
  const addToExisting = async (e, songId, playlistTitle) => {
    e.stopPropagation();
    try {
      await axios.post('/api/playlists/add',
        { songId, playlistTitle },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      // Also update live queue if playing
      const song = songs.find(s => s._id === songId);
      if (song && currentSong) addToQueue(song);
      setShowPlaylistPicker(null);
    } catch { alert('Error adding song'); }
  };

  // Add to new playlist by name
  const addToNew = async (e, songId) => {
    e.stopPropagation();
    if (!newName.trim()) return;
    try {
      // Create playlist first if doesn't exist
      await axios.post('/api/playlists/add',
        { songId, playlistTitle: newName.trim() },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      setNewName('');
      setShowPlaylistPicker(null);
    } catch { alert('Error adding song'); }
  };

  return (
    <div className="song-grid">
      {songs.map((song) => (
        <div
          key={song._id}
          className="song-card"
          onClick={() => handleSongClick(song)}
          style={{ position: 'relative' }}
        >
          <img src={song.image_url} alt={song.title} />
          <div className="song-title">{song.title}</div>
          <div className="song-artist">{song.artist}</div>
          {song.duration && (
            <div style={{ fontSize: '11px', color: '#b3b3b3', marginTop: '4px' }}>{song.duration}</div>
          )}

          {/* Remove from playlist button (only in library) */}
          {playlistId && onRemoveSong && (
            <button
              className="add-btn"
              title="Remove from playlist"
              onClick={(e) => { e.stopPropagation(); onRemoveSong(playlistId, song._id); }}
              style={{ background: 'rgba(255,50,50,0.7)' }}
            >
              <Trash2 size={16} />
            </button>
          )}

          {/* Add to playlist button (only in search results) */}
          {!playlistId && (
            <button
              className="add-btn"
              title="Add to playlist"
              onClick={(e) => openPicker(e, song._id)}
            >
              <Plus size={20} />
            </button>
          )}

          {/* Playlist picker dropdown */}
          {showPlaylistPicker === song._id && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute', top: '10px', right: '10px',
                background: '#282828', borderRadius: '8px',
                padding: '10px', zIndex: 100, minWidth: '180px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: '#b3b3b3' }}>Add to playlist</span>
                <button onClick={() => setShowPlaylistPicker(null)}
                  style={{ background: 'transparent', border: 'none', color: '#b3b3b3', cursor: 'pointer', fontSize: '14px' }}>✕</button>
              </div>

              {/* Existing playlists */}
              {playlists.map(pl => (
                <div
                  key={pl._id}
                  onClick={(e) => addToExisting(e, song._id, pl.title)}
                  style={{
                    padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                    fontSize: '0.85rem', marginBottom: '2px',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#333'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {pl.title}
                </div>
              ))}

              {/* New playlist input */}
              <div style={{ marginTop: '8px', borderTop: '1px solid #444', paddingTop: '8px' }}>
                <input
                  type="text"
                  placeholder="New playlist name..."
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addToNew(e, song._id)}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: '6px',
                    border: '1px solid #444', background: '#121212',
                    color: 'white', fontSize: '0.8rem', boxSizing: 'border-box'
                  }}
                />
                <button
                  onClick={(e) => addToNew(e, song._id)}
                  style={{
                    marginTop: '6px', width: '100%', padding: '6px',
                    borderRadius: '6px', background: '#1db954',
                    border: 'none', color: 'white', cursor: 'pointer',
                    fontSize: '0.8rem', fontWeight: 'bold'
                  }}
                >
                  + Create & Add
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default SongList;




//for remove song from play list and multipke playlist 
// playlistroutes,userjs,musiccontext,librarypage ,song list are upodated 



// import React, { useContext } from 'react';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Plus } from 'lucide-react';
// import axios from 'axios';

// const SongList = ({ songs, queue }) => {
//   const { playSong, addToQueue, currentSong } = useContext(MusicContext);
//   const { user } = useContext(AuthContext);

//   const handleSongClick = (song) => {
//     playSong(song, queue || []);
//   };

//   const addToPlaylist = async (e, song) => {
//     e.stopPropagation();
//     if (!user) return alert('Please login to save songs');
//     try {
//       await axios.post(
//         '/api/playlists/add',
//         { songId: song._id },
//         { headers: { Authorization: `Bearer ${user.token}` } }
//       );
//       // ✅ If a song is currently playing (queue is active), also add to live queue
//       if (currentSong) {
//         addToQueue(song);
//       }
//       alert('Added to Library!');
//     } catch (err) {
//       alert('Error adding song to library');
//     }
//   };

//   return (
//     <div className="song-grid">
//       {songs.map((song) => (
//         <div key={song._id} className="song-card" onClick={() => handleSongClick(song)}>
//           <img src={song.image_url} alt={song.title} />
//           <div className="song-title">{song.title}</div>
//           <div className="song-artist">{song.artist}</div>
//           {song.duration && (
//             <div style={{ fontSize: '11px', color: '#b3b3b3', marginTop: '4px' }}>{song.duration}</div>
//           )}
//           {/* Pass full song object so we can add it to queue */}
//           <button className="add-btn" onClick={(e) => addToPlaylist(e, song)}>
//             <Plus size={20} />
//           </button>
//         </div>
//       ))}
//     </div>
//   );
// };

// export default SongList;


// updated playerbar and songlist for video 


// import React, { useContext } from 'react';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Play, Plus } from 'lucide-react';
// import axios from 'axios';

// const SongList = ({ songs, queue }) => {
//   const { playSong, addToQueue, currentSong } = useContext(MusicContext);
//   const { user } = useContext(AuthContext);

//   const handleSongClick = (song) => {
//     playSong(song, queue || []);
//   };

//   const addToPlaylist = async (e, song) => {
//     e.stopPropagation();
//     if (!user) return alert('Please login to save songs');
//     try {
//       const { data } = await axios.post(
//         '/api/playlists/add',
//         { songId: song._id },
//         { headers: { Authorization: `Bearer ${user.token}` } }
//       );
//       // ✅ If a song is currently playing (queue is active), also add to live queue
//       if (currentSong) {
//         addToQueue(song);
//       }
//       alert('Added to Library!');
//     } catch (err) {
//       alert('Error adding song to library');
//     }
//   };

//   return (
//     <div className="song-grid">
//       {songs.map((song) => (
//         <div key={song._id} className="song-card" onClick={() => handleSongClick(song)}>
//           <img src={song.image_url} alt={song.title} />
//           <div className="song-title">{song.title}</div>
//           <div className="song-artist">{song.artist}</div>
//           {song.duration && (
//             <div style={{ fontSize: '11px', color: '#b3b3b3', marginTop: '4px' }}>{song.duration}</div>
//           )}
//           {/* Pass full song object so we can add it to queue */}
//           <button className="add-btn" onClick={(e) => addToPlaylist(e, song)}>
//             <Plus size={20} />
//           </button>
//         </div>
//       ))}
//     </div>
//   );
// };

// export default SongList;

// songlist and musiccontext updated 



// import React, { useContext } from 'react';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import { Play, Plus } from 'lucide-react';
// import axios from 'axios';

// // queue prop — pass the full playlist songs array when inside a playlist
// // so clicking any song in the playlist sets the whole playlist as the queue
// const SongList = ({ songs, queue }) => {
//   const { playSong } = useContext(MusicContext);
//   const { user } = useContext(AuthContext);

//   const handleSongClick = (song) => {
//     // If a queue is passed (i.e. playing from a playlist), use it
//     // Otherwise just play the song alone (e.g. from search results)
//     playSong(song, queue || []);
//   };

//   const addToPlaylist = async (e, songId) => {
//     e.stopPropagation();
//     if (!user) return alert('Please login to save songs');
//     try {
//       await axios.post('/api/playlists/add',
//         { songId },
//         { headers: { Authorization: `Bearer ${user.token}` } }
//       );
//       alert('Added to Library!');
//     } catch (err) {
//       alert('Error adding song to library');
//     }
//   };

//   return (
//     <div className="song-grid">
//       {songs.map((song) => (
//         <div key={song._id} className="song-card" onClick={() => handleSongClick(song)}>
//           <img src={song.image_url} alt={song.title} />
//           <div className="song-title">{song.title}</div>
//           <div className="song-artist">{song.artist}</div>
//           {song.duration && (
//             <div style={{ fontSize: '11px', color: '#b3b3b3', marginTop: '4px' }}>{song.duration}</div>
//           )}
//           <button className="add-btn" onClick={(e) => addToPlaylist(e, song._id)}>
//             <Plus size={20} />
//           </button>
//         </div>
//       ))}
//     </div>
//   );
// };

// export default SongList;



// MusicContext.js — add a queue state (the active playlist songs) and a playNext function
// LibraryPage.js — when user clicks a song, pass the full playlist as the queue
// SongList.js — pass queue to playSong when inside a playlist
// PlayerBar.js — call playNext when a song ends instead of just stopping


// import React, { useContext } from 'react';
// import { MusicContext } from '../context/MusicContext';
// import { AuthContext } from '../context/AuthContext';
// import {  Plus } from 'lucide-react';
// import axios from 'axios';

// const SongList = ({ songs }) => {
//   const { playSong } = useContext(MusicContext);
//   const { user } = useContext(AuthContext);

//   const addToPlaylist = async (e, songId) => {
//     e.stopPropagation();
//     if (!user) return alert('Please login to save songs');
    
//     try {
//       await axios.post('/api/playlists/add', 
//         { songId }, 
//         { headers: { Authorization: `Bearer ${user.token}` } }
//       );
//       alert('Added to Library!');
//     } catch (err) {
//       alert('Error adding song to library');
//     }
//   };

//   return (
//     <div className="song-grid">
//       {songs.map((song) => (
//         <div key={song._id} className="song-card" onClick={() => playSong(song)}>
//           <img src={song.image_url} alt={song.title} />
//           <div className="song-title">{song.title}</div>
//           <div className="song-artist">{song.artist}</div>
//           <button className="add-btn" onClick={(e) => addToPlaylist(e, song._id)}>
//             <Plus size={20} />
//           </button>
//         </div>
//       ))}
//     </div>
//   );
// };

// export default SongList;
