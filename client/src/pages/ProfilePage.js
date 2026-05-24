import React, { useState, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { User, Check, X, Edit2 } from 'lucide-react';

const API = process.env.REACT_APP_API_URL || '';

const ProfilePage = () => {
  const { user, login } = useContext(AuthContext);
  const [editing, setEditing]     = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  if (!user) return (
    <div className="main-content" style={{ textAlign: 'center', paddingTop: '60px' }}>
      <p style={{ color: '#b3b3b3' }}>Please login to view your profile</p>
    </div>
  );

  const handleEdit = () => {
    setNewUsername(user.username);
    setEditing(true);
    setError('');
    setSuccess('');
  };

  const handleCancel = () => {
    setEditing(false);
    setError('');
    setNewUsername('');
  };

  const handleSave = async () => {
    if (newUsername.trim() === user.username) {
      setEditing(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.put(
        `${API}/api/profile/update-username`,
        { username: newUsername.trim() },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      // Update stored user with new username
      login({ ...user, username: data.user.username });
      setSuccess('Username updated successfully! ✅');
      setEditing(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update username');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="main-content">
      <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', marginBottom: '32px', fontWeight: 800 }}>
        Profile
      </h1>

      <div style={{
        background: 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '32px',
        maxWidth: '480px'
      }}>
        {/* Avatar */}
        <div style={{
          width: '80px', height: '80px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #1db954, #0d8c3a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '24px'
        }}>
          <User size={36} color="white" />
        </div>

        {/* Username field */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#b3b3b3', fontSize: '0.82rem', marginBottom: '8px', display: 'block' }}>
            USERNAME
          </label>

          {editing ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                autoFocus
                type="text"
                value={newUsername}
                onChange={e => { setNewUsername(e.target.value); setError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
                maxLength={20}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: '8px',
                  border: '2px solid #1db954', background: '#121212',
                  color: 'white', fontSize: '1rem', outline: 'none'
                }}
              />
              <button onClick={handleSave} disabled={loading} style={{
                background: '#1db954', border: 'none', borderRadius: '8px',
                width: '38px', height: '38px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Check size={18} color="white" />
              </button>
              <button onClick={handleCancel} style={{
                background: '#333', border: 'none', borderRadius: '8px',
                width: '38px', height: '38px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <X size={18} color="white" />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{user.username}</span>
              <button onClick={handleEdit} style={{
                background: 'transparent', border: '1px solid #444',
                borderRadius: '6px', padding: '5px 10px', cursor: 'pointer',
                color: '#b3b3b3', display: 'flex', alignItems: 'center', gap: '5px',
                fontSize: '0.8rem', transition: 'all 0.2s'
              }}>
                <Edit2 size={13} /> Edit
              </button>
            </div>
          )}

          {error && <p style={{ color: '#ff4444', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
          {success && <p style={{ color: '#1db954', fontSize: '0.82rem', marginTop: '8px' }}>{success}</p>}
          {editing && (
            <p style={{ color: '#666', fontSize: '0.75rem', marginTop: '6px' }}>
              3-20 characters • Press Enter to save • Esc to cancel
            </p>
          )}
        </div>

        {/* Email field (read only) */}
        {user.email && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#b3b3b3', fontSize: '0.82rem', marginBottom: '8px', display: 'block' }}>
              EMAIL
            </label>
            <span style={{ fontSize: '0.95rem', color: '#ddd' }}>{user.email}</span>
          </div>
        )}

        {/* Phone field (read only) */}
        {user.phone && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#b3b3b3', fontSize: '0.82rem', marginBottom: '8px', display: 'block' }}>
              PHONE
            </label>
            <span style={{ fontSize: '0.95rem', color: '#ddd' }}>{user.phone}</span>
          </div>
        )}

        {/* Member since */}
        <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #333' }}>
          <p style={{ color: '#555', fontSize: '0.8rem', margin: 0 }}>
            VStream Member
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;