import React from 'react';

export default function Navbar({ user, onLogout }) {
  return (
    <div className="navbar">
      <div className="logo-area">
        <div className="logo-icon"><i className="fas fa-bolt-lightning"></i></div>
        <div className="logo-text">Volt<span>Flow</span></div>
      </div>
      <div className="profile-badge">
        <div className="notification-icon"><i className="far fa-bell"></i></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 600 }}>{user?.name}</span>
          <div style={{ background: 'var(--surface)', width: '42px', height: '42px', borderRadius: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)' }}>
            <i className="fas fa-user-circle" style={{ fontSize: '28px', color: 'var(--primary)' }}></i>
          </div>
        </div>
        <button className="btn btn-outline" style={{ padding: '6px 12px', marginLeft: '10px' }} onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}