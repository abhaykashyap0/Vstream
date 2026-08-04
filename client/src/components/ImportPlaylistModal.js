import React, { useState, useContext } from 'react';
import { X, Music2, Youtube, ExternalLink, CheckCircle, XCircle, Loader, ChevronRight, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';

// ── Spotify green, YouTube red, JioSaavn purple ───────────────────────
const SOURCE_CONFIG = {
  spotify: {
    name:        'Spotify',
    color:       '#1db954',
    bg:          '#0a1a0f',
    border:      '#1db954',
    placeholder: 'https://open.spotify.com/playlist/...',
    icon:        '🎵',
    steps: [
      'Open Spotify and go to your playlist',
      'Tap the 3 dots (...) → Share',
      'Tap "Copy link to playlist"',
      'Paste the link above and click Fetch'
    ],
    note: '⚠️ Playlist must be set to Public on Spotify'
  },
  youtube: {
    name:        'YouTube Music',
    color:       '#ff0000',
    bg:          '#1a0a0a',
    border:      '#ff4444',
    placeholder: 'https://youtube.com/playlist?list=...',
    icon:        '▶',
    steps: [
      'Open YouTube Music and go to your playlist',
      'Tap the 3 dots (...) → Share',
      'Copy the playlist link',
      'Paste the link above and click Fetch'
    ],
    note: '⚠️ Playlist must be set to Public on YouTube'
  },
  jiosaavn: {
    name:        'JioSaavn',
    color:       '#a020f0',
    bg:          '#140a1a',
    border:      '#a020f0',
    placeholder: 'https://www.jiosaavn.com/featured/playlist-name/id',
    icon:        '🎶',
    steps: [
      'Open JioSaavn and go to any playlist',
      'Tap Share → Copy Link',
      'Paste the link above and click Fetch',
      'Works with featured playlists too!'
    ],
    note: 'Works with any public JioSaavn playlist'
  }
};

const ImportPlaylistModal = ({ onClose, onPlaylistCreated }) => {
 const { user } = useContext(AuthContext);
const token = user?.token || JSON.parse(localStorage.getItem('musicUser') || '{}')?.token;

  // Steps: 'source' → 'instructions' → 'url' → 'preview' → 'done'
  const [step,         setStep]         = useState('source');
  const [source,       setSource]       = useState(null);
  const [url,          setUrl]          = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [preview,      setPreview]      = useState(null); // { playlistName, songs, matched, total, notFound }
  const [playlistName, setPlaylistName] = useState('');
  const [creating,     setCreating]     = useState(false);
  const [done,         setDone]         = useState(null); // { message, songCount }

  const config = source ? SOURCE_CONFIG[source] : null;

  // ── Step 1: Select source ────────────────────────────────────────
  const handleSelectSource = (src) => {
    setSource(src);
    setStep('instructions');
    setError('');
  };

  // ── Step 2: Show instructions → proceed to URL ───────────────────
  const handleProceedToUrl = () => {
    setStep('url');
  };

  // ── Step 3: Fetch + match playlist ───────────────────────────────
  const handleFetch = async () => {
    if (!url.trim()) { setError('Please paste a playlist URL'); return; }
    setLoading(true);
    setError('');

    try {
      const { data } = await axios.post(
        `${API}/api/import/preview`,
        { url: url.trim(), source },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 }
      );
      setPreview(data);
      setPlaylistName(data.playlistName);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch playlist. Check the URL and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 4: Create playlist ───────────────────────────────────────
  const handleCreate = async () => {
    if (!playlistName.trim()) { setError('Enter a playlist name'); return; }
    setCreating(true);
    setError('');

    try {
      const { data } = await axios.post(
        `${API}/api/import/create`,
        { playlistName: playlistName.trim(), songs: preview.songs },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setDone(data);
      setStep('done');
      onPlaylistCreated?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  const handleBack = () => {
    if (step === 'instructions') { setStep('source'); setSource(null); }
    else if (step === 'url')     { setStep('instructions'); setUrl(''); setError(''); }
    else if (step === 'preview') { setStep('url'); setPreview(null); setError(''); }
  };

  // ── Styles ────────────────────────────────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 3000,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px'
  };

  const modal = {
    background:   '#121212',
    borderRadius: '16px',
    width:        '100%',
    maxWidth:     '560px',
    maxHeight:    '85vh',
    display:      'flex',
    flexDirection: 'column',
    border:       `1px solid ${config?.border || '#333'}`,
    overflow:     'hidden',
    transition:   'border-color 0.3s'
  };

  const header = {
    padding:        '18px 20px',
    borderBottom:   '1px solid #222',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    background:     config?.bg || '#0d0d0d'
  };

  const body = {
    flex:      1,
    overflowY: 'auto',
    padding:   '20px'
  };

  const btn = (color, outlined = false) => ({
    padding:      '10px 20px',
    borderRadius: '24px',
    border:       outlined ? `1.5px solid ${color}` : 'none',
    background:   outlined ? 'transparent' : color,
    color:        outlined ? color : '#000',
    fontWeight:   700,
    cursor:       'pointer',
    fontSize:     '0.9rem',
    display:      'flex',
    alignItems:   'center',
    gap:          '6px',
    transition:   'opacity 0.2s'
  });

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>

        {/* ── HEADER ─────────────────────────────────────────────── */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {step !== 'source' && step !== 'done' && (
              <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b3b3b3', display: 'flex' }}>
                <ArrowLeft size={20} />
              </button>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                {step === 'source'       && '📥 Import Playlist'}
                {step === 'instructions' && `Import from ${config?.name}`}
                {step === 'url'          && `Paste ${config?.name} URL`}
                {step === 'preview'      && `Preview — ${preview?.playlistName}`}
                {step === 'done'         && '✅ Import Complete!'}
              </div>
              {/* Progress dots */}
              {step !== 'done' && (
                <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
                  {['source','instructions','url','preview'].map((s, i) => (
                    <div key={s} style={{
                      width:        step === s ? '18px' : '6px',
                      height:       '6px',
                      borderRadius: '3px',
                      background:   ['source','instructions','url','preview'].indexOf(step) >= i
                        ? (config?.color || '#1db954') : '#333',
                      transition:   'all 0.3s'
                    }} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#333', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
            <X size={16} />
          </button>
        </div>

        {/* ── BODY ───────────────────────────────────────────────── */}
        <div style={body}>

          {/* STEP 1: Choose source */}
          {step === 'source' && (
            <div>
              <p style={{ color: '#b3b3b3', marginBottom: '20px', fontSize: '0.9rem' }}>
                Import your playlist from any of these apps. VStream will match songs automatically.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {Object.entries(SOURCE_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => handleSelectSource(key)} style={{
                    display:        'flex',
                    alignItems:     'center',
                    gap:            '16px',
                    padding:        '16px 20px',
                    background:     cfg.bg,
                    border:         `1.5px solid ${cfg.border}`,
                    borderRadius:   '12px',
                    cursor:         'pointer',
                    color:          'white',
                    textAlign:      'left',
                    transition:     'transform 0.15s',
                    width:          '100%'
                  }}>
                    <span style={{ fontSize: '2rem' }}>{cfg.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: cfg.color }}>{cfg.name}</div>
                      <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '2px' }}>
                        Import your {cfg.name} playlists into VStream
                      </div>
                    </div>
                    <ChevronRight size={18} color="#555" />
                  </button>
                ))}
              </div>

              {/* Manual paste option */}
              <div style={{ marginTop: '20px', padding: '14px', background: '#1a1a1a', borderRadius: '10px', border: '1px solid #333' }}>
                <div style={{ fontSize: '0.85rem', color: '#888' }}>
                  🎵 <strong style={{ color: '#ccc' }}>Any other app?</strong> Works with Gaana, Wynk, Hungama too — 
                  just make sure you have a shareable link or use the manual song list feature.
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Instructions */}
          {step === 'instructions' && config && (
            <div>
              <div style={{ background: config.bg, border: `1px solid ${config.border}`, borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{config.icon}</div>
                <div style={{ fontWeight: 700, color: config.color, marginBottom: '12px' }}>
                  How to get your {config.name} playlist link
                </div>
                <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {config.steps.map((step, i) => (
                    <li key={i} style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: '1.5' }}>{step}</li>
                  ))}
                </ol>
              </div>

              {/* Note */}
              <div style={{ background: '#1a1a0a', border: '1px solid #443', borderRadius: '8px', padding: '12px', marginBottom: '20px', fontSize: '0.85rem', color: '#aa9' }}>
                {config.note}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setStep('source')} style={btn('#333', true)}>
                  Back
                </button>
                <button onClick={handleProceedToUrl} style={{ ...btn(config.color), flex: 1, justifyContent: 'center' }}>
                  I have the link → Continue <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Paste URL */}
          {step === 'url' && config && (
            <div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: '#b3b3b3', marginBottom: '8px', fontSize: '0.9rem' }}>
                  {config.name} Playlist URL
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setError(''); }}
                    placeholder={config.placeholder}
                    onKeyDown={e => e.key === 'Enter' && handleFetch()}
                    autoFocus
                    style={{
                      flex:         1,
                      padding:      '12px 16px',
                      background:   '#1a1a1a',
                      border:       `1.5px solid ${error ? '#ff4444' : config.border}`,
                      borderRadius: '10px',
                      color:        'white',
                      fontSize:     '0.88rem',
                      outline:      'none'
                    }}
                  />
                </div>
                {error && <div style={{ color: '#ff6666', fontSize: '0.82rem', marginTop: '6px' }}>{error}</div>}
              </div>

              {/* Example URL */}
              <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '12px', marginBottom: '20px' }}>
                <div style={{ color: '#666', fontSize: '0.78rem', marginBottom: '4px' }}>Example:</div>
                <div style={{ color: '#888', fontSize: '0.78rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {config.placeholder}
                </div>
              </div>

              <button
                onClick={handleFetch}
                disabled={loading || !url.trim()}
                style={{ ...btn(config.color), width: '100%', justifyContent: 'center', opacity: loading || !url.trim() ? 0.6 : 1 }}
              >
                {loading ? (
                  <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Fetching & Matching Songs...</>
                ) : (
                  <>🔍 Fetch Playlist</>
                )}
              </button>

              {loading && (
                <div style={{ marginTop: '16px', color: '#888', fontSize: '0.82rem', textAlign: 'center' }}>
                  This may take 30-60 seconds for large playlists...<br/>
                  Matching songs to JioSaavn & YouTube
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Preview */}
          {step === 'preview' && preview && (
            <div>
              {/* Stats bar */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '100px', background: '#0a1a0f', border: '1px solid #1db954', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1db954' }}>{preview.matched}</div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>Matched</div>
                </div>
                <div style={{ flex: 1, minWidth: '100px', background: '#0a0a1a', border: '1px solid #4488ff', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#4488ff' }}>{preview.total}</div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>Total</div>
                </div>
                {preview.unmatched > 0 && (
                  <div style={{ flex: 1, minWidth: '100px', background: '#1a0a0a', border: '1px solid #ff4444', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ff4444' }}>{preview.unmatched}</div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>Not Found</div>
                  </div>
                )}
              </div>

              {/* Playlist name input */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: '#b3b3b3', fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
                  Save as playlist name:
                </label>
                <input
                  type="text"
                  value={playlistName}
                  onChange={e => setPlaylistName(e.target.value)}
                  style={{
                    width:        '100%',
                    padding:      '10px 14px',
                    background:   '#1a1a1a',
                    border:       '1.5px solid #333',
                    borderRadius: '8px',
                    color:        'white',
                    fontSize:     '0.9rem',
                    outline:      'none',
                    boxSizing:    'border-box'
                  }}
                />
              </div>

              {/* Matched songs list */}
              <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {preview.songs.slice(0, 50).map((song, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: '#1a1a1a', borderRadius: '8px' }}>
                    <img src={song.image_url} alt="" style={{ width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0 }}
                      onError={e => { e.target.style.display = 'none'; }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                      <div style={{ fontSize: '0.75rem', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</div>
                    </div>
                    <div style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', flexShrink: 0,
                      background: song.matchSource === 'jiosaavn' || song.matchSource === 'jiosaavn_direct' ? '#0a1a0f' : '#1a0a0a',
                      color:      song.matchSource === 'jiosaavn' || song.matchSource === 'jiosaavn_direct' ? '#1db954' : '#ff6644',
                      border:     `1px solid ${song.matchSource === 'jiosaavn' || song.matchSource === 'jiosaavn_direct' ? '#1db954' : '#ff4444'}`
                    }}>
                      {song.matchSource === 'jiosaavn' || song.matchSource === 'jiosaavn_direct' ? '● JioSaavn' : '▶ YouTube'}
                    </div>
                    <CheckCircle size={14} color="#1db954" style={{ flexShrink: 0 }} />
                  </div>
                ))}
                {preview.songs.length > 50 && (
                  <div style={{ textAlign: 'center', color: '#666', fontSize: '0.82rem', padding: '8px' }}>
                    +{preview.songs.length - 50} more songs
                  </div>
                )}
              </div>

              {/* Not found */}
              {preview.notFound?.length > 0 && (
                <div style={{ background: '#1a0a0a', border: '1px solid #333', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                  <div style={{ color: '#ff6644', fontSize: '0.82rem', marginBottom: '8px' }}>
                    ❌ {preview.notFound.length} songs not found:
                  </div>
                  {preview.notFound.slice(0, 5).map((s, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: '#666' }}>• {s.title} — {s.artist}</div>
                  ))}
                  {preview.notFound.length > 5 && (
                    <div style={{ fontSize: '0.78rem', color: '#555', marginTop: '4px' }}>...and {preview.notFound.length - 5} more</div>
                  )}
                </div>
              )}

              {error && <div style={{ color: '#ff6666', fontSize: '0.82rem', marginBottom: '10px' }}>{error}</div>}

              <button
                onClick={handleCreate}
                disabled={creating}
                style={{ ...btn('#1db954'), width: '100%', justifyContent: 'center', opacity: creating ? 0.7 : 1 }}
              >
                {creating
                  ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</>
                  : <>✅ Create Playlist ({preview.matched} songs)</>
                }
              </button>
            </div>
          )}

          {/* STEP 5: Done */}
          {step === 'done' && done && (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '8px', color: '#1db954' }}>
                Playlist Created!
              </div>
              <div style={{ color: '#b3b3b3', marginBottom: '24px' }}>
                {done.message}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button onClick={() => { setStep('source'); setSource(null); setUrl(''); setPreview(null); setDone(null); }}
                  style={btn('#333', true)}>
                  Import Another
                </button>
                <button onClick={onClose} style={btn('#1db954')}>
                  Go to Library
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ImportPlaylistModal;