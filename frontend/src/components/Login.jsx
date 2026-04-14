import React, { useState } from 'react';
import { fetchJson } from '../api';

export default function Login({ onLoginSuccess }) {
  const [loadingRole, setLoadingRole] = useState(null);
  const [error, setError] = useState(null);

  const handleLogin = async (role) => {
    setLoadingRole(role);
    setError(null);
    try {
      // Hardcoded for demo purposes as in the original prototype
      const name = role === 'customer' ? 'Rahul Sharma' : 'Rajesh Electrician';
      const phone = role === 'customer' ? '9876543210' : '9988776655';

      const userData = await fetchJson('/login', {
        method: 'POST',
        body: { name, phone, role }
      });

      if (userData && userData.token && userData.user) {
        localStorage.setItem('token', userData.token);
        onLoginSuccess({ ...userData.user, id: userData.user?._id }, role);
      } else {
        throw new Error('Invalid response from server: Missing token or user data');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingRole(null);
    }
  };

  const handleAdminAccess = () => {
    const key = prompt("Enter Master Admin Key:");
    if (key === "79827") {
      // Bypass normal login for admin master key
      // For a prototype, we can create a mock token. In a real app, this would be a server roundtrip.
      localStorage.setItem('token', 'admin-super-secret-token-for-demo');
      onLoginSuccess({ name: 'Super Admin', role: 'admin', id: 'admin-001' }, 'admin');
    } else if (key !== null) {
      alert("Access Denied: Invalid Master Key");
    }
  };

  return (
    <div className="login-container">
      <div className="logo-area" style={{ justifyContent: 'center', marginBottom: '32px', transform: 'scale(1.2)' }}>
        <div className="logo-icon"><i className="fas fa-bolt-lightning"></i></div>
        <div className="logo-text">Volt<span>Flow</span></div>
      </div>
      <div className="login-card">
        <h1>Your Electrician, On Demand.</h1>
        <p>Top-rated, verified professionals at your doorstep in under 30 minutes.</p>
        
        {error && <div style={{ color: 'red', marginBottom: '12px' }}>{error}</div>}
        
        <button className="btn btn-block" style={{ padding: '16px' }} onClick={() => handleLogin('customer')} disabled={loadingRole !== null}>
          <i className="fas fa-user"></i> {loadingRole === 'customer' ? 'Loading...' : 'Continue as Customer'}
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-light)' }}></div>
          <span style={{ padding: '0 10px' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-light)' }}></div>
        </div>

        <button className="btn btn-outline btn-block" style={{ padding: '16px', color: 'var(--text-main)' }} onClick={() => handleLogin('electrician')} disabled={loadingRole !== null}>
          <i className="fas fa-helmet-safety"></i> {loadingRole === 'electrician' ? 'Loading...' : "I'm an Electrician"}
        </button>
        
        <div style={{ marginTop: '32px', fontSize: '0.85rem' }}>
          <a href="#!" onClick={(e) => { e.preventDefault(); handleAdminAccess(); }} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}><i className="fas fa-lock"></i> Master Admin Portal</a>
        </div>
      </div>
    </div>
  );
}