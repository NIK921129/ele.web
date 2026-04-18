import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';

import logoImage from './wmremove-transformed.png';
import { useSocket } from './SocketContext.jsx';

// ==========================================
// 1. API & SOCKET UTILITIES
// ==========================================
if (typeof window !== 'undefined' && window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && !window.location.hostname.startsWith('192.168.') && !window.location.hostname.startsWith('10.')) {
  window.location.href = window.location.href.replace('http:', 'https:');
}
const _envUrl = import.meta.env.VITE_API_URL;
const BASE_URL = _envUrl || (
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'))
    ? `http://${window.location.hostname}:5000`
    : 'https://wattzen-backend.onrender.com' // Always use HTTPS in production
);
const API_BASE_URL = `${BASE_URL}/api`;

async function fetchJson(url, options = {}, retries = 1) {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const headers = { ...options.headers };

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000); // 15-second default timeout

  // Safely normalize URL to prevent double slashes or broken absolute routes
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const finalUrl = url.startsWith('http') ? url : `${API_BASE_URL}${cleanUrl}`;

  try {
    const response = await fetch(finalUrl, {
      headers,
      ...options,
      signal: controller.signal,
      body: isFormData ? options.body : (options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body),
    });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      window.dispatchEvent(new Event('auth-expired'));
      throw new Error('Session expired. Please log in again.');
    }

    if (!response.ok) {
      let errorMessage = 'Something went wrong';
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch (parseError) {
        errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }
    
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (parseError) {
      return { data: text };
    }
  } catch (error) {
    clearTimeout(timeoutId);

    // Implement automatic exponential backoff/retry for transient network failures
    const isNetworkError = error.name === 'AbortError' || error.message === 'Failed to fetch' || error.message.includes('Network');
    if (isNetworkError && retries > 0) {
      console.warn(`[Network] Transient failure, retrying ${url}...`);
      return fetchJson(url, options, retries - 1);
    }

    if (error.name === 'AbortError') {
      throw new Error('Network request timed out. Please check your connection.');
    }
    if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
      throw new Error('Network error. Please check your internet connection.');
    }
    
    // Log unexpected errors for external telemetry / debugging
    console.error(`[API Error] ${options.method || 'GET'} ${url} -`, error.message);
    throw error;
  }
}

// ==========================================
// 2. COMPONENTS
// ==========================================

// --- Landing Component ---
function Landing({ onEnter, onSecret }) {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const requestRef = useRef();

  const particles = React.useMemo(() =>
    Array.from({ length: 25 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 4 + 1,
      speed: Math.random() * 0.5 + 0.1,
      icon: ['fa-bolt', 'fa-plug', 'fa-microchip', 'fa-circle'][Math.floor(Math.random() * 4)]
    })), []
  );

  useEffect(() => {
    let isMounted = true;
    const updateMouse = (x, y) => {
      if (requestRef.current) return;
      requestRef.current = requestAnimationFrame(() => {
        if (isMounted) setMouse({ x: x / window.innerWidth - 0.5, y: y / window.innerHeight - 0.5 });
        requestRef.current = null;
      });
    };

    const handleMouseMove = (e) => updateMouse(e.clientX, e.clientY);
    const handleTouchMove = (e) => {
      if (e.touches[0]) updateMouse(e.touches[0].clientX, e.touches[0].clientY);
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      isMounted = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Anime.js Entrance Animation
  useEffect(() => {
    if (typeof window !== 'undefined' && window.anime) {
      window.anime.timeline({ easing: 'easeOutCubic' })
        .add({
          targets: '.landing-glass-card',
          scale: [0.85, 1],
          opacity: [0, 1],
          duration: 800
        })
        .add({
          targets: '.anime-element',
          translateY: [30, 0],
          opacity: [0, 1],
          delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(150) : 0,
          duration: 800
        }, '-=400');
    }
  }, []);

  return (
    <div className="landing-page">
      {/* Dynamic Background Power Lines */}
      <div className="power-line" style={{ top: '20%', '--y-offset': '100px', animationDelay: '0s' }}></div>
      <div className="power-line" style={{ top: '50%', '--y-offset': '-50px', animationDelay: '2s' }}></div>
      <div className="power-line" style={{ top: '80%', '--y-offset': '200px', animationDelay: '4s' }}></div>

      {/* Floating Interactive Particles */}
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: `${p.x}%`,
          top: `${p.y}%`,

          color: 'rgba(56, 189, 248, 0.2)',
          fontSize: `${p.size}rem`,
          transform: `translate(${mouse.x * 50 * p.speed}px, ${mouse.y * 50 * p.speed}px)`,
          transition: 'transform 0.2s ease-out',
          zIndex: 1
        }}>
          <i className={`fas ${p.icon}`}></i>
        </div>
      ))}
      
      <div className="landing-glass-card" style={{
        transform: `rotateY(${mouse.x * 5}deg) rotateX(${mouse.y * -5}deg)`,
        transition: 'transform 0.1s ease-out'
      }}>
        <div style={{ 
          display: 'inline-flex', 
          padding: '20px', 
          background: 'rgba(255,255,255,0.05)', 
          borderRadius: '24px', 
          marginBottom: '32px', 
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 0 30px rgba(56, 189, 248, 0.2)'
        }}>
          <img src={logoImage} alt="WATTZEN" style={{ width: '100px', height: 'auto' }} />
        </div>
        <h1 className="landing-title anime-element" style={{ opacity: 0 }}>Power Your <span>Network</span></h1>
        <p className="landing-desc anime-element" style={{ opacity: 0 }}>
          Experience the next generation of electrical services. Instant connections, live tracking, and certified safety — all in one seamless, high-powered space.
        </p>
        <button className="btn landing-btn anime-element" onClick={onEnter} style={{ opacity: 0 }}>
          Get Started <i className="fas fa-arrow-right" style={{ marginLeft: '10px' }}></i>
        </button>
      </div>

      <button onClick={onSecret} title="Master Access" className="secret-master-btn">
        <i className="fas fa-shield-halved" style={{ fontSize: '1.2rem' }}></i>
      </button>
    </div>
  );
}

// --- Navbar Component ---
function Navbar({ user, onLogout, toggleTheme, isDarkMode, onEditProfile }) {
  return (
    <div className="navbar">
      <div className="logo-area">
        <div className="logo-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
          <img src={logoImage} alt="WATTZEN Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="logo-text">WATT<span>ZEN</span></div>
      </div>
      <div className="profile-badge">
        <button onClick={toggleTheme} title="Toggle Theme" style={{ border: 'none', background: 'var(--secondary)', width: '42px', height: '42px', borderRadius: '50%', cursor: 'pointer', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)' }}>
          <i className={`fas ${isDarkMode ? 'fa-sun' : 'fa-moon'}`} style={{ fontSize: '1.2rem' }}></i>
        </button>
        <div className="notification-icon"><i className="far fa-bell"></i></div>
        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="profile-name" style={{ fontWeight: 600 }}>{user?.name}</span>
          <div onClick={onEditProfile} title="Edit Profile" style={{ background: 'var(--surface)', width: '42px', height: '42px', borderRadius: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)', cursor: 'pointer', transition: 'all 0.2s' }}>
            <i className="fas fa-user-circle" style={{ fontSize: '28px', color: 'var(--primary)' }}></i>
          </div>
        </div>
        <button className="btn btn-outline desktop-only" style={{ padding: '6px 12px', marginLeft: '10px' }} onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

// --- Edit Profile Modal ---
function ProfileModal({ user, onClose, onUpdate, showToast, onLogout }) {
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const updatedUser = await fetchJson('/me', { method: 'PUT', body: { name, phone } });
      onUpdate(updatedUser);
      showToast('Profile updated successfully', 'success');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
      showToast(err.message.includes('Network') ? err.message : 'Failed to update profile.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Anime.js Form Toggle Animation
  useEffect(() => {
    if (typeof window !== 'undefined' && window.anime) {
      window.anime({
        targets: '.anime-form-item',
        translateX: [20, 0],
        opacity: [0, 1],
        delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(100) : 0,
        duration: 500,
        easing: 'easeOutQuad'
      });
    }
  }, []);

  return (
    <div className="modal-overlay visible">
      <div className="modal-content">
        <div className="modal-header"><h3>Edit Profile</h3><button onClick={onClose}>&times;</button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group anime-form-item"><label>Full Name</label><input type="text" className="form-control" value={name} onChange={e=>setName(e.target.value)} required /></div>
          <div className="form-group anime-form-item"><label>Phone Number</label><input type="tel" className="form-control" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g, ''))} pattern="[0-9]{10}" maxLength="10" required /></div>
          <button type="submit" className="btn btn-block anime-form-item" disabled={loading}>{loading ? 'Saving...' : 'Save Changes'}</button>
          <button type="button" className="btn-outline btn btn-block" style={{ marginTop: '12px', borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onLogout}>Log Out</button>
        </form>
      </div>
    </div>
  );
}

// --- Login Component ---
function Login({ onLoginSuccess, showToast }) {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [role, setRole] = useState('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = isLogin ? '/login' : '/signup';
      const body = isLogin 
        ? { phone, password, role } 
        : { name, phone, password, role };

      const userData = await fetchJson(endpoint, {
        method: 'POST',
        body
      });

      if (userData && userData.token && userData.user) {
        localStorage.setItem('token', userData.token);
        onLoginSuccess(userData.user, userData.user.role);
      } else {
        throw new Error('Invalid response from server: Missing token or user data');
      }
    } catch (err) {
      console.error('[Auth Error]', err);
      setError(err.message.includes('Network') ? err.message : 'Authentication failed. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson('/auth/forgot-password', { method: 'POST', body: { phone } });
      setOtpSent(true);
      setResendCooldown(60); // Initialize a 60-second cooldown timer
      // SECURITY: Generic success message to prevent user enumeration
      showToast(res.message || 'If an account matches this number, an OTP has been sent.', 'success');
    } catch (err) {
      setError('Failed to request OTP. Please try again later.'); // Sanitize error exposure
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson('/auth/reset-password', { method: 'POST', body: { phone, otp, newPassword } });
      showToast(res.message || 'Password reset successfully!', 'success');
      
      // Reset back to standard login screen
      setIsForgotPassword(false);
      setOtpSent(false);
      setOtp('');
      setNewPassword('');
      setResendCooldown(0); // Clear the timer on success
      setPassword('');
      setIsLogin(true);
    } catch (err) {
      console.error('[Password Reset Error]', err);
      setError('Failed to reset password. Please check your OTP and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Anime.js Form Toggle Animation
  useEffect(() => {
    if (typeof window !== 'undefined' && window.anime) {
      window.anime({
        targets: '.anime-form-item',
        translateX: [20, 0],
        opacity: [0, 1],
        delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(100) : 0,
        duration: 500,
        easing: 'easeOutQuad'
      });
    }
  }, [isLogin, isForgotPassword, otpSent]);

  // Handle OTP Resend Cooldown Timer
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
          timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  return (
    <div className="login-container">
      <div className="logo-area" style={{ justifyContent: 'center', marginBottom: '8px', transform: 'scale(1.2)' }}>
        <div className="logo-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
          <img src={logoImage} alt="WATTZEN Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="logo-text">WATT<span>ZEN</span></div>
      </div>
      <div style={{ textAlign: 'center', color: 'var(--primary)', fontWeight: '700', letterSpacing: '1.5px', marginBottom: '32px', fontSize: '0.85rem' }}>POWER YOUR NETWORK</div>
      <div className="login-card">
        <h1>{isForgotPassword ? 'Reset Password' : (isLogin ? 'Welcome Back' : 'Create Account')}</h1>
        <p>{isForgotPassword ? 'Enter your details below to recover your account.' : (isLogin ? 'Log in to your account to continue.' : 'Join the best electrician network.')}</p>
        
        {error && <div style={{ color: 'white', background: 'var(--danger)', padding: '10px', borderRadius: '8px', marginBottom: '16px' }}>{error}</div>}
        
        {!isForgotPassword && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button type="button" className={`btn btn-block ${role === 'customer' ? '' : 'btn-outline'}`} onClick={() => setRole('customer')} style={{ padding: '10px' }}>Customer</button>
          <button type="button" className={`btn btn-block ${role === 'electrician' ? '' : 'btn-outline'}`} onClick={() => setRole('electrician')} style={{ padding: '10px' }}>Electrician</button>
        </div>
        )}

        <form onSubmit={isForgotPassword ? (otpSent ? handleResetPassword : handleForgotPassword) : handleSubmit} style={{ textAlign: 'left' }}>
          
          {isForgotPassword ? (
            <React.Fragment>
              <div className="form-group anime-form-item">
                <label>Phone Number</label>
                <input type="tel" className="form-control" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} pattern="[0-9]{10}" maxLength="10" required placeholder="1234567890" disabled={otpSent} />
              </div>
              {otpSent && (
                <React.Fragment>
                  <div className="form-group anime-form-item">
                    <label>4-Digit OTP</label>
                    <input type="text" className="form-control" value={otp} onChange={e => setOtp(e.target.value)} required placeholder="1234" maxLength={4} style={{ letterSpacing: '4px', fontSize: '1.2rem', fontWeight: 'bold' }} />
                  </div>
                  <div className="form-group anime-form-item">
                    <label>New Password</label>
                    <div className="input-icon-wrapper">
                      <input type={showPassword ? "text" : "password"} className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="••••••••" />
                      <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} action-icon`} onClick={() => setShowPassword(!showPassword)}></i>
                    </div>
                  </div>
                  <div className="anime-form-item" style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '12px' }}>
                    <button type="button" onClick={handleForgotPassword} disabled={resendCooldown > 0 || loading} style={{ background: 'none', border: 'none', padding: 0, color: resendCooldown > 0 ? 'var(--text-muted)' : 'var(--primary)', cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', outline: 'none', transition: 'color 0.2s' }}>
                      {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
                    </button>
                  </div>
                </React.Fragment>
              )}
              <button type="submit" className="btn btn-block anime-form-item" disabled={loading} style={{ marginTop: '10px' }}>
                {loading ? 'Processing...' : (otpSent ? 'Reset Password' : 'Send Recovery OTP')}
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment>
            {!isLogin && (
            <div className="form-group anime-form-item">
              <label>Full Name</label>
              <input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} required placeholder="John Doe" />
            </div>
          )}
          <div className="form-group anime-form-item">
            <label>Phone Number</label>
            <input type="tel" className="form-control" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} pattern="[0-9]{10}" maxLength="10" required placeholder="1234567890" />
          </div>
          <div className="form-group anime-form-item">
            <label>Password</label>
            <div className="input-icon-wrapper">
              <input type={showPassword ? "text" : "password"} className="form-control" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
              <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} action-icon`} onClick={() => setShowPassword(!showPassword)}></i>
            </div>
          </div>
          
          {isLogin && (
            <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '12px' }}>
              <a href="#!" onClick={(e) => { e.preventDefault(); setIsForgotPassword(true); setError(null); }} style={{ color: 'var(--primary)', fontSize: '0.85rem', textDecoration: 'none' }}>Forgot Password?</a>
            </div>
          )}

          <button type="submit" className="btn btn-block anime-form-item" disabled={loading} style={{ marginTop: '10px' }}>
            {loading ? 'Processing...' : (isLogin ? 'Log In' : 'Sign Up')}
          </button>
            </React.Fragment>
          )}
        </form>
        
        <div style={{ marginTop: '20px', fontSize: '0.9rem' }}>
          {isForgotPassword ? (
            <a href="#!" onClick={(e) => { e.preventDefault(); setIsForgotPassword(false); setOtpSent(false); setError(null); }} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              <i className="fas fa-arrow-left"></i> Back to Login
            </a>
          ) : (
            <React.Fragment>
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <a href="#!" onClick={(e) => { e.preventDefault(); setIsLogin(!isLogin); setError(null); }} style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'none' }}>
                {isLogin ? 'Sign Up' : 'Log In'}
          </a>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Shared Real-Time Tracking Map Component ---
function TrackingMap({ origin, destination }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const originMarker = useRef(null);
  const destMarker = useRef(null);
  const boundsSet = useRef(false);

  useEffect(() => {
    if (!window.L || !mapRef.current) return;

    if (!mapInstance.current) {
      mapInstance.current = window.L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false
      }).setView([origin[1], origin[0]], 14);

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(mapInstance.current);

      const createIcon = (label, bg) => window.L.divIcon({
        className: 'custom-osm-icon',
        html: `<div style="background:${bg};color:white;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);font-weight:bold;font-size:14px;">${label}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      originMarker.current = window.L.marker([origin[1], origin[0]], { icon: createIcon('C', '#0d9488') }).addTo(mapInstance.current);
      destMarker.current = window.L.marker([destination[1], destination[0]], { icon: createIcon('E', '#f59e0b') }).addTo(mapInstance.current);
    }

    if (origin && origin.length === 2) originMarker.current.setLatLng([origin[1], origin[0]]);
    if (destination && destination.length === 2) destMarker.current.setLatLng([destination[1], destination[0]]);

    if (origin && destination && origin.length === 2 && destination.length === 2 && !boundsSet.current) {
      const bounds = window.L.latLngBounds([[origin[1], origin[0]], [destination[1], destination[0]]]);
      mapInstance.current.fitBounds(bounds, { padding: [40, 40] });
      boundsSet.current = true;
    }
  }, [origin, destination]);

  return <div ref={mapRef} style={{ width: '100%', height: '250px', borderRadius: '12px', marginTop: '16px', border: '1px solid var(--border-light)', zIndex: 1 }} />;
}

// --- Customer Dashboard Component ---
const SERVICES = [
  // Repairs
  { id: 'wiring', name: 'Wiring', icon: 'fa-plug-circle-bolt', category: 'repairs' },
  { id: 'switch', name: 'Switches', icon: 'fa-toggle-on', category: 'repairs' },
  { id: 'fan_repair', name: 'Fans', icon: 'fa-fan', category: 'repairs' },
  { id: 'mcb', name: 'MCB/Fuse', icon: 'fa-bolt', category: 'repairs' },
  { id: 'short_circuit', name: 'Shorts', icon: 'fa-fire-flame-curved', category: 'repairs' },
  { id: 'meter', name: 'Meters', icon: 'fa-gauge-high', category: 'repairs' },
  { id: 'earthing', name: 'Earthing', icon: 'fa-plug-circle-minus', category: 'repairs' },
  // Appliances
  { id: 'ac', name: 'AC Setup', icon: 'fa-snowflake', category: 'appliances' },
  { id: 'tv', name: 'TV Mount', icon: 'fa-tv', category: 'appliances' },
  { id: 'fridge', name: 'Fridge', icon: 'fa-temperature-low', category: 'appliances' },
  { id: 'water_purifier', name: 'RO Filter', icon: 'fa-faucet-drip', category: 'appliances' },
  { id: 'chimney', name: 'Chimney', icon: 'fa-fire-burner', category: 'appliances' },
  { id: 'geyser', name: 'Geyser', icon: 'fa-hot-tub-person', category: 'appliances' },
  { id: 'washing_machine', name: 'Washers', icon: 'fa-shirt', category: 'appliances' },
  { id: 'microwave', name: 'Microwave', icon: 'fa-kitchen-set', category: 'appliances' },
  { id: 'ev', name: 'EV Charger', icon: 'fa-charging-station', category: 'appliances' },
  { id: 'smart', name: 'Smart Hub', icon: 'fa-house-signal', category: 'appliances' },
  // Projects
  { id: 'home_wiring', name: 'Home Wiring', icon: 'fa-house-chimney', category: 'projects', team: true },
  { id: 'commercial', name: 'Commercial', icon: 'fa-building', category: 'projects', team: true },
  { id: 'solar', name: 'Solar Panel', icon: 'fa-solar-panel', category: 'projects', team: true },
  { id: 'renovation', name: 'Renovation', icon: 'fa-hammer', category: 'projects', team: true }
];

function CustomerHome({ user, showToast }) {
  const { socket } = useSocket();
  const [selectedService, setSelectedService] = useState('wiring');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState([77.5946, 12.9716]); 
  const [liveLocation, setLiveLocation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [bookingPrice, setBookingPrice] = useState(null);
  const [isBooking, setIsBooking] = useState(false);
  const [assignedElectricians, setAssignedElectricians] = useState([]);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [teamStatusMessage, setTeamStatusMessage] = useState('');
  const [isTeamFull, setIsTeamFull] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const chatContainerRef = useRef(null);
  
  const [currentTab, setCurrentTab] = useState('active');
  const [jobHistory, setJobHistory] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const typingTimeoutRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const [activeCategory, setActiveCategory] = useState('repairs');
  const [teamSize, setTeamSize] = useState(1);

  const categories = [
    { id: 'repairs', name: 'Quick Repairs', icon: 'fa-screwdriver-wrench' },
    { id: 'appliances', name: 'Appliance Setup', icon: 'fa-plug' },
    { id: 'projects', name: 'Big Projects', icon: 'fa-hard-hat' }
  ];

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  // OpenStreetMap Nominatim Autocomplete
  useEffect(() => {
    if (address.length > 2 && showSuggestions) {
      const timeout = setTimeout(async () => {
        try {
          const data = await fetchJson(`/location/search?q=${encodeURIComponent(address)}`);
          setSuggestions(Array.isArray(data) ? data : []);
        } catch (e) {
          console.error('Nominatim search failed', e);
        }
      }, 500); // Debounce
      return () => clearTimeout(timeout);
    } else {
      setSuggestions([]);
    }
  }, [address, showSuggestions]);

  const handleSelectSuggestion = (place) => {
    setAddress(place.display_name);
    setCoordinates([parseFloat(place.lon), parseFloat(place.lat)]);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const currentServices = SERVICES.filter(s => s.category === activeCategory);
  const selectedServiceObj = SERVICES.find(s => s.id === selectedService);

  useEffect(() => {
    if (!activeJobId) return;
    socket.emit('joinJobRoom', activeJobId);

    socket.on('electricianLocationChanged', (data) => {
      setLiveLocation(data);
    });
    socket.on('receiveMessage', (data) => {
      setMessages((prev) => [...prev, { ...data, isSelf: false }]);
    });
    socket.on('userTyping', (data) => setTypingUser(data.senderName));
    socket.on('userStopTyping', () => setTypingUser(null));
    socket.on('paymentVerified', () => {
      setTeamStatusMessage('Payment verified! Searching for nearby electricians...');
      showToast('Payment verified by Admin!', 'success');
    });
    socket.on('jobAccepted', (data) => {
      setAssignedElectricians(data.electricians || []);
      setIsTeamFull(true);
      setTeamStatusMessage(''); // Clear progress message
    });
    socket.on('teamMemberJoined', (data) => {
        setAssignedElectricians(prev => {
            if (prev.some(e => String(e._id) === String(data.electrician._id))) return prev;
            return [...prev, data.electrician];
        });
        setTeamStatusMessage(`${data.currentSize} of ${data.teamSize} electricians have joined.`);
        showToast(`${data.electrician.name} has joined the job!`, 'success');
    });
    socket.on('jobCompleted', () => {
      setJobCompleted(true);
    });

    return () => {
      socket.off('electricianLocationChanged');
      socket.off('receiveMessage');
      socket.off('jobAccepted');
      socket.off('paymentVerified');
      socket.off('jobCompleted');
      socket.off('teamMemberJoined');
      socket.off('userTyping');
      socket.off('userStopTyping');
    };
  }, [activeJobId, showToast, socket]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    setTeamSize(1);
  }, [selectedService]);

  useEffect(() => {
    let isMounted = true;
    if (currentTab === 'history') {
      const fetchHistory = async () => { 
        try {
          const data = await fetchJson('/jobs/history');
          if (isMounted) setJobHistory(Array.isArray(data) ? data : []);
        } catch (e) { if (isMounted) showToast('Failed to load history', 'error'); }
      }; 
      fetchHistory();
    }
    return () => { isMounted = false; };
  }, [currentTab, showToast]);

  const handleInitiateBooking = () => {
    if (!address) return showToast('Please enter your full address to book a service.', 'warning');
    // Generate random price 300 - 700 per electrician needed
    const price = (Math.floor(Math.random() * 401) + 300) * teamSize;
    setBookingPrice(price);
  };

  const handleConfirmPayment = async () => {
    setIsBooking(true);
    try {
      const job = await fetchJson('/jobs', {
        method: 'POST',
        body: { serviceType: selectedService, address, coordinates, estimatedPrice: bookingPrice, teamSize }
      });
      setActiveJobId(job._id);
      setBookingPrice(null);
      setTeamStatusMessage('Payment submitted. Waiting for Admin verification...');
      showToast(`Payment registered! Verifying...`, 'success');
      setJobCompleted(false);
      setIsTeamFull(false);
    } catch (error) {
      showToast(error.message, 'error');
      showToast(error.message.includes('Network') ? error.message : 'Failed to process payment.', 'error');
    } finally {
      setIsBooking(false);
    }
  };

  const handleCancelJob = async () => {
    try {
      await fetchJson(`/jobs/${activeJobId}/cancel`, { method: 'PUT' });
      setActiveJobId(null);
      setAssignedElectricians([]);
      setTeamStatusMessage('');
      setLiveLocation(null);
      setMessages([]);
      setIsTeamFull(false);
      setJobCompleted(false);
      setShowRating(false);
      setBookingPrice(null);
      setRating(0);
      showToast('Job cancelled successfully.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
      showToast(error.message.includes('Network') ? error.message : 'Failed to request withdrawal.', 'error');
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const msgData = {
      jobId: activeJobId,
      senderId: user.id || user._id,
      senderName: user?.name || 'Customer',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('sendMessage', msgData);
    setMessages((prev) => [...prev, { ...msgData, isSelf: true }]);
    setChatInput('');
  };

  const handleLocateMe = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setAddress(`Lat: ${position.coords.latitude.toFixed(4)}, Lng: ${position.coords.longitude.toFixed(4)}`);
          setCoordinates([position.coords.longitude, position.coords.latitude]);
        },
        (error) => {
          let msg = 'Could not detect your location.';
          if (error.code === 1) msg = 'Location access denied. Please enable permissions.';
          else if (error.code === 2) msg = 'Location unavailable. Try again later.';
          else if (error.code === 3) msg = 'Location request timed out.';
          showToast(msg, 'error');
        },
        { timeout: 10000 }
      );
    } else {
      showToast('Geolocation is not supported by your browser.', 'error');
    }
  };

  const handleCompleteJob = async () => {
    try {
      await fetchJson(`/jobs/${activeJobId}/complete`, { method: 'PUT' });
      // Optimistically update the UI to prevent hanging if the socket packet drops
      setJobCompleted(true);
      showToast('Job marked as completed. Please rate your experience!', 'success');
    } catch (error) {
      showToast(error.message, 'error');
      showToast(error.message.includes('Network') ? error.message : 'Failed to submit rating.', 'error');
    }
  };

  const handleSubmitRating = async () => {
    try {
      // For now, we'll rate the first electrician in the team. A future update could allow rating each member.
      const electricianId = assignedElectricians[0]?._id;
      if (!electricianId) {
        showToast('No electrician found to rate.', 'error');
        return;
      }
      await fetchJson(`/users/${electricianId}/rate`, {
        method: 'POST',
        body: { rating }
      });
      showToast(`Thank you for your ${rating}-star feedback!`, 'success');
      
      // Only clear state upon successful rating submission
      setActiveJobId(null);
      setAssignedElectricians([]);
      setTeamStatusMessage('');
      setLiveLocation(null);
      setJobCompleted(false);
      setIsTeamFull(false);
      setMessages([]);
      setShowRating(false);
      setRating(0);
    } catch (error) {
      showToast(error.message, 'error');
      showToast(error.message.includes('Network') ? error.message : 'Failed to complete job.', 'error');
    }
  };

  return (
    <div className="dashboard-grid">
      <div>
        <div className="delivery-header">
          <div className="info">
            <span className="title">Service Location</span>
            <div style={{ position: 'relative', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <i className="fas fa-location-dot" style={{ color: 'var(--primary)', fontSize: '1.2rem' }}></i>
                <input type="text" value={address} maxLength={250} onChange={(e) => { setAddress(e.target.value); setShowSuggestions(true); }} placeholder="Enter your full address..." style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: '800', color: 'var(--text-main)', fontSize: '1.05rem', width: '100%' }} />
              </div>
              {suggestions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '8px', zIndex: 10, boxShadow: 'var(--shadow-md)', maxHeight: '200px', overflowY: 'auto', marginTop: '8px' }}>
                  {suggestions.map((s, i) => (
                    <div key={i} style={{ padding: '10px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-main)' }} onClick={() => handleSelectSuggestion(s)}>
                      {s.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="btn" style={{ padding: '10px', borderRadius: '50%', width: '45px', height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={handleLocateMe} title="Detect Location"><i className="fas fa-crosshairs"></i></button>
        </div>

        <div className="promo-banner">
          <div>
            <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: '#60a5fa', marginBottom: '8px', display: 'inline-block' }}>SUMMER SALE</span>
            <h2 style={{ margin: 0, color: 'white', fontSize: '1.5rem' }}>20% Off AC Servicing</h2>
            <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.95rem' }}>Beat the heat with verified cooling experts.</p>
          </div>
          <button className="btn" style={{ background: 'white', color: '#0f172a', fontWeight: 'bold', boxShadow: 'none', padding: '12px 20px' }}>Claim Offer</button>
        </div>

      <div className="desktop-tabs" style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <button className={`btn ${currentTab === 'active' ? '' : 'btn-outline'}`} style={{ flex: 1, padding: '10px' }} onClick={() => setCurrentTab('active')}>Active Booking</button>
        <button className={`btn ${currentTab === 'history' ? '' : 'btn-outline'}`} style={{ flex: 1, padding: '10px' }} onClick={() => setCurrentTab('history')}>Job History</button>
      </div>

      {currentTab === 'active' ? (
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '1.4rem' }}><i className="fas fa-hand-sparkles" style={{ marginRight: '8px', color: 'var(--warning)' }}></i> Hello, {user?.name?.split(' ')[0] || 'User'}</h3>
            <span className="badge" style={{ background: 'var(--gold)', color: '#854d0e', padding: '6px 12px' }}>
              <i className="fas fa-gem"></i> Premium
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>What do you need help with today? Choose from our expanded catalog.</p>
          
          <div className="category-tabs">
            {categories.map(cat => (
              <div 
                key={cat.id} 
                className={`category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveCategory(cat.id);
                  const foundService = SERVICES.find(s => s.category === cat.id);
                  if (foundService) setSelectedService(foundService.id); else setSelectedService(null);
                }}
              >
                <i className={`fas ${cat.icon}`}></i> {cat.name}
              </div>
            ))}
          </div>

          <div className="service-grid">
            {currentServices.map(s => (
              <div 
                key={s.id} 
                className={`service-item ${selectedService === s.id ? 'active' : ''}`} 
                onClick={() => setSelectedService(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedService(s.id);
                  }
                }}
              >
                <i className={`fas ${s.icon}`}></i><span>{s.name}</span>
              </div>
            ))}
          </div>

          {selectedServiceObj?.team && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', background: 'var(--secondary)', padding: '16px', borderRadius: '16px', marginTop: '16px', border: '1px dashed var(--primary)' }}>
              <div>
                <strong style={{ display: 'block', color: 'var(--text-main)' }}>Project Team Required</strong>
                <small style={{ color: 'var(--text-muted)' }}>How many electricians do you need?</small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface)', padding: '6px', borderRadius: '20px', boxShadow: 'var(--shadow-sm)' }}>
                <button onClick={() => setTeamSize(Math.max(1, teamSize - 1))} style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: 'var(--secondary)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 'bold' }}>-</button>
                <strong style={{ width: '20px', textAlign: 'center', color: 'var(--primary)' }}>{teamSize}</strong>
                <button onClick={() => setTeamSize(Math.min(10, teamSize + 1))} style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
              </div>
            </div>
          )}

          {!activeJobId && !bookingPrice ? (
            <button className="btn btn-block" style={{ marginTop: '16px' }} onClick={handleInitiateBooking} disabled={isBooking}>
              <i className="fas fa-bolt"></i> {isBooking ? 'Creating Job...' : 'Find Electricians Near Me'}
            </button>
          ) : !activeJobId && bookingPrice ? (
            <div style={{ marginTop: '16px', padding: '24px', background: 'var(--surface)', borderRadius: '16px', border: '2px solid var(--primary)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}>
              <h3 style={{ color: 'var(--text-main)', margin: '0 0 8px 0' }}>Upfront Payment Required</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>To secure your booking, please pay the estimated service fee.</p>
              <h2 style={{ fontSize: '2.5rem', color: 'var(--success)', margin: '0 0 20px 0' }}>₹{bookingPrice}</h2>
              <a href={`upi://pay?pa=9211293576@ptaxis&pn=WATTZEN&am=${Number(bookingPrice)}&cu=INR`} className="btn btn-block" style={{ background: '#10b981', display: 'block', textDecoration: 'none', marginBottom: '12px' }}>
                <i className="fas fa-qrcode"></i> Pay via UPI App
              </a>
              <button className="btn-outline btn btn-block" onClick={handleConfirmPayment} disabled={isBooking}>
                {isBooking ? 'Verifying...' : 'I have completed the payment'}
              </button>
              <button className="btn" style={{ background: 'transparent', color: 'var(--text-muted)', marginTop: '8px', boxShadow: 'none' }} onClick={() => setBookingPrice(null)}>Cancel</button>
            </div>
          ) : !isTeamFull ? (
            <div style={{ marginTop: '16px', padding: '24px', background: 'var(--secondary)', borderRadius: '12px', textAlign: 'center', border: '1px dashed var(--primary)' }}>
              <i className="fas fa-spinner fa-spin" style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '1.5rem' }}></i>
              <div style={{ fontWeight: 'bold' }}>Searching for nearby electricians...</div>
              {teamStatusMessage && <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '8px' }}>{teamStatusMessage}</div>}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Tracking Job ID: <span style={{ fontFamily: 'monospace' }}>{activeJobId}</span></div>
              <button className="btn btn-outline" style={{ marginTop: '12px', borderColor: 'var(--danger)', color: 'var(--danger)', padding: '6px 12px', fontSize: '0.85rem' }} onClick={handleCancelJob}>
                Cancel Search
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid var(--success)' }}>
              <i className="fas fa-check-circle" style={{ color: 'var(--success)', marginBottom: '8px', fontSize: '1.5rem' }}></i>
              <div style={{ fontWeight: 'bold', color: 'var(--success)', textAlign: 'center' }}>Your Team is Assembled!</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '8px' }}>
                {assignedElectricians.map(e => (
                    <div key={e._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface)', padding: '8px', borderRadius: '8px', marginBottom: '4px', justifyContent: 'space-between' }}>
                      <div><i className="fas fa-user-hard-hat" style={{color: 'var(--primary)'}}></i> <strong>{e.name}</strong></div>
                      <a href={`tel:${e.phone}`} className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }}><i className="fas fa-phone"></i> Call</a>
                    </div>
                ))}
              </div>
              {!jobCompleted && (
                <button className="btn btn-block" style={{ marginTop: '16px' }} onClick={handleCompleteJob}>
                  <i className="fas fa-check-circle"></i> Mark Job as Done
                </button>
              )}
            </div>
          )}

          {jobCompleted ? (
            <div style={{ marginTop: '16px', padding: '24px', background: 'var(--surface)', borderRadius: '12px', border: '2px solid var(--primary)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}>
              <h3 style={{ color: 'var(--text-main)', margin: '0 0 8px 0' }}>Rate your Experience</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>How was your service with <strong>{assignedElectricians[0]?.name}</strong> and team?</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', fontSize: '2.5rem', marginBottom: '24px' }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <i key={star} className="fas fa-star" style={{ cursor: 'pointer', color: star <= (hoverRating || rating) ? 'var(--gold)' : 'var(--border-light)', transition: 'color 0.2s, transform 0.2s' }} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} onClick={() => setRating(star)}></i>
                ))}
              </div>
              <button className="btn btn-block" onClick={handleSubmitRating} disabled={rating === 0}>Submit Feedback</button>
            </div>
          ) : (assignedElectricians.length > 0 || liveLocation) && (
            <React.Fragment>
              {liveLocation && (
                <div style={{ marginTop: '16px', padding: '16px', background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: '12px' }}>
                  <h4 style={{ color: 'var(--primary)', margin: '0 0 8px 0' }}>
                    <i className="fas fa-map-marker-alt" style={{ animation: 'pulse 1.5s infinite' }}></i> Electrician is on the way!
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    <strong>Distance:</strong> {liveLocation.distance} km <br />
                    <strong>ETA:</strong> {liveLocation.eta} mins <br />
                  </p>
                  {liveLocation.coordinates && (
                    <TrackingMap origin={coordinates} destination={liveLocation.coordinates} />
                  )}
                </div>
              )}
              
              <div style={{ marginTop: '16px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ background: 'var(--primary)', color: 'white', padding: '10px 16px', fontWeight: 'bold' }}>
                  <i className="fas fa-comments"></i> Team & Customer Chat
                </div>
                <div ref={chatContainerRef} style={{ padding: '16px', height: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--secondary)' }}>
                {messages.map((m, i) => {
                  const isSelf = m.isSelf || m.sender === 'self';
                  const senderName = m.senderName || m.sender;
                  return (
                    <div key={i} style={{ alignSelf: isSelf ? 'flex-end' : 'flex-start', background: isSelf ? 'var(--primary)' : 'var(--surface)', color: isSelf ? 'white' : 'var(--text-main)', padding: '8px 12px', borderRadius: '12px', maxWidth: '80%', border: isSelf ? 'none' : '1px solid var(--border-light)' }}>
                      {!isSelf && <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', opacity: 0.8 }}>{senderName}</div>}
                      <div style={{ fontSize: '0.9rem' }}>{m.text}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.8, textAlign: 'right', marginTop: '4px' }}>{m.time}</div>
                    </div>
                  );
                })}
                  {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', margin: 'auto' }}>No messages yet. Say hi!</div>}
                </div>
                {typingUser && <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontStyle: 'italic', padding: '8px 16px 0', background: 'var(--secondary)' }}>{typingUser} is typing...</div>}
                <div style={{ padding: '10px', display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)' }}>
                  <input type="text" value={chatInput} onChange={(e) => {
                    setChatInput(e.target.value);
                    if (socket?.connected) {
                      socket.emit('typing', { jobId: activeJobId, senderName: user?.name?.split(' ')[0] || 'Customer' }); 
                      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                      typingTimeoutRef.current = setTimeout(() => socket.emit('stopTyping', { jobId: activeJobId }), 1500);
                    }
                  }} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} /> 
                  <button className="btn" style={{ padding: '10px 16px', borderRadius: '20px' }} onClick={handleSendMessage}><i className="fas fa-paper-plane"></i></button>
                </div>
              </div>
            </React.Fragment>
          )}
        </div>
      ) : (
        <div className="card" style={{ animation: 'fadeInUp 0.4s forwards' }}>
          <h3 style={{ marginBottom: '16px' }}><i className="fas fa-history" style={{ color: 'var(--primary)' }}></i> Your Job History</h3>
          {jobHistory.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No past jobs found.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {jobHistory.map(job => (
                <div key={job._id} style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '1.1rem', textTransform: 'capitalize' }}>{job.serviceType.replace('_', ' ')}</strong>
                    <span className="badge" style={{ background: job.status === 'completed' ? 'var(--success)' : (job.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)'), color: 'white' }}>{job.status}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}><i className="far fa-calendar-alt"></i> {new Date(job.createdAt).toLocaleDateString()}</div>
                  <div style={{ fontSize: '0.95rem', marginTop: '8px', fontWeight: 'bold', color: 'var(--primary)' }}>₹{job.estimatedPrice}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="mobile-bottom-nav">
        <div className={`nav-item ${currentTab === 'active' ? 'active' : ''}`} onClick={() => setCurrentTab('active')}>
          <i className="fas fa-bolt"></i><span>Services</span>
        </div>
        <div className={`nav-item ${currentTab === 'history' ? 'active' : ''}`} onClick={() => setCurrentTab('history')}>
          <i className="fas fa-receipt"></i><span>Orders</span>
        </div>
        <div className="nav-item" onClick={onEditProfile}>
          <i className="fas fa-user"></i><span>Profile</span>
        </div>
      </div>

      
      <div>
        <div className="card">
          <h4><i className="fas fa-star" style={{ color: 'var(--warning)' }}></i> Personalized For You</h4>
          <div style={{ marginTop: '12px', padding: '12px', background: 'var(--secondary)', borderRadius: '12px' }}>
            <p style={{ fontSize: '0.9rem', margin: 0 }}><strong>Seasonal Recommendation:</strong> It's getting hot! Book an AC servicing before the summer rush begins to ensure your unit is efficient.</p>
          </div>
        </div>
        <div className="card" style={{ animationDelay: '0.15s' }}>
          <h4><i className="fas fa-shield-halved" style={{ color: 'var(--success)' }}></i> Trust & Safety</h4>
          <ul style={{ marginTop: '12px', paddingLeft: '20px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            <li>100% Background verified professionals</li>
            <li>Up to ₹10,000 property damage protection</li>
            <li>30-day post-service warranty guarantee</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// --- Electrician Dashboard Component ---
function ElectricianHome({ user, showToast, onEditProfile }) {
  const { socket } = useSocket();
  const [isOnline, setIsOnline] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [availableJob, setAvailableJob] = useState(null);
  const [walletBal, setWalletBal] = useState(user?.walletBalance || 0);
  const [jobsCompleted, setJobsCompleted] = useState(user?.jobsCompleted || 0);
  const [currentJob, setCurrentJob] = useState(null); // Will hold the full job object
  const chatContainerRef = useRef(null);
  const [currentTab, setCurrentTab] = useState('active');
  const [jobHistory, setJobHistory] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const typingTimeoutRef = useRef(null);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [myLiveCoords, setMyLiveCoords] = useState(null);
  const [isAccepting, setIsAccepting] = useState(false);

  const jobStatus = currentJob?.status;
  const teamSize = currentJob?.teamSize || 1;
  const currentTeamSize = currentJob?.electricians?.length || 0;
  const isTeamJob = teamSize > 1;
  const isTeamWaiting = isTeamJob && jobStatus === 'searching' && currentTeamSize < teamSize;
  const isJobActive = jobStatus === 'assigned' || jobStatus === 'in_progress';
  const hasArrived = isJobActive && !isTracking; // Simplified logic for arrival

  useEffect(() => {
    if (isOnline) {
      socket.on('receiveMessage', (data) => {
        setMessages((prev) => [...prev, { ...data, isSelf: false }]);
      });
      socket.on('userTyping', (data) => setTypingUser(data.senderName));
      socket.on('userStopTyping', () => setTypingUser(null));
      socket.on('jobAccepted', (data) => {
        // This event fires when the team is full. If this electrician is part of the team, update their state.
        if (data.electricians.some(e => String(e._id) === String(user._id) || String(e.id) === String(user._id))) {
            setCurrentJob(prev => ({...prev, status: 'assigned', electricians: data.electricians}));
            setIsTracking(true); // All members start tracking when team is full
            showToast('Team is full! Job is now active.', 'success');
        }
      });
      socket.on('jobCancelled', () => {
        showToast('The customer cancelled the job.', 'warning');
        setIsTracking(false);
        setActiveJobId(null);
        setCurrentJob(null);
        setAvailableJob(null);
        setMessages([]);
      });
      socket.on('jobCompleted', () => {
        showToast('Customer marked job as complete! Earnings added to wallet.', 'success');
        // Refresh wallet balance
        fetchJson('/me').then(res => {
          setWalletBal(res.walletBalance);
          setJobsCompleted(res.jobsCompleted);
        }).catch(() => {});
          
          // Release the UI so the electrician can accept the next job
          setActiveJobId(null);
          setCurrentJob(null);
          setIsTracking(false);
          setMessages([]);
      });
      socket.on('teamMemberJoined', (data) => {
        setCurrentJob(prev => {
          if (!prev) return prev;
          if (prev.electricians.some(e => String(e._id) === String(data.electrician._id))) return prev;
          return { ...prev, electricians: [...prev.electricians, data.electrician] };
        });
      });
    } else {
      setIsTracking(false);
    }
    return () => {
      socket.off('receiveMessage');
      socket.off('jobAccepted');
      socket.off('jobCancelled');
      socket.off('jobCompleted');
      socket.off('teamMemberJoined');
      socket.off('userTyping');
      socket.off('userStopTyping');
    }; 
  }, [isOnline, showToast, user, socket]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (isOnline && activeJobId) {
      socket.emit('joinJobRoom', activeJobId);
    } 
  }, [isOnline, activeJobId, socket]);

  useEffect(() => {
    let pollInterval;
    let isMounted = true;
    if (isOnline && !currentJob) {
      const checkJobs = async () => {
        try {
          const job = await fetchJson('/jobs/available?latitude=12.9716&longitude=77.5946&maxDistance=15');
          if (!isMounted) return;
          // BUG FIX: Prevent setting empty objects as available jobs
          if (job && job._id) {
            setAvailableJob(job);
          } else {
            setAvailableJob(null);
          }
          // Do NOT set activeJobId here. It should only be set when the job is explicitly accepted.
        } catch (e) {
          console.error('Failed to fetch jobs:', e);
        }
      };
      checkJobs();
      
      // FIX: Actually start the interval so electricians don't miss jobs if they log in late
      pollInterval = setInterval(checkJobs, 10000); 

      const handleNewJob = (job) => {
        if (job.status === 'searching') {
          setAvailableJob(job);
        }
      };
      socket.on('newJobAvailable', handleNewJob);

      return () => {
        isMounted = false;
        clearInterval(pollInterval);
        socket.off('newJobAvailable', handleNewJob);
      };
    } 
  }, [isOnline, currentJob, socket]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    let isMounted = true;
    if (currentTab === 'history') {
      const fetchHistory = async () => {
        try {
          const data = await fetchJson('/jobs/history');
          if (isMounted) setJobHistory(Array.isArray(data) ? data : []);
        } catch (e) { if (isMounted) showToast('Failed to load history', 'error'); }
      };
      fetchHistory();
    }
    return () => { isMounted = false; };
  }, [currentTab, showToast]);

  // Render Job History Earnings Chart
  useEffect(() => {
    let retryCount = 0;
    let checkInterval;

    const renderChart = () => {
    if (currentTab === 'history' && jobHistory.length > 0 && chartRef.current) {
      if (!window.Chart || !chartRef.current) {
        if (retryCount < 10) {
          retryCount++;
          return; // Will be retried by interval
        } else {
          console.warn('Chart.js or canvas failed to load.');
          if (checkInterval) clearInterval(checkInterval);
          return;
        }
      }
      if (checkInterval) clearInterval(checkInterval);
      if (chartInstance.current) chartInstance.current.destroy();
      const ctx = chartRef.current.getContext('2d');
      
      const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - i); return d.toLocaleDateString();
      }).reverse();
      
      const earningsData = last7Days.map(date => {
        return jobHistory.filter(job => new Date(job.createdAt).toLocaleDateString() === date && job.status === 'completed')
          .reduce((sum, job) => sum + Math.round((job.estimatedPrice * 0.8) / Math.max(1, job.electricians?.length || 1)), 0);
      });

      chartInstance.current = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: last7Days.map(d => d.substring(0, 5)),
          datasets: [{
            label: 'Earnings (₹)', data: earningsData, borderColor: '#0d9488',
            backgroundColor: 'rgba(13, 148, 136, 0.2)', fill: true, tension: 0.4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }
    };

    renderChart();
    checkInterval = setInterval(renderChart, 500); // Retry every 500ms if script is slow to load

    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [currentTab, jobHistory]);

  useEffect(() => {
    let interval;
    if (isTracking) {
      let currentDist = 3.5;
      let currentEta = 12;
      interval = setInterval(() => {
        currentDist = Math.max(0, currentDist - 0.5);
        currentEta = Math.max(0, currentEta - 2);

        // Dynamically simulate movement towards the customer's actual coordinates
        const dest = currentJob?.location?.coordinates || [77.5946, 12.9716];
        const simulatedCoords = [
          dest[0] - (currentDist * 0.002), 
          dest[1] - (currentDist * 0.002)
        ];
        setMyLiveCoords(simulatedCoords);

        socket.emit('updateLocation', {
          jobId: activeJobId,
          coordinates: simulatedCoords,
          distance: currentDist.toFixed(1),
          eta: currentEta
        });
        if (currentDist <= 0) {
          setIsTracking(false);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isTracking, activeJobId, socket]);

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const msgData = {
      jobId: activeJobId,
      senderId: user.id || user._id,
      senderName: user?.name || 'Electrician',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('sendMessage', msgData);
    setMessages((prev) => [...prev, { ...msgData, isSelf: true }]);
    setChatInput('');
  };

  const handleAcceptJob = async () => {
    if (isAccepting) return;
    setIsAccepting(true);
    try {
      const acceptedJob = await fetchJson(`/jobs/${availableJob._id}/accept`, { method: 'PUT' });
      
      // Fix: Join room AFTER API responds successfully to prevent phantom socket connections if API fails
      socket.emit('joinJobRoom', availableJob._id);
      setActiveJobId(availableJob._id); // Link the job and join the chat room only AFTER accepting
      setAvailableJob(null);
      setCurrentJob(acceptedJob); // Set the full job object
      
      // Prevent socket race condition: if the team is already full upon acceptance, start tracking instantly
      if (acceptedJob.status === 'assigned') {
        setIsTracking(true);
      }
    } catch (error) {
      showToast(error.message, 'error');
      showToast(error.message.includes('Network') ? error.message : 'Failed to accept job.', 'error');
      // FIX: Clear the stale job so polling can find a fresh one
      setAvailableJob(null);
      setActiveJobId(null);
    } finally {
      setIsAccepting(false);
    }
  };

  const handleRequestWithdrawal = async () => {
    try {
      const res = await fetchJson('/withdrawals', { method: 'POST' });
      showToast('Withdrawal request sent to Admin.', 'success');
      setWalletBal(0); // Optimistically set to 0
    } catch (error) {
      showToast(error.message, 'error');
      showToast(error.message.includes('Network') ? error.message : 'Failed to cancel job.', 'error');
    }
  };

  return (
    <div className="dashboard-grid">
      <div>
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '1.4rem' }}><i className="fas fa-toolbox" style={{ color: 'var(--primary)' }}></i> Welcome back, {user?.name?.split(' ')[0] || 'User'}</h3>
            <button className={`btn ${isOnline ? '' : 'btn-outline'}`} onClick={() => setIsOnline(!isOnline)}>
              {isOnline ? <React.Fragment><span className="pulse-dot" style={{ marginRight: '8px' }}></span>Online</React.Fragment> : 'Go Online'}
            </button>
          </div>
            <div className="inline-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '16px' }}>
              <div style={{ flex: '1 1 200px', padding: '16px', background: 'var(--secondary)', borderRadius: '16px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase' }}>WALLET BALANCE</span>
              <h2 style={{ color: 'var(--success)', fontSize: '2.2rem', margin: '4px 0 0 0' }}>₹{walletBal.toFixed(0)}</h2>
            </div>
              <div style={{ flex: '1 1 200px', padding: '16px', background: 'var(--secondary)', borderRadius: '16px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase' }}>JOBS COMPLETED</span>
              <h2 style={{ color: 'var(--text-main)', fontSize: '2.2rem', margin: '4px 0 0 0' }}>{jobsCompleted}</h2>
            </div>
          </div>
        </div>

        <div className="desktop-tabs" style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <button className={`btn ${currentTab === 'active' ? '' : 'btn-outline'}`} style={{ flex: 1, padding: '10px' }} onClick={() => setCurrentTab('active')}>Workspace</button>
          <button className={`btn ${currentTab === 'history' ? '' : 'btn-outline'}`} style={{ flex: 1, padding: '10px' }} onClick={() => setCurrentTab('history')}>Job History</button>
        </div>

        {currentTab === 'active' ? (
          <React.Fragment>
        {isOnline && !currentJob && (
          <div className="card" style={{ animationDelay: '0.1s', border: 'none', background: 'var(--primary-light)', boxShadow: 'none' }}>
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{ width: '80px', height: '80px', background: 'var(--surface)', borderRadius: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', boxShadow: '0 0 0 10px rgba(255,255,255,0.5)' }}>
                <i className="fas fa-radar fa-spin fa-2x" style={{ color: 'var(--primary)' }}></i>
              </div>
              <h4>Searching for nearby jobs...</h4>
              {!availableJob ? (
                <p style={{ color: 'var(--text-muted)' }}>We are matching you with customers within a 10km radius.</p>
              ) : (
                <div style={{ marginTop: '24px', padding: '20px', background: 'var(--surface)', borderRadius: '16px', border: '2px solid var(--success)', boxShadow: 'var(--shadow-lg)' }}>
                  <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)', marginBottom: '12px', display: 'inline-block' }}>NEW MATCH FOUND</span>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}><strong>Service:</strong> {availableJob.serviceType}</p>
                  <p style={{ margin: '4px 0 12px 0', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    <strong>Location:</strong> <a href={`https://www.openstreetmap.org/?mlat=${availableJob.location?.coordinates?.[1]}&mlon=${availableJob.location?.coordinates?.[0]}#map=16/${availableJob.location?.coordinates?.[1]}/${availableJob.location?.coordinates?.[0]}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{availableJob.address} <i className="fas fa-external-link-alt"></i></a>
                  </p>
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Job ID: <span style={{ fontFamily: 'monospace' }}>{availableJob._id}</span></p>
                  <button className="btn" style={{ width: '100%', background: 'var(--success)', marginTop: '8px' }} onClick={handleAcceptJob} disabled={isAccepting}>
                    {isAccepting ? 'Accepting...' : 'Accept Job & Start Tracking'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentJob && (
          <div className="card" style={{ animationDelay: '0.1s', border: '2px solid var(--success)', background: 'rgba(16, 185, 129, 0.1)' }}>
            <div style={{ textAlign: 'center', padding: '20px' }}>
              {isTeamWaiting ? (
                <React.Fragment>
                    <i className="fas fa-users fa-3x" style={{ color: 'var(--primary)', marginBottom: '16px' }}></i>
                    <h4 style={{ color: 'var(--primary)' }}>Waiting for Team</h4>
                    <p style={{ color: 'var(--text-main)' }}>{currentTeamSize} of {teamSize} electricians have joined. The job will start when the team is full.</p>
                </React.Fragment>
              ) : isTracking ? (
                <React.Fragment>
                  <i className="fas fa-location-arrow fa-fade fa-3x" style={{ color: 'var(--success)', marginBottom: '16px' }}></i>
                  <h4 style={{ color: 'var(--success)' }}>En Route to Customer</h4>
                  <p style={{ color: 'var(--text-main)' }}>Live location sharing is active. The customer is seeing your approach!</p>
                  {myLiveCoords && currentJob?.location?.coordinates && (
                    <TrackingMap origin={currentJob.location.coordinates} destination={myLiveCoords} />
                  )}
                </React.Fragment>
              ) : hasArrived ? (
                <React.Fragment>
                  <i className="fas fa-map-pin fa-3x" style={{ color: 'var(--primary)', marginBottom: '16px' }}></i>
                  <h4 style={{ color: 'var(--primary)' }}>You Have Arrived</h4>
                  <p style={{ color: 'var(--text-main)' }}>You can now begin the service. Message the customer if needed.</p>
                  <p style={{ margin: '12px 0 0 0', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    <strong>Job Location:</strong> <a href={`https://www.openstreetmap.org/?mlat=${currentJob.location?.coordinates?.[1]}&mlon=${currentJob.location?.coordinates?.[0]}#map=16/${currentJob.location?.coordinates?.[1]}/${currentJob.location?.coordinates?.[0]}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{currentJob.address} <i className="fas fa-external-link-alt"></i></a>
                  </p>
                </React.Fragment>
              ) : null}
              <p style={{ color: 'var(--warning)', marginTop: '16px', fontWeight: 'bold' }}>
                <i className="fas fa-info-circle"></i> Ask the customer to mark the job as 'Done' on their app when finished to receive your payout.
              </p>
            </div>
        
        <div style={{ marginTop: '16px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ background: 'var(--primary)', color: 'white', padding: '10px 16px', fontWeight: 'bold' }}>
            <i className="fas fa-comments"></i> Team & Customer Chat
          </div>
          <div ref={chatContainerRef} style={{ padding: '16px', height: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--secondary)' }}>
            {messages.map((m, i) => {
              const isSelf = m.isSelf || m.sender === 'self';
              const senderName = m.senderName || m.sender;
              return (
                <div key={i} style={{ alignSelf: isSelf ? 'flex-end' : 'flex-start', background: isSelf ? 'var(--primary)' : 'var(--surface)', color: isSelf ? 'white' : 'var(--text-main)', padding: '8px 12px', borderRadius: '12px', maxWidth: '80%', border: isSelf ? 'none' : '1px solid var(--border-light)' }}>
                  {!isSelf && <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', opacity: 0.8 }}>{senderName}</div>}
                  <div style={{ fontSize: '0.9rem' }}>{m.text}</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.8, textAlign: 'right', marginTop: '4px' }}>{m.time}</div>
                </div>
              );
            })}
            {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', margin: 'auto' }}>No messages yet. Send an update!</div>}
          </div>
              {typingUser && <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontStyle: 'italic', padding: '8px 16px 0', background: 'var(--secondary)' }}>{typingUser} is typing...</div>}
          <div style={{ padding: '10px', display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)' }}>
                <input type="text" value={chatInput} onChange={(e) => {
                  setChatInput(e.target.value);
                  if (socket?.connected) {
                    socket.emit('typing', { jobId: activeJobId, senderName: user?.name?.split(' ')[0] || 'Electrician' }); 
                    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                    typingTimeoutRef.current = setTimeout(() => socket.emit('stopTyping', { jobId: activeJobId }), 1500);
                  }
                }} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} /> 
            <button className="btn" style={{ padding: '10px 16px', borderRadius: '20px' }} onClick={handleSendMessage}><i className="fas fa-paper-plane"></i></button>
          </div>
        </div>
          </div>
        )}

        <div className="card" style={{ animationDelay: '0.2s' }}>
          <h4><i className="fas fa-book-open"></i> Work Manual & Safety Guidelines</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '12px' }}>Review these personalized protocols before starting your assigned jobs today.</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ padding: '12px', borderLeft: '4px solid var(--danger)', background: 'var(--secondary)', borderRadius: '0 8px 8px 0' }}>
              <strong>High Voltage Safety</strong>
              <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-muted)' }}>Always use a non-contact voltage tester before touching exposed wires. Wear Class 0 rubber gloves for panels up to 1,000V.</p>
            </div>
            <div style={{ padding: '12px', borderLeft: '4px solid var(--primary)', background: 'var(--secondary)', borderRadius: '0 8px 8px 0' }}>
              <strong>EV Charger Installation Prep</strong>
              <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-muted)' }}>Verify home load capacity before quoting. Ensure minimum 8 AWG copper wire is used for standard 40A breakers.</p>
            </div>
            <div style={{ padding: '12px', borderLeft: '4px solid var(--warning)', background: 'var(--secondary)', borderRadius: '0 8px 8px 0' }}>
              <strong>Customer Etiquette</strong>
              <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-muted)' }}>Always wear protective shoe covers when entering a home. Clearly explain the issue and price breakdown before starting repairs.</p>
            </div>
          </div>
        </div>
        </React.Fragment>
        ) : (
          <div className="card" style={{ animation: 'fadeInUp 0.4s forwards' }}>
            <h3 style={{ marginBottom: '16px' }}><i className="fas fa-history" style={{ color: 'var(--primary)' }}></i> Your Job History</h3>
            {jobHistory.length > 0 && (
              <div style={{ marginBottom: '20px', height: '180px', width: '100%' }}>
                <canvas ref={chartRef}></canvas>
              </div>
            )}
            {jobHistory.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No past jobs found.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {jobHistory.map(job => (
                  <div key={job._id} style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '1.1rem', textTransform: 'capitalize' }}>{job.serviceType.replace('_', ' ')}</strong>
                      <span className="badge" style={{ background: job.status === 'completed' ? 'var(--success)' : (job.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)'), color: 'white' }}>{job.status}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}><i className="far fa-calendar-alt"></i> {new Date(job.createdAt).toLocaleDateString()}</div>
                    <div style={{ fontSize: '0.95rem', marginTop: '8px', fontWeight: 'bold', color: 'var(--primary)' }}>Earnings: <span style={{ color: 'var(--success)' }}>₹{Math.round((job.estimatedPrice * 0.8) / Math.max(1, job.electricians?.length || 1))}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="mobile-bottom-nav">
        <div className={`nav-item ${currentTab === 'active' ? 'active' : ''}`} onClick={() => setCurrentTab('active')}>
          <i className="fas fa-toolbox"></i><span>Workspace</span>
        </div>
        <div className={`nav-item ${currentTab === 'history' ? 'active' : ''}`} onClick={() => setCurrentTab('history')}>
          <i className="fas fa-receipt"></i><span>History</span>
        </div>
        <div className="nav-item" onClick={onEditProfile}>
          <i className="fas fa-user"></i><span>Profile</span>
        </div>
      </div>

      <div>
        <div className="earnings-card" style={{ animationDelay: '0.15s' }}>
          <i className="fas fa-wallet"></i> <strong>Available for Withdrawal</strong>
          <h3 style={{ margin: '8px 0' }}>₹{walletBal.toFixed(0)}</h3>
          <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>Min withdrawal: ₹500. 20% platform commission applied.</p>
          <button className="btn btn-block" disabled={walletBal < 500} onClick={handleRequestWithdrawal} style={{ background: walletBal >= 500 ? 'var(--success)' : 'rgba(255,255,255,0.2)', color: 'white', marginTop: '12px' }}>
            {walletBal >= 500 ? 'Request Bank Withdrawal' : 'Balance too low'}
          </button>
        </div>
        
        <div className="card" style={{ animationDelay: '0.2s', marginTop: '20px' }}>
          <h4><i className="fas fa-certificate"></i> Your Active Skills</h4>
          <div className="tag-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            <span className="review-tag selected">Wiring Repair</span>
            <span className="review-tag selected">AC Servicing</span>
            <span className="review-tag selected">Smart Home Setup</span>
          </div>
          <button className="btn-outline btn btn-block" style={{ marginTop: '16px', fontSize: '0.9rem' }}>+ Add New Certification</button>
        </div>

        <div className="card" style={{ animationDelay: '0.25s', marginTop: '20px' }}>
          <h4><i className="fas fa-calendar-check" style={{ color: 'var(--primary)' }}></i> Upcoming Schedule</h4>
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px', background: 'var(--secondary)', borderRadius: '12px' }}>
              <div style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '10px', borderRadius: '8px', textAlign: 'center', minWidth: '55px' }}>
                <strong style={{ display: 'block', fontSize: '1.1rem' }}>14</strong>
                <small style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Aug</small>
              </div>
              <div>
                <strong style={{ display: 'block', color: 'var(--text-main)' }}>AC Installation</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}><i className="far fa-clock"></i> 10:00 AM - 12:00 PM</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}><i className="fas fa-map-marker-alt"></i> Koramangala, BLR</span>
              </div>
            </div>
            <button className="btn-outline btn btn-block" style={{ fontSize: '0.9rem' }}>View Full Calendar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Admin Dashboard Components ---
const mockLogs = [
  { time: '10:42:01 AM', level: 'INFO', src: 'AuthService', event: 'User Login', details: 'ELC-2041 authenticated successfully.' },
{ time: '10:45:12 AM', level: 'WARN', src: 'GeoTracker', event: 'High Latency', details: 'Location tracking API response > 500ms' },
{ time: '10:48:33 AM', level: 'INFO', src: 'JobService', event: 'Job Created', details: 'USR-1004 requested Smart Home setup.' },
{ time: '10:50:05 AM', level: 'INFO', src: 'JobMatching', event: 'Electrician Assigned', details: 'ELC-2042 accepted job from USR-1004.' },
{ time: '10:55:20 AM', level: 'ERROR', src: 'PaymentGateway', event: 'Transaction Failed', details: 'Payment timeout for USR-1002.' },
{ time: '11:02:15 AM', level: 'INFO', src: 'AuthService', event: 'User Logout', details: 'ELC-2043 disconnected.' }
];

function MetricCard({ icon, title, value, trend, color }) {
  return (
    <div className="admin-metric-card" style={{ background: 'var(--surface)', padding: '20px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>{title}</p>
          <h2 style={{ margin: '8px 0', color: 'var(--text-main)', fontSize: '1.8rem' }}>{value}</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem' }}>{trend}</p>
        </div>
        <div style={{ width: '45px', height: '45px', borderRadius: '12px', background: `${color}20`, color: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
          <i className={`fas ${icon}`}></i>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button 
      onClick={onClick}
      style={{
        padding: '10px 20px',
        background: active ? 'var(--primary)' : 'var(--surface)',
        color: active ? 'white' : 'var(--text-main)',
        border: '1px solid',
        borderColor: active ? 'var(--primary)' : 'var(--border-light)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: 600,
        transition: 'all 0.2s'
      }}>
      <i className={`fas ${icon}`} style={{ marginRight: '8px' }}></i> {label}
    </button>
  );
}

const generateMockUsers = () => {
  const firstNames = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anita', 'Karan', 'Neha', 'Rajesh', 'Pooja', 'Suresh', 'Kavita', 'Ramesh', 'Riya', 'Mohit', 'Anjali', 'Deepak', 'Swati', 'Sanjay', 'Meera'];
  const lastNames = ['Sharma', 'Patel', 'Verma', 'Reddy', 'Singh', 'Desai', 'Malhotra', 'Kapoor', 'Kumar', 'Jain', 'Gupta', 'Rao', 'Iyer', 'Menon', 'Nair', 'Bhat', 'Joshi', 'Chawla', 'Das', 'Sen'];
  
  const mockUsers = [];
  for (let i = 1; i <= 125; i++) {
    const isCustomer = Math.random() > 0.35;
    const fName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lName = lastNames[Math.floor(Math.random() * lastNames.length)];
    mockUsers.push({
      _id: `MOCK-${1000 + i}`,
      role: isCustomer ? 'customer' : 'electrician',
      name: `${fName} ${lName}`,
      phone: `+91 9${Math.floor(100000000 + Math.random() * 900000000)}`,
      status: Math.random() > 0.2 ? 'Active' : 'Offline'
    });
  }
  return mockUsers;
};

function AdminPanel({ user, onLogout, showToast }) {
  const { socket } = useSocket();
  const [activeTab, setActiveTab] = useState('database');
  const [searchTerm, setSearchTerm] = useState('');
  const [liveData, setLiveData] = useState([]);
  const [mockData, setMockData] = useState([]);
  const [useMockData, setUseMockData] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [financeData, setFinanceData] = useState({ pendingJobs: [], pendingWithdrawals: [] });
  const [isDownloading, setIsDownloading] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');

  const fetchDashboardData = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const users = await fetchJson('/admin/users');
      setLiveData(Array.isArray(users) ? users : []);
      const fin = await fetchJson('/admin/finance');
      setFinanceData(fin && Array.isArray(fin.pendingJobs) ? fin : { pendingJobs: [], pendingWithdrawals: [] });
    } catch (error) {
      showToast(`Failed to fetch dashboard data: ${error.message}`, 'error');
      console.error('Dashboard error:', error);
      showToast('Failed to fetch dashboard data.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchDashboardData();
    setMockData(generateMockUsers());

    const handleAdminRefresh = () => fetchDashboardData();
    socket.on('adminRefresh', handleAdminRefresh);

    return () => {
      socket.off('adminRefresh', handleAdminRefresh);
    };
  }, [socket, fetchDashboardData]);

  // Anime.js Dashboard Entrance Animation
  useEffect(() => {
    if (typeof window !== 'undefined' && window.anime) {
      window.anime({
        targets: '.admin-metric-card',
        translateY: [30, 0],
        opacity: [0, 1],
        delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(150) : 0,
        duration: 800,
        easing: 'easeOutCubic'
      });
    }
  }, []);

  const currentData = useMockData ? mockData : (Array.isArray(liveData) ? liveData : []);

  const filteredDB = currentData.filter(row => 
    row && Object.values(row).some(val =>
      val != null && String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const handleDownloadReport = async () => {
    try {
      setIsDownloading(true);
      const jobs = await fetchJson('/admin/reports/completed-jobs');
      
      if (!jobs || jobs.length === 0) {
        showToast('No completed jobs found to generate a report.', 'warning');
        return;
      }
      
      // Construct CSV headers and rows
      const headers = ['Job ID', 'Service Type', 'Address', 'Estimated Price (INR)', 'Customer Name', 'Customer Phone', 'Assigned Electricians', 'Completed At'];
      const csvRows = [headers.join(',')];
      
      jobs.forEach(job => {
        const customerName = job.customer ? `"${job.customer.name}"` : 'N/A';
        const customerPhone = job.customer ? `"${job.customer.phone}"` : 'N/A';
        const electricians = job.electricians && job.electricians.length > 0 
          ? `"${job.electricians.map(e => e?.name || 'Unknown').join(' & ')}"` 
          : 'None';
        const completedAt = new Date(job.updatedAt).toLocaleString();
        
        const row = [
          job._id, `"${job.serviceType}"`, `"${job.address}"`, job.estimatedPrice,
          customerName, customerPhone, electricians, `"${completedAt}"`
        ];
        csvRows.push(row.join(','));
      });
      
      // Trigger file download
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', `Completed_Jobs_Report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      showToast('Report generated successfully!', 'success');
    } catch (error) {
      showToast(`Failed to generate report: ${error.message}`, 'error');
      console.error('Report error:', error);
      showToast('Failed to generate report.', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleApprovePayment = async (id) => {
    try {
      await fetchJson(`/admin/jobs/${id}/verify-payment`, { method: 'PUT' });
      showToast('Payment verified. Job is now active.', 'success');
      // The WebSocket 'adminRefresh' event will automatically pull the fresh lists
      } catch (e) {
        console.error('Payment approval error:', e); 
        showToast('Failed to verify payment.', 'error'); 
    }
  };

  const handleApproveWithdrawal = async (id) => {
    try {
      await fetchJson(`/admin/withdrawals/${id}/approve`, { method: 'PUT' });
      showToast('Withdrawal approved.', 'success');
      // The WebSocket 'adminRefresh' event will automatically pull the fresh lists
      } catch (e) { 
        console.error('Withdrawal error:', e);
        showToast('Failed to approve withdrawal.', 'error'); 
    }
  };

  const handleBroadcast = async () => {
    if(!broadcastMsg.trim()) return;
    try {
      await fetchJson('/admin/broadcast', { method: 'POST', body: { message: broadcastMsg.trim() } });
      showToast('Broadcast sent to all active users!', 'success');
      setBroadcastMsg('');
      } catch(e) { 
      console.error('Broadcast error:', e);
      showToast('Failed to send broadcast.', 'error'); 
    }
  };

  return (
    <div style={{ padding: '0', fontFamily: 'var(--font-family, sans-serif)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: 'var(--surface)', padding: '16px 24px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--danger)', color: 'white', padding: '10px', borderRadius: '12px' }}>
            <i className="fas fa-user-shield fa-lg"></i>
          </div>
          <div>
            <h2 style={{ margin: 0, color: 'var(--danger)' }}>Master Admin Portal</h2>
            <span style={{ fontSize: '0.85rem', color: useMockData ? 'var(--warning)' : 'var(--text-muted)', fontWeight: useMockData ? 'bold' : 'normal' }}>
              {useMockData ? '⚠️ Connected to Local Mock Database' : 'Connected to Production Database'}
            </span>
          </div>
        </div>
        <button className="btn btn-outline" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onLogout}>
          <i className="fas fa-power-off"></i> Terminate Session
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <input type="text" value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)} placeholder="Type a system-wide broadcast message..." className="form-control" style={{ margin: 0, flex: 1 }} />
        <button className="btn" style={{ background: 'var(--warning)' }} onClick={handleBroadcast}><i className="fas fa-bullhorn"></i> Send Broadcast</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <MetricCard icon="fa-users" title="Total Users" value={currentData.length.toLocaleString()} trend={useMockData ? "Mock Data Generated" : "+12% this week"} color="var(--primary)" />
        <MetricCard icon="fa-helmet-safety" title="Active Electricians" value="842" trend="124 currently online" color="var(--warning)" />
        <MetricCard icon="fa-indian-rupee-sign" title="Platform Revenue" value="₹12.4L" trend="3% fee taken" color="var(--success)" />
        <MetricCard icon="fa-server" title="System Uptime" value="99.99%" trend="All systems nominal" color="var(--text-main)" />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <TabButton active={activeTab === 'database'} onClick={() => setActiveTab('database')} icon="fa-database" label="Global Database" />
        <TabButton active={activeTab === 'finance'} onClick={() => setActiveTab('finance')} icon="fa-indian-rupee-sign" label="Finance & Approvals" />
        <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon="fa-terminal" label="System Logs" />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 600, background: 'var(--surface)', padding: '8px 16px', borderRadius: '30px', border: '1px solid var(--border-light)' }}>
            <input type="checkbox" checked={useMockData} onChange={(e) => setUseMockData(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }} />
            Demo Mode
          </label>
        <button className="btn btn-outline" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} onClick={fetchDashboardData} disabled={isLoading}>
          <i className={`fas ${isLoading ? 'fa-spinner fa-spin' : 'fa-sync'}`}></i> Refresh Data
        </button>
          <button className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={handleDownloadReport} disabled={isDownloading}>
            <i className={`fas ${isDownloading ? 'fa-spinner fa-spin' : 'fa-file-csv'}`}></i> {isDownloading ? 'Generating...' : 'Export Completed Jobs'}
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: '16px', boxShadow: 'var(--shadow-md)', overflow: 'hidden', border: '1px solid var(--border-light)' }}>
        {activeTab === 'database' && (
          <div>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-light)', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}><i className="fas fa-table" style={{ color: 'var(--primary)' }}></i> Master Records</h3>
              <input type="text" aria-label="Search records" placeholder="Search IDs, Names, Locations..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border-light)', width: '100%', maxWidth: '300px', outline: 'none' }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>System ID</th>
                    <th style={{ padding: '14px 16px' }}>Type</th>
                    <th style={{ padding: '14px 16px' }}>Full Name</th>
                    <th style={{ padding: '14px 16px' }}>Phone Number</th>
                    <th style={{ padding: '14px 16px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && !useMockData ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>
                        <i className="fas fa-spinner fa-spin fa-2x" style={{ color: 'var(--primary)' }}></i>
                        <p style={{ marginTop: '10px', color: 'var(--text-muted)' }}>Loading Live Data...</p>
                      </td>
                    </tr>
                  ) : filteredDB.map((row, idx) => (
                    <tr key={row._id} style={{ borderBottom: '1px solid var(--border-light)', background: idx % 2 === 0 ? 'transparent' : 'var(--secondary)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row._id}</td>
                      <td style={{ padding: '14px 16px' }}><span className="badge" style={{ textTransform: 'capitalize', background: row.role === 'customer' ? 'var(--primary-light)' : '#fffbeb', color: row.role === 'customer' ? 'var(--primary)' : 'var(--warning)' }}>{row.role}</span></td>
                      <td style={{ padding: '14px 16px', fontWeight: 500 }}>{row.name}</td>
                      <td style={{ padding: '14px 16px' }}><i className="fas fa-phone" style={{ color: 'var(--text-muted)', marginRight: '8px' }}></i> {row.phone}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ color: (row.status === 'Offline' || row.status === 'Inactive') ? 'var(--text-muted)' : 'var(--success)', fontWeight: 600 }}>
                          • {row.status || 'Active'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'finance' && (
          <div style={{ padding: '20px' }}>
            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-receipt"></i> Pending User Payments</h3>
            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
          {(financeData.pendingJobs || []).length === 0 && <p style={{ color: 'var(--text-muted)' }}>No payments pending verification.</p>}
          {(financeData.pendingJobs || []).map(job => (
                <div key={job._id} style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{job.serviceType}</strong> - ₹{job.estimatedPrice} <br/>
                    <small>Customer: {job.customer?.name} ({job.customer?.phone})</small>
                  </div>
                  <button className="btn" style={{ background: 'var(--success)' }} onClick={() => handleApprovePayment(job._id)}>Approve Payment</button>
                </div>
              ))}
            </div>

            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-money-bill-transfer"></i> Withdrawal Requests</h3>
            <div style={{ display: 'grid', gap: '12px' }}>
          {(financeData.pendingWithdrawals || []).length === 0 && <p style={{ color: 'var(--text-muted)' }}>No pending withdrawal requests.</p>}
          {(financeData.pendingWithdrawals || []).map(req => (
                <div key={req._id} style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>Electrician: {req.electrician?.name}</strong> <br/>
                    <small>Phone: {req.electrician?.phone}</small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <strong style={{ fontSize: '1.2rem' }}>₹{req.amount}</strong>
                    <button className="btn" style={{ background: 'var(--primary)' }} onClick={() => handleApproveWithdrawal(req._id)}>Mark as Transferred</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'logs' && (
          <div style={{ background: '#0f172a', color: '#e2e8f0', minHeight: '500px', padding: '16px', overflowX: 'auto' }}>
            {mockLogs.map((log, idx) => (
              <div key={idx} style={{ marginBottom: '10px', display: 'flex', gap: '16px', paddingBottom: '10px', borderBottom: '1px dashed #1e293b', minWidth: '600px' }}>
                <span style={{ color: '#64748b' }}>[{log.time}]</span>
                <span style={{ color: log.level === 'INFO' ? '#38bdf8' : '#fbbf24', fontWeight: 'bold', width: '60px' }}>{log.level}</span>
                <span style={{ color: '#c084fc', width: '150px' }}>{log.src}</span>
                <span style={{ color: '#f8fafc', flex: 1 }}>{log.event}: <span style={{ color: '#94a3b8' }}>{log.details}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 3. MAIN APP BOOTSTRAP
// ==========================================
function AppContent() {
  const { socket } = useSocket();
  const [user, setUser] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('wattzen_theme') === 'dark');
  const [toasts, setToasts] = useState([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // CONSOLIDATED HANDLERS: These must only be declared once and BEFORE useEffects that depend on them.
  const showToast = React.useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const handleLoginSuccess = (userData, role) => {
    const userWithRole = { ...userData, role };
    setUser(userWithRole);
    localStorage.setItem('user', JSON.stringify(userWithRole));
    navigate(`/${role}`);
  };

  const handleProfileUpdate = (updatedUser) => {
    const userWithRole = { ...updatedUser, role: user.role };
    setUser(userWithRole);
    localStorage.setItem('user', JSON.stringify(userWithRole));
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    navigate('/login');
  };

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('wattzen_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  useEffect(() => {
    if (isDarkMode) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
  }, [isDarkMode]);

  // Dynamic Maps and Script Error Handlers
  useEffect(() => {
    const checkScripts = () => {
      if (window.scriptLoadErrors && window.scriptLoadErrors.length > 0) {
        showToast(`Failed to load: ${window.scriptLoadErrors.join(', ')}. Some features may not work.`, 'error');
      }
    };
    const timer = setTimeout(checkScripts, 5000);
    return () => clearTimeout(timer);
  }, [showToast]);

  useEffect(() => {
    const handleAuthExpired = () => {
      showToast('Session expired. Please log in again.', 'warning');
      handleLogout();
    };
    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, [showToast]);

  useEffect(() => {
    let isMounted = true;
    const validateSession = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        if (location.pathname !== '/' && location.pathname !== '/login') {
          navigate('/login');
        }
        if (isMounted) setIsInitializing(false);
        return;
      }

      // Add a timeout safeguard to ensure the UI eventually loads
      const timeoutId = setTimeout(() => {
        if (isMounted) setIsInitializing(false);
      }, 5000);

      try {
        // BUG FIX: Stale user data in localStorage.
        // Verify token by fetching the latest user data from the server.
        const freshUser = await fetchJson('/me');
        if (!isMounted) return;
        if (freshUser && freshUser._id) {
          const userWithRole = { ...freshUser, role: freshUser.role };
          setUser(userWithRole);
          localStorage.setItem('user', JSON.stringify(userWithRole));
          
          // Redirect logged-in users away from auth pages, or if they try accessing the wrong role dashboard
          if (location.pathname === '/' || location.pathname === '/login' || !location.pathname.startsWith(`/${freshUser.role}`)) {
            navigate(`/${freshUser.role}`);
          }
        } else {
          throw new Error('Invalid user data received from server.');
        }
      } catch (error) {
        console.error("Session validation failed:", error.message);
        if (isMounted) handleLogout();
      } finally {
        if (isMounted) {
          setIsInitializing(false);
          clearTimeout(timeoutId);
        }
      }
    };
    validateSession();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global socket listener for Admin Broadcasts and connection management
  useEffect(() => {
    if (user) {
      if (!socket.connected) socket.connect();
      const handleBroadcast = (msg) => showToast(`📢 Admin Broadcast: ${msg}`, 'warning');
      socket.on('systemBroadcast', handleBroadcast);
      
      return () => {
        socket.off('systemBroadcast', handleBroadcast);
      };
    } else {
      // If there's no user, disconnect the socket.
      if (socket.connected) socket.disconnect();
    }
  }, [user, showToast, socket]);

  const handleSecretAdminLogin = async () => {
    const pwd = prompt("Enter Admin Secret PIN:");
    if (!pwd) return;
    try {
      const data = await fetchJson('/admin/secret-login', { method: 'POST', body: { password: pwd.trim() } });
      localStorage.setItem('token', data.token);
      const userWithRole = { ...data.user, role: 'admin' };
      setUser(userWithRole);
      localStorage.setItem('user', JSON.stringify(userWithRole));
      navigate('/admin');
      showToast('Master Access Granted', 'success');
    } catch(e) {
      showToast(e.message || 'Access Denied', 'error');
    }
  };

  if (isInitializing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}>
        <i className="fas fa-spinner fa-spin fa-3x" style={{ color: 'var(--primary)' }}></i>
      </div>
    );
  }

  const isAuthView = location.pathname === '/' || location.pathname === '/login';

  return (
    <div className="app-container" style={{ 
      animation: isAuthView ? 'none' : 'fadeIn 0.5s forwards',
      maxWidth: isAuthView ? '100%' : '1200px',
      padding: isAuthView ? '0' : '16px'
    }}>
      <Routes>
        <Route path="/" element={user ? <Navigate to={`/${user.role}`} replace /> : <Landing onEnter={() => navigate('/login')} onSecret={handleSecretAdminLogin} />} />
        <Route path="/login" element={user ? <Navigate to={`/${user.role}`} replace /> : <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />} />
        
        <Route path="/admin" element={user?.role === 'admin' ? <AdminPanel user={user} onLogout={handleLogout} showToast={showToast} /> : <Navigate to="/login" replace />} />
        
        <Route path="/customer" element={user?.role === 'customer' ? (
          <React.Fragment>
            <Navbar user={user} onLogout={handleLogout} toggleTheme={toggleTheme} isDarkMode={isDarkMode} onEditProfile={() => setIsProfileModalOpen(true)} />
            <div style={{ padding: '20px 0' }}><CustomerHome user={user} showToast={showToast} onEditProfile={() => setIsProfileModalOpen(true)} /></div>
          </React.Fragment>
        ) : <Navigate to="/login" replace />} />

        <Route path="/electrician" element={user?.role === 'electrician' ? (
          <React.Fragment>
            <Navbar user={user} onLogout={handleLogout} toggleTheme={toggleTheme} isDarkMode={isDarkMode} onEditProfile={() => setIsProfileModalOpen(true)} />
            <div style={{ padding: '20px 0' }}><ElectricianHome user={user} showToast={showToast} onEditProfile={() => setIsProfileModalOpen(true)} /></div>
          </React.Fragment>
        ) : <Navigate to="/login" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {isProfileModalOpen && <ProfileModal user={user} onClose={() => setIsProfileModalOpen(false)} onUpdate={handleProfileUpdate} showToast={showToast} onLogout={handleLogout} />}

      {/* Global Toast Notifications */}
      <div id="toastContainer">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-message show ${t.type}`}>
            <i className={`fas ${t.type === 'error' ? 'fa-exclamation-circle' : t.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-check-circle'}`}></i>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}