import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtDuration = (ms) => {
  if (!ms) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const fmtRelative = (d) => {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};

// ── Styles ─────────────────────────────────────────────────────────────────
const s = {
  page:   { minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'Inter, sans-serif', padding: '0' },
  header: { background: '#111', borderBottom: '1px solid #222', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:   { fontSize: '1.3rem', fontWeight: 700, color: '#1db954', display: 'flex', alignItems: 'center', gap: '10px' },
  body:   { padding: '32px' },
  card:   { background: '#161616', border: '1px solid #222', borderRadius: '12px', padding: '20px', marginBottom: '24px' },
  statRow:{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '28px' },
  stat:   { background: '#161616', border: '1px solid #222', borderRadius: '10px', padding: '18px 20px', textAlign: 'center' },
  statN:  { fontSize: '2rem', fontWeight: 700, color: '#1db954' },
  statL:  { fontSize: '0.78rem', color: '#888', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  table:  { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th:     { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #222', color: '#888', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
  td:     { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', verticalAlign: 'top' },
  badge:  (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600, background: color + '22', color }),
  btn:    { background: '#1db954', color: '#000', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' },
  input:  { background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '10px 14px', color: '#fff', fontSize: '0.9rem', width: '100%', outline: 'none', boxSizing: 'border-box' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: '#ddd' },
  loginBox: { maxWidth: '400px', margin: '120px auto', background: '#161616', border: '1px solid #222', borderRadius: '16px', padding: '40px' },
  tab:    (active) => ({ padding: '8px 18px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', background: active ? '#1db954' : 'transparent', color: active ? '#000' : '#888', transition: 'all 0.2s' }),
};

// ── Login Gate ─────────────────────────────────────────────────────────────
const LoginGate = ({ onAuth }) => {
  const [key, setKey]   = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.get(`${API}/api/admin/dashboard`, {
        params: { key, limit: 1 }
      });
      if (res.data) { onAuth(key); }
    } catch {
      setError('Wrong admin key. Try again.');
    }
  };

  return (
    <div style={s.page}>
      <div style={s.loginBox}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🛡️</div>
          <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Admin Access</h2>
          <p style={{ color: '#666', marginTop: '6px', fontSize: '0.85rem' }}>VStream Dashboard — Private</p>
        </div>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Enter admin secret key"
            value={key}
            onChange={e => setKey(e.target.value)}
            style={{ ...s.input, marginBottom: '16px' }}
          />
          {error && <p style={{ color: '#ff6666', fontSize: '0.82rem', marginBottom: '12px' }}>{error}</p>}
          <button type="submit" style={{ ...s.btn, width: '100%', padding: '12px' }}>Enter Dashboard</button>
        </form>
      </div>
    </div>
  );
};

// ── Main Dashboard ─────────────────────────────────────────────────────────
const AdminDashboard = ({ adminKey, onLogout }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('overview');   // overview | sessions | users | songs
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetail, setUserDetail]     = useState(null);

  // key passed as query param to avoid CORS preflight on custom headers

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/admin/dashboard`, { params: { key: adminKey, limit: 100 } });
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  }, [adminKey]);

  const fetchUserDetail = async (userId) => {
    setSelectedUser(userId);
    const res = await axios.get(`${API}/api/admin/user/${userId}`, { params: { key: adminKey } });
    setUserDetail(res.data);
  };

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  if (loading) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#555' }}>Loading...</p></div>;
  if (!data)   return <div style={s.page}><p style={{ color: '#f55', padding: '40px' }}>Failed to load data.</p></div>;

  const { summary, activeSessions, sessions, userStats, topSongs } = data;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          <span>🎵</span> VStream Admin
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: '#555', fontSize: '0.78rem' }}>Last refreshed {fmtRelative(new Date())}</span>
          <button onClick={fetchDashboard} style={{ ...s.btn, padding: '7px 14px', fontSize: '0.8rem' }}>↻ Refresh</button>
          <button onClick={onLogout} style={{ background: 'transparent', border: '1px solid #333', color: '#888', borderRadius: '8px', padding: '7px 14px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}>⎋ Logout</button>
        </div>
      </div>

      <div style={s.body}>
        {/* Stats */}
        <div style={s.statRow}>
          <div style={s.stat}>
            <div style={s.statN}>{summary.totalUsers}</div>
            <div style={s.statL}>Total Users</div>
          </div>
          <div style={s.stat}>
            <div style={s.statN}>{summary.totalSessions}</div>
            <div style={s.statL}>Total Sessions</div>
          </div>
          <div style={s.stat}>
            <div style={{ ...s.statN, color: summary.activeNow > 0 ? '#1db954' : '#555' }}>{summary.activeNow}</div>
            <div style={s.statL}>Active Now</div>
          </div>
          <div style={s.stat}>
            <div style={s.statN}>{userStats.reduce((a, u) => a + u.totalSongsPlayed, 0)}</div>
            <div style={s.statL}>Songs Played</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', background: '#111', borderRadius: '10px', padding: '6px', width: 'fit-content' }}>
          {['overview','sessions','users','songs'].map(t => (
            <button key={t} onClick={() => { setTab(t); setSelectedUser(null); }} style={s.tab(tab === t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <>
            {/* Active now */}
            {activeSessions.length > 0 && (
              <div style={s.card}>
                <div style={s.sectionTitle}>🟢 Currently Online ({activeSessions.length})</div>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>User</th>
                      <th style={s.th}>Logged in</th>
                      <th style={s.th}>Duration so far</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSessions.map(sess => (
                      <tr key={sess._id}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 600 }}>{sess.username}</div>
                          <div style={{ color: '#666', fontSize: '0.78rem' }}>{sess.email}</div>
                        </td>
                        <td style={s.td}>{fmtDate(sess.loginAt)}</td>
                        <td style={s.td}>{fmtDuration(Date.now() - new Date(sess.loginAt).getTime())}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Top users by usage */}
            <div style={s.card}>
              <div style={s.sectionTitle}>🏆 Top Users by Usage</div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>User</th>
                    <th style={s.th}>Sessions</th>
                    <th style={s.th}>Total Time</th>
                    <th style={s.th}>Songs Played</th>
                    <th style={s.th}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {userStats.slice(0, 10).map(u => (
                    <tr key={u._id} style={{ cursor: 'pointer' }} onClick={() => { setTab('users'); fetchUserDetail(u._id); }}>
                      <td style={s.td}>
                        <div style={{ fontWeight: 600, color: '#1db954' }}>{u.username}</div>
                        <div style={{ color: '#666', fontSize: '0.78rem' }}>{u.email}</div>
                      </td>
                      <td style={s.td}>{u.totalSessions}</td>
                      <td style={s.td}>{fmtDuration(u.totalDurationMs)}</td>
                      <td style={s.td}>{u.totalSongsPlayed}</td>
                      <td style={s.td}>{fmtRelative(u.lastLogin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── SESSIONS ── */}
        {tab === 'sessions' && (
          <div style={s.card}>
            <div style={s.sectionTitle}>📋 All Sessions (latest first)</div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>User</th>
                  <th style={s.th}>Login</th>
                  <th style={s.th}>Logout</th>
                  <th style={s.th}>Duration</th>
                  <th style={s.th}>Songs</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(sess => (
                  <tr key={sess._id}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{sess.username}</div>
                      <div style={{ color: '#666', fontSize: '0.78rem' }}>{sess.email}</div>
                    </td>
                    <td style={s.td}>{fmtDate(sess.loginAt)}</td>
                    <td style={s.td}>{fmtDate(sess.logoutAt)}</td>
                    <td style={s.td}>{fmtDuration(sess.durationMs)}</td>
                    <td style={s.td}>{sess.songsPlayed?.length || 0}</td>
                    <td style={s.td}>
                      <span style={s.badge(sess.logoutAt ? '#888' : '#1db954')}>
                        {sess.logoutAt ? 'ended' : '● live'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div style={{ display: 'grid', gridTemplateColumns: selectedUser ? '1fr 1fr' : '1fr', gap: '24px' }}>
            <div style={s.card}>
              <div style={s.sectionTitle}>👥 All Users</div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>User</th>
                    <th style={s.th}>Sessions</th>
                    <th style={s.th}>Total Time</th>
                    <th style={s.th}>Songs</th>
                    <th style={s.th}>Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {userStats.map(u => (
                    <tr key={u._id}
                      onClick={() => fetchUserDetail(u._id)}
                      style={{ cursor: 'pointer', background: selectedUser === u._id ? '#1db95411' : 'transparent' }}>
                      <td style={s.td}>
                        <div style={{ fontWeight: 600, color: '#1db954' }}>{u.username}</div>
                        <div style={{ color: '#555', fontSize: '0.75rem' }}>{u.email}</div>
                      </td>
                      <td style={s.td}>{u.totalSessions}</td>
                      <td style={s.td}>{fmtDuration(u.totalDurationMs)}</td>
                      <td style={s.td}>{u.totalSongsPlayed}</td>
                      <td style={s.td}>{fmtRelative(u.lastLogin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* User detail panel */}
            {selectedUser && userDetail && (() => {
              // Flatten all songs across all sessions for this user
              const allSongs = userDetail.sessions.flatMap(sess => sess.songsPlayed || []);

              // Count play frequency per song title
              const freq = {};
              allSongs.forEach(song => {
                const key = song.title || 'Unknown';
                if (!freq[key]) freq[key] = { title: song.title, artist: song.artist, count: 0, lastPlayed: song.playedAt };
                freq[key].count++;
                if (new Date(song.playedAt) > new Date(freq[key].lastPlayed)) freq[key].lastPlayed = song.playedAt;
              });

              const sortedSongs = Object.values(freq).sort((a, b) => b.count - a.count);
              const totalPlayed = allSongs.length;
              const showTop = Math.min(sortedSongs.length, 10); // up to 10, less if not enough yet
              const topSongsForUser = sortedSongs.slice(0, showTop);
              const hasEnough = totalPlayed >= 10;

              return (
                <div style={s.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={s.sectionTitle}>📊 {userDetail.user?.username}'s Activity</div>
                    <button onClick={() => { setSelectedUser(null); setUserDetail(null); }}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                  </div>

                  <div style={{ marginBottom: '20px', fontSize: '0.82rem', color: '#666' }}>
                    <div>Email: {userDetail.user?.email}</div>
                    <div>Joined: {fmtDate(userDetail.user?.createdAt)}</div>
                  </div>

                  {/* Top songs section */}
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ddd' }}>
                        {hasEnough ? '🏆 Top 10 Songs' : `🎵 Songs Played (${totalPlayed} so far)`}
                      </div>
                      {!hasEnough && totalPlayed > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#555', background: '#1a1a1a', padding: '3px 10px', borderRadius: '20px' }}>
                          {10 - totalPlayed} more to unlock top 10
                        </div>
                      )}
                    </div>

                    {totalPlayed === 0 ? (
                      <div style={{ fontSize: '0.8rem', color: '#444', fontStyle: 'italic', padding: '12px 0' }}>
                        No songs played yet
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {topSongsForUser.map((song, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            background: i === 0 && hasEnough ? 'rgba(29,185,84,0.07)' : '#111',
                            border: `1px solid ${i === 0 && hasEnough ? '#1db95433' : '#1e1e1e'}`,
                            borderRadius: '8px', padding: '8px 12px'
                          }}>
                            <span style={{
                              minWidth: '22px', textAlign: 'center', fontWeight: 700,
                              fontSize: '0.8rem',
                              color: i === 0 ? '#1db954' : i === 1 ? '#aaa' : i === 2 ? '#cd7f32' : '#444'
                            }}>
                              {i === 0 && hasEnough ? '🥇' : i === 1 && hasEnough ? '🥈' : i === 2 && hasEnough ? '🥉' : `${i + 1}`}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: '#ddd', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {song.title || 'Unknown'}
                              </div>
                              {song.artist && (
                                <div style={{ color: '#666', fontSize: '0.74rem' }}>{song.artist}</div>
                              )}
                            </div>
                            <span style={{
                              fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                              color: song.count >= 5 ? '#1db954' : '#666'
                            }}>
                              {song.count} {song.count === 1 ? 'play' : 'plays'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Progress bar toward 10 songs for new users */}
                    {!hasEnough && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#444', marginBottom: '4px' }}>
                          <span>Progress to Top 10</span>
                          <span>{totalPlayed}/10</span>
                        </div>
                        <div style={{ background: '#1a1a1a', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min((totalPlayed / 10) * 100, 100)}%`,
                            height: '100%', background: '#1db954',
                            borderRadius: '4px', transition: 'width 0.4s'
                          }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Session history */}
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ddd', marginBottom: '10px' }}>📋 Session History</div>
                  {userDetail.sessions.map(sess => (
                    <div key={sess._id} style={{ borderTop: '1px solid #1e1e1e', paddingTop: '10px', marginTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.78rem', color: '#aaa' }}>{fmtDate(sess.loginAt)}</span>
                        <span style={s.badge(sess.logoutAt ? '#888' : '#1db954')}>
                          {sess.logoutAt ? fmtDuration(sess.durationMs) : '● live'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#555' }}>
                        {sess.songsPlayed?.length > 0
                          ? `${sess.songsPlayed.length} song${sess.songsPlayed.length > 1 ? 's' : ''} played`
                          : 'No songs this session'}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── SONGS ── */}
        {tab === 'songs' && (
          <div style={s.card}>
            <div style={s.sectionTitle}>🎵 Top 10 Most Played Songs</div>
            {topSongs.length === 0 && <p style={{ color: '#555', fontSize: '0.85rem' }}>No song plays tracked yet.</p>}
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>#</th>
                  <th style={s.th}>Title</th>
                  <th style={s.th}>Artist</th>
                  <th style={s.th}>Times Played</th>
                </tr>
              </thead>
              <tbody>
                {topSongs.map((song, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, color: '#555' }}>{i + 1}</td>
                    <td style={s.td}><span style={{ color: '#ddd', fontWeight: 600 }}>{song._id}</span></td>
                    <td style={s.td}><span style={{ color: '#888' }}>{song.artist || '—'}</span></td>
                    <td style={s.td}><span style={s.badge('#1db954')}>{song.count} plays</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main export ────────────────────────────────────────────────────────────
const AdminPage = () => {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('vstreamAdminKey') || '');

  const handleAuth = (key) => {
    setAdminKey(key);
    sessionStorage.setItem('vstreamAdminKey', key);
  };

  const handleLogout = () => {
    setAdminKey('');
    sessionStorage.removeItem('vstreamAdminKey');
  };

  if (!adminKey) return <LoginGate onAuth={handleAuth} />;
  return <AdminDashboard adminKey={adminKey} onLogout={handleLogout} />;
};

export default AdminPage;