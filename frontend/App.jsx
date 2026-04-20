import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';

import logoImage from './wmremove-transformed.png';
import { useSocket } from './SocketContext.jsx';

// ==========================================
// 1. API & SOCKET UTILITIES
// ==========================================
if (typeof window !== 'undefined' && window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && !window.location.hostname.startsWith('192.168.') && !window.location.hostname.startsWith('10.')) {
  window.location.href = window.location.href.replace('http:', 'https:');
}

// Dynamically connect Frontend -> Backend (Local port 5000 for dev, Render for production)
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'));
const BASE_URL = import.meta.env.VITE_API_URL || (isLocal ? `http://${window.location.hostname}:5000` : 'https://voltflow-backend.onrender.com');
const API_BASE_URL = `${BASE_URL}/api`;

async function fetchJson(url, options = {}, retries = 2) {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const headers = { ...options.headers };
  const fetchOptions = { ...options }; // Create a shallow copy to prevent mutating the original object

  // 3. HTTP GET Payload Crash Protection
  const method = (fetchOptions.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    delete fetchOptions.body;
    headers['Cache-Control'] = 'no-cache'; // 4. Prevent stale iOS/Safari polling
    headers['Pragma'] = 'no-cache';
  }

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchOptions.timeout || 60000); // 60-second timeout for Render cold starts

  // Safely normalize URL to prevent double slashes or broken absolute routes
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const finalUrl = url.startsWith('http') ? url : `${API_BASE_URL}${cleanUrl}`;

  try {
    const response = await fetch(finalUrl, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
      body: isFormData ? fetchOptions.body : (fetchOptions.body && typeof fetchOptions.body !== 'string' ? JSON.stringify(fetchOptions.body) : fetchOptions.body),
    });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      window.dispatchEvent(new Event('auth-expired'));
      throw new Error('Session expired. Please log in again.');
    }

    if (!response.ok) {
      let errorMessage = 'Something went wrong';
      try {
        // 10. Robust JSON Error Parser (Prevents 502 HTML parsing crash)
        const errorText = await response.text();
        const errorData = errorText ? JSON.parse(errorText) : {};
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

    // 1. Detect AdBlockers / Browser Extensions intercepting the request
    if (error.stack && typeof error.stack === 'string' && (error.stack.includes('requests.js') || error.stack.includes('extension'))) {
      throw new Error('Network blocked by a browser extension. Please disable your AdBlocker or Brave Shields.');
    }

    // 2. Implement automatic exponential backoff/retry for transient network failures
    const isNetworkError = error.name === 'AbortError' || error.message === 'Failed to fetch' || error.message.includes('Network');
    if (isNetworkError && retries > 0) {
      console.warn(`[Network] Transient failure, retrying ${url}... (${retries} attempts left)`);
      // 2. Thundering Herd Jitter
      await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries) + Math.random() * 500));
      return fetchJson(url, options, retries - 1);
    }

    if (error.name === 'AbortError') {
      throw new Error('Request timed out. The server might be waking up (can take up to 50s).');
    }
    if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
      throw new Error('Network error. Please check your internet connection.');
    }
    
    // Log unexpected errors for external telemetry / debugging
    console.error(`[API Error] ${options.method || 'GET'} ${url} -`, error.message);
    throw error;
  }
}

// Global helper to trigger native OS push notifications for 20+ events
async function sendPush(title, body, data = null, actions = []) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('new-notification', { detail: { title, body, time: new Date() } }));
  }
  if (typeof document !== 'undefined' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, { body, icon: '/wmremove-transformed.png', data, actions });
      } else {
        new Notification(title, { body, icon: '/wmremove-transformed.png' });
      }
    } catch (e) {
      console.error('Push notification failed', e);
    }
  }
}

// ==========================================
// 2. COMPONENTS
// ==========================================

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', marginTop: '10vh' }}>
          <i className="fas fa-exclamation-triangle fa-4x" style={{ color: 'var(--danger)', marginBottom: '20px' }}></i>
          <h2 style={{ color: 'var(--text-main)' }}>Oops! Something went wrong.</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>We're working on fixing this right away.</p>
          <button className="btn" onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
    let checkInterval;
    const triggerAnim = () => {
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
        return true;
      }
      return false;
    };
    if (!triggerAnim()) checkInterval = setInterval(() => { if (triggerAnim()) clearInterval(checkInterval); }, 200);
    return () => { if (checkInterval) clearInterval(checkInterval); };
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
  const [notifications, setNotifications] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  
  useEffect(() => {
    const handleNotif = (e) => setNotifications(prev => [e.detail, ...prev].slice(0, 10)); // Keep last 10
    window.addEventListener('new-notification', handleNotif);
    return () => window.removeEventListener('new-notification', handleNotif);
  }, []);

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
        <div className="notification-icon" style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setShowDropdown(!showDropdown)}>
          <i className="far fa-bell"></i>
          {notifications.length > 0 && <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: 'var(--danger)', color: 'white', fontSize: '0.6rem', borderRadius: '50%', padding: '2px 5px', fontWeight: 'bold' }}>{notifications.length}</span>}
          {showDropdown && (
            <div style={{ position: 'absolute', top: '130%', right: '-10px', width: '320px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '12px', boxShadow: 'var(--shadow-lg)', zIndex: 1000, maxHeight: '350px', overflowY: 'auto', textAlign: 'left', cursor: 'default' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                <span>Notifications</span>
                {notifications.length > 0 && <span style={{ fontSize: '0.8rem', color: 'var(--primary)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setNotifications([]); }}>Clear All</span>}
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>No new notifications</div>
              ) : (
                notifications.map((n, i) => (
                  <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)' }}>
                    <strong style={{ display: 'block', color: 'var(--text-main)', marginBottom: '4px', fontSize: '0.85rem' }}>{n.title}</strong>
                    <span style={{ color: 'var(--text-muted)', display: 'block', lineHeight: '1.4', fontSize: '0.8rem' }}>{n.body}</span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--primary)', marginTop: '6px', fontWeight: 'bold' }}>{n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
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
  const mounted = useRef(true);

  useEffect(() => { return () => { mounted.current = false; }; }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const updatedUser = await fetchJson('/me', { method: 'PUT', body: { name, phone } });
      if (mounted.current) {
        onUpdate(updatedUser);
        showToast('Profile updated successfully', 'success');
        sendPush('Profile Updated', 'Your profile details have been saved.');
        onClose();
      }
    } catch (err) {
      showToast(err.message || 'Failed to update profile.', 'error');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  // Anime.js Form Toggle Animation
  useEffect(() => {
    let checkInterval;
    const triggerAnim = () => {
      if (typeof window !== 'undefined' && window.anime) {
        window.anime({ targets: '.anime-form-item', translateX: [20, 0], opacity: [0, 1], delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(100) : 0, duration: 500, easing: 'easeOutQuad' });
        return true;
      }
      return false;
    };
    if (!triggerAnim()) checkInterval = setInterval(() => { if (triggerAnim()) clearInterval(checkInterval); }, 200);
    return () => { if (checkInterval) clearInterval(checkInterval); };
  }, []);

  return (
    <div className="modal-overlay visible">
      <div className="modal-content">
        <div className="modal-header"><h3>Edit Profile</h3><button onClick={onClose}>&times;</button></div>
        <form onSubmit={handleSubmit}>
          <div className="form-group anime-form-item"><label>Full Name</label><input type="text" className="form-control" value={name} onChange={e=>setName(e.target.value)} required maxLength="50" /></div>
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
  const [signupOtpSent, setSignupOtpSent] = useState(false);
  const [signupOtp, setSignupOtp] = useState('');
  
  const mounted = useRef(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);
  
  // Electrician Onboarding Fields
  const [address, setAddress] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [idCardBase64, setIdCardBase64] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [panCardBase64, setPanCardBase64] = useState('');
  const [photoBase64, setPhotoBase64] = useState('');

  const handleDocUpload = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return showToast('File must be less than 10MB', 'error');
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_DIMENSION = 1200; // Cap width or height at 1200px
        let { width, height } = img;

        if (width > height && width > MAX_DIMENSION) {
          height *= MAX_DIMENSION / width;
          width = MAX_DIMENSION;
        } else if (height > MAX_DIMENSION) {
          width *= MAX_DIMENSION / height;
          height = MAX_DIMENSION;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Compress and convert to JPEG format with 70% quality
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        setter(compressedBase64);
      };
      img.onerror = () => showToast('Invalid file format. Please upload a valid image (JPG/PNG).', 'error');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const requestSignupOtp = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson('/auth/send-signup-otp', { method: 'POST', body: { phone } });
      if (mounted.current) {
        setSignupOtpSent(true);
        setResendCooldown(60);
        showToast(res.message || 'OTP sent successfully!', 'success');
      }
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!isLogin && !signupOtpSent) {
      if (role === 'electrician' && (!idCardBase64 || !address || !experienceYears || !bankDetails || !panCardBase64 || !photoBase64)) {
        return setError('Please fill in all details, bank info, and upload all required documents.');
      }
      if (!phone || phone.length !== 10) return setError('Enter a valid 10-digit phone number.');
      return requestSignupOtp();
    }

    setLoading(true);
    setError(null);
    try {
      const endpoint = isLogin ? '/login' : '/signup';
      let body;
      if (isLogin) {
        body = { phone, password, role };
      } else {
        body = { name, phone, password, role, otp: signupOtp };
        if (role === 'electrician') {
          body = { ...body, address, experienceYears: Number(experienceYears), idCardBase64, bankDetails, panCardBase64, photoBase64 };
        }
      }

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
      if (mounted.current) setError(err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson('/auth/forgot-password', { method: 'POST', body: { phone } });
      if (mounted.current) {
        setOtpSent(true);
        setResendCooldown(60); // Initialize a 60-second cooldown timer
        // SECURITY: Generic success message to prevent user enumeration
        showToast(res.message || 'If an account matches this number, an OTP has been sent.', 'success');
      }
    } catch (err) {
      if (mounted.current) setError('Failed to request OTP. Please try again later.'); // Sanitize error exposure
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson('/auth/reset-password', { method: 'POST', body: { phone, otp, newPassword } });
      if (mounted.current) {
        showToast(res.message || 'Password reset successfully!', 'success');
        // Reset back to standard login screen
        setIsForgotPassword(false);
        setOtpSent(false);
        setOtp('');
        setNewPassword('');
        setResendCooldown(0); // Clear the timer on success
        setPassword('');
        setIsLogin(true);
      }
    } catch (err) {
      console.error('[Password Reset Error]', err);
      if (mounted.current) setError('Failed to reset password. Please check your OTP and try again.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  // Anime.js Form Toggle Animation
  useEffect(() => {
    let checkInterval;
    const triggerAnim = () => {
      if (typeof window !== 'undefined' && window.anime) {
        window.anime({ targets: '.anime-form-item', translateX: [20, 0], opacity: [0, 1], delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(100) : 0, duration: 500, easing: 'easeOutQuad' });
        return true;
      }
      return false;
    };
    if (!triggerAnim()) checkInterval = setInterval(() => { if (triggerAnim()) clearInterval(checkInterval); }, 200);
    return () => { if (checkInterval) clearInterval(checkInterval); };
  }, [isLogin, isForgotPassword, otpSent, signupOtpSent]);

  // Handle OTP Resend Cooldown Timer
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
          timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  return (
    <div className="login-container">
      <div className="logo-area" style={{ justifyContent: 'center', marginBottom: '16px' }}>
        <div className="logo-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
          <img src={logoImage} alt="WATTZEN Logo" style={{ width: '120%', height: '120%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="logo-text">WATT<span>ZEN</span></div>
      </div>
      <div style={{ textAlign: 'center', color: 'var(--primary)', fontWeight: '700', letterSpacing: '1.5px', marginBottom: '32px', fontSize: '0.85rem' }}>POWER YOUR NETWORK</div>
      <div className="login-card">
        <h1>{isForgotPassword ? 'Reset Password' : (isLogin ? 'Welcome Back' : 'Create Account')}</h1>
        <p>{isForgotPassword ? 'Enter your details below to recover your account.' : (isLogin ? 'Log in to your account to continue.' : 'Join the best electrician network.')}</p>
        
        {error && <div style={{ color: 'white', background: 'var(--danger)', padding: '10px', borderRadius: '8px', marginBottom: '16px' }}>{error}</div>}
        
        {!isForgotPassword && !signupOtpSent && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button type="button" className={`btn btn-block ${role === 'customer' ? '' : 'btn-outline'}`} onClick={() => { setRole('customer'); setError(null); setSignupOtp(''); }} style={{ padding: '10px' }}>Customer</button>
          <button type="button" className={`btn btn-block ${role === 'electrician' ? '' : 'btn-outline'}`} onClick={() => { setRole('electrician'); setError(null); setSignupOtp(''); }} style={{ padding: '10px' }}>Electrician</button>
        </div>
        )}

        <form onSubmit={isForgotPassword ? (otpSent ? handleResetPassword : handleForgotPassword) : handleSubmit} style={{ textAlign: 'left' }}>
          
          {isForgotPassword ? (
            <React.Fragment>
              <div className="form-group anime-form-item">
                <label htmlFor="forgotPhone">Phone Number</label>
                <input type="tel" id="forgotPhone" name="phone" className="form-control" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} pattern="[0-9]{10}" maxLength="10" required placeholder="1234567890" disabled={otpSent} />
              </div>
              {otpSent && (
                <React.Fragment>
                  <div className="form-group anime-form-item">
                    <label htmlFor="resetOtp">6-Digit OTP</label>
                <input type="text" id="resetOtp" name="otp" className="form-control" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} required placeholder="123456" maxLength={6} style={{ letterSpacing: '4px', fontSize: '1.2rem', fontWeight: 'bold' }} />
                  </div>
                  <div className="form-group anime-form-item">
                    <label htmlFor="resetNewPassword">New Password</label>
                    <div className="input-icon-wrapper">
                      <input type={showPassword ? "text" : "password"} id="resetNewPassword" name="newPassword" className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="••••••••" />
                    <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} action-icon`} role="button" tabIndex="0" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)} onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') setShowPassword(!showPassword); }}></i>
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
          ) : signupOtpSent ? (
            <React.Fragment>
              <div className="form-group anime-form-item">
                <label htmlFor="signupOtp">Enter OTP sent to {phone}</label>
                <input type="text" id="signupOtp" className="form-control" value={signupOtp} onChange={e => setSignupOtp(e.target.value.replace(/\D/g, ''))} required placeholder="123456" maxLength={6} style={{ letterSpacing: '4px', fontSize: '1.2rem', fontWeight: 'bold', textAlign: 'center' }} />
              </div>
              <div className="anime-form-item" style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '12px' }}>
                <button type="button" onClick={requestSignupOtp} disabled={resendCooldown > 0 || loading} style={{ background: 'none', border: 'none', padding: 0, color: resendCooldown > 0 ? 'var(--text-muted)' : 'var(--primary)', cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', outline: 'none', transition: 'color 0.2s' }}>
                  {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
                </button>
              </div>
              <button type="submit" className="btn btn-block anime-form-item" disabled={loading} style={{ marginTop: '10px' }}>
                {loading ? 'Verifying...' : 'Verify & Create Account'}
              </button>
              <button type="button" className="btn-outline btn btn-block anime-form-item" onClick={() => { setSignupOtpSent(false); setSignupOtp(''); setError(null); }} disabled={loading} style={{ marginTop: '10px' }}>
                Back to Details
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment>
            {!isLogin && (
            <div className="form-group anime-form-item">
              <label htmlFor="signupName">Full Name</label>
              <input type="text" id="signupName" name="name" className="form-control" value={name} onChange={e => setName(e.target.value)} required placeholder="John Doe" maxLength="50" />
            </div>
          )}
          <div className="form-group anime-form-item">
            <label htmlFor="loginPhone">Phone Number</label>
            <input type="tel" id="loginPhone" name="phone" className="form-control" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} pattern="[0-9]{10}" maxLength="10" required placeholder="1234567890" />
          </div>
          
          {!isLogin && role === 'electrician' && (
            <div style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', border: '1px dashed var(--primary)', marginBottom: '16px' }}>
              <div className="form-group anime-form-item"><label>Home Address</label><input type="text" className="form-control" value={address} onChange={e => setAddress(e.target.value)} required placeholder="123 Main St, City" maxLength="250" /></div>
              <div className="form-group anime-form-item"><label>Years of Experience</label><input type="number" className="form-control" value={experienceYears} onChange={e => setExperienceYears(e.target.value)} required min="0" max="50" placeholder="e.g. 5" /></div>
              <div className="form-group anime-form-item"><label>Bank Details (Acc No & IFSC)</label><input type="text" className="form-control" value={bankDetails} onChange={e => setBankDetails(e.target.value)} required placeholder="Acc: 123456789, IFSC: ABCD0123456" maxLength="250" /></div>
              <div className="form-group anime-form-item">
                <label>Upload Govt ID (Aadhar)</label>
                <input type="file" accept="image/*" onChange={(e) => handleDocUpload(e, setIdCardBase64)} required className="form-control" style={{ padding: '8px', background: 'var(--surface)' }} />
                {idCardBase64 && <div style={{ marginTop: '8px', color: 'var(--success)', fontSize: '0.8rem' }}><i className="fas fa-check-circle"></i> Govt ID uploaded successfully</div>}
              </div>
              <div className="form-group anime-form-item">
                <label>Upload PAN Card</label>
                <input type="file" accept="image/*" onChange={(e) => handleDocUpload(e, setPanCardBase64)} required className="form-control" style={{ padding: '8px', background: 'var(--surface)' }} />
                {panCardBase64 && <div style={{ marginTop: '8px', color: 'var(--success)', fontSize: '0.8rem' }}><i className="fas fa-check-circle"></i> PAN uploaded successfully</div>}
              </div>
              <div className="form-group anime-form-item" style={{ marginBottom: 0 }}>
                <label>Upload Personal Photo</label>
                <input type="file" accept="image/*" onChange={(e) => handleDocUpload(e, setPhotoBase64)} required className="form-control" style={{ padding: '8px', background: 'var(--surface)' }} />
                {photoBase64 && <div style={{ marginTop: '8px', color: 'var(--success)', fontSize: '0.8rem' }}><i className="fas fa-check-circle"></i> Photo uploaded successfully</div>}
              </div>
            </div>
          )}

          <div className="form-group anime-form-item">
            <label htmlFor="loginPassword">Password</label>
            <div className="input-icon-wrapper">
              <input type={showPassword ? "text" : "password"} id="loginPassword" name="password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} action-icon`} role="button" tabIndex="0" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)} onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') setShowPassword(!showPassword); }}></i>
            </div>
          </div>
          
          {isLogin && (
            <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '12px' }}>
              <a href="#!" onClick={(e) => { e.preventDefault(); setIsForgotPassword(true); setError(null); }} style={{ color: 'var(--primary)', fontSize: '0.85rem', textDecoration: 'none' }}>Forgot Password?</a>
            </div>
          )}

          <button type="submit" className="btn btn-block anime-form-item" disabled={loading} style={{ marginTop: '10px' }}>
            {loading ? 'Processing...' : (isLogin ? 'Log In' : 'Send OTP')}
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
              <a href="#!" onClick={(e) => { e.preventDefault(); setIsLogin(!isLogin); setSignupOtpSent(false); setSignupOtp(''); setError(null); }} style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'none' }}>
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
  const observerRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return;
    let checkInterval;

    const initMap = () => {
      if (!window.L) return false;

      if (!mapInstance.current) {
            const startLat = origin && origin.length === 2 ? origin[1] : 0;
            const startLng = origin && origin.length === 2 ? origin[0] : 0;
            
        mapInstance.current = window.L.map(mapRef.current, {
          zoomControl: true,
          attributionControl: false
            }).setView([startLat, startLng], 14);

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(mapInstance.current);

        const createIcon = (label, bg) => window.L.divIcon({
          className: 'custom-osm-icon',
          html: `<div style="background:${bg};color:white;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);font-weight:bold;font-size:14px;">${label}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

            originMarker.current = window.L.marker([startLat, startLng], { icon: createIcon('C', '#0d9488') }).addTo(mapInstance.current);
            
            const destLat = destination && destination.length === 2 ? destination[1] : 0;
            const destLng = destination && destination.length === 2 ? destination[0] : 0;
            destMarker.current = window.L.marker([destLat, destLng], { icon: createIcon('E', '#f59e0b') }).addTo(mapInstance.current);
      }

          // Use ResizeObserver to reliably fix the Leaflet "gray tile" rendering glitch in dynamic containers
          if (!observerRef.current && window.ResizeObserver) {
            observerRef.current = new ResizeObserver(() => {
              if (mapInstance.current) mapInstance.current.invalidateSize();
            });
            observerRef.current.observe(mapRef.current);
          }

      if (origin && origin.length === 2) originMarker.current.setLatLng([origin[1], origin[0]]);
      if (destination && destination.length === 2) destMarker.current.setLatLng([destination[1], destination[0]]);

      if (origin && destination && Array.isArray(origin) && Array.isArray(destination) && origin.length === 2 && destination.length === 2 && !boundsSet.current) {
            if (origin[0] !== 0 && origin[1] !== 0 && destination[0] !== 0 && destination[1] !== 0) {
              const bounds = window.L.latLngBounds([[origin[1], origin[0]], [destination[1], destination[0]]]);
              mapInstance.current.fitBounds(bounds, { padding: [40, 40] });
              boundsSet.current = true;
            }
      }
      return true;
    };
    
    if (!initMap()) checkInterval = setInterval(() => { if (initMap()) clearInterval(checkInterval); }, 500);
    return () => { if (checkInterval) clearInterval(checkInterval); };
  }, [origin, destination]);

  // Clean up Leaflet instance on unmount to prevent memory leaks and "map already initialized" errors
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  return <div ref={mapRef} style={{ width: '100%', height: '200px', borderRadius: '12px', marginTop: '16px', border: '1px solid var(--border-light)', zIndex: 1 }} />;
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

function CustomerHome({ user, showToast, onEditProfile }) {
  const { socket } = useSocket();
  const [selectedService, setSelectedService] = useState('wiring');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState([77.5946, 12.9716]); 
  const [liveLocation, setLiveLocation] = useState(null);
  const [jobOTP, setJobOTP] = useState('');
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
  const [tipAmount, setTipAmount] = useState(0);
  const chatContainerRef = useRef(null);
  
  const [currentTab, setCurrentTab] = useState('active');
  const [jobHistory, setJobHistory] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const typingTimeoutRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const [activeCategory, setActiveCategory] = useState('repairs');
  const [teamSize, setTeamSize] = useState(1);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoadingActiveJob, setIsLoadingActiveJob] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [showPriceBreakdown, setShowPriceBreakdown] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wattzen_saved_addresses')) || {}; }
    catch { return {}; }
  });
  
  const mounted = useRef(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);

  const categories = [
    { id: 'repairs', name: 'Quick Repairs', icon: 'fa-screwdriver-wrench' },
    { id: 'appliances', name: 'Appliance Setup', icon: 'fa-plug' },
    { id: 'projects', name: 'Big Projects', icon: 'fa-hard-hat' }
  ];

  const userId = user?._id || user?.id;

  // Restore Active Job and Chat History on Page Refresh
  useEffect(() => {
    let isMounted = true;
    const fetchActiveJob = async () => {
      try {
        const job = await fetchJson('/jobs/active');
        if (isMounted && job && job._id) {
          setActiveJobId(job._id);
          setSelectedService(job.serviceType);
          setAddress(job.address);
          if (job.jobOTP) setJobOTP(job.jobOTP);
          setBookingPrice(job.estimatedPrice);
          setTeamSize(job.teamSize || 1);
          if (job.status === 'assigned' || job.status === 'in_progress') {
            setAssignedElectricians(job.electricians || []);
            setIsTeamFull(true);
          } else if (job.status === 'searching') {
            setTeamStatusMessage('Searching for nearby electricians...');
          }
          if (job.messages && job.messages.length > 0) {
            setMessages(job.messages.map(m => ({ ...m, isSelf: String(m.senderId) === String(user?._id || user?.id) })));
          }
        }
      } catch (e) { console.error('Failed to restore active job', e); }
      finally { if (isMounted) setIsLoadingActiveJob(false); }
    };
    fetchActiveJob();
    return () => { isMounted = false; };
  }, [userId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        if (socket?.connected && activeJobId) socket.emit('stopTyping', { jobId: activeJobId });
      }
    };
  }, [socket, activeJobId]);

  // OpenStreetMap Nominatim Autocomplete
  useEffect(() => {
    let active = true;
    if (address.length > 2 && showSuggestions) {
      const timeout = setTimeout(async () => {
        try {
          const data = await fetchJson(`/location/search?q=${encodeURIComponent(address)}`);
          if (active) setSuggestions(Array.isArray(data) ? data : []);
        } catch (e) {
          console.error('Nominatim search failed', e);
        }
      }, 500); // Debounce
      return () => { active = false; clearTimeout(timeout); };
    } else {
      setSuggestions([]);
      return () => { active = false; };
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

    // FIX: Ensure the user rejoins the room if their internet drops and the socket reconnects
    const joinRoom = () => socket.emit('joinJobRoom', activeJobId);
    if (socket.connected) {
      joinRoom(); // Join immediately if already connected
    }
    socket.on('connect', joinRoom);

    // Request push notification permission from the user
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Store references to properly clean up specific listeners instead of wiping all global handlers
    const onLoc = (data) => setLiveLocation(data);
    const onMsg = (data) => {
      setMessages((prev) => [...prev, { ...data, isSelf: false }]);
      // Trigger a native push notification if the app is minimized/hidden
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`New message from ${data.senderName}`, { body: data.text, icon: '/wmremove-transformed.png' });
      }
      sendPush(`New message from ${data.senderName}`, data.text);
    };
    const onType = (data) => setTypingUser(data.senderName);
    const onStopType = () => setTypingUser(null);
    const onPay = () => {
      setTeamStatusMessage('Payment verified! Searching for nearby electricians...');
      showToast('Payment verified by Admin!', 'success');
      sendPush('Payment Verified', 'Admin verified your payment. Searching for electricians.');
    };
    const onAccept = (data) => {
      setAssignedElectricians(data.electricians || []);
      setIsTeamFull(true);
      setTeamStatusMessage(''); // Clear progress message
      sendPush('Electrician Assigned!', 'Your job has been accepted by an electrician.');
    };
    const onJoin = (data) => {
        setAssignedElectricians(prev => {
            if (prev.some(e => String(e._id) === String(data.electrician._id))) return prev;
            return [...prev, data.electrician];
        });
        setTeamStatusMessage(`${data.currentSize} of ${data.teamSize} electricians have joined.`);
        showToast(`${data.electrician.name} has joined the job!`, 'success');
        sendPush('Team Update', `${data.electrician.name} has joined your project team.`);
    };
    const onDrop = (data) => {
      setAssignedElectricians(prev => prev.filter(e => String(e._id) !== String(data.electricianId)));
      setIsTeamFull(false);
      setTeamStatusMessage('An electrician dropped. Searching for a replacement...');
      showToast('An electrician left the team. Finding a replacement.', 'warning');
    };
    const onStatusUpdate = (data) => {
      if (data.status === 'in_progress') {
        setTeamStatusMessage('Service is currently in progress!');
        showToast('Electrician has verified the OTP. Service started.', 'success');
        sendPush('Service Started', 'The electrician has successfully verified the OTP.');
      }
    };
    const onComplete = () => {
      setJobCompleted(true);
      sendPush('Job Completed', 'The service has been finished. Please leave a rating!');
    };

    socket.on('electricianLocationChanged', onLoc);
    socket.on('receiveMessage', onMsg);
    socket.on('userTyping', onType);
    socket.on('userStopTyping', onStopType);
    socket.on('paymentVerified', onPay);
    socket.on('jobAccepted', onAccept);
    socket.on('teamMemberJoined', onJoin);
    socket.on('electricianDropped', onDrop);
    socket.on('jobStatusUpdated', onStatusUpdate);
    socket.on('jobCompleted', onComplete);

    return () => {
      socket.off('connect', joinRoom);
      socket.off('electricianLocationChanged', onLoc);
      socket.off('receiveMessage', onMsg);
      socket.off('jobAccepted', onAccept);
      socket.off('paymentVerified', onPay);
      socket.off('jobCompleted', onComplete);
      socket.off('teamMemberJoined', onJoin);
      socket.off('electricianDropped', onDrop);
      socket.off('jobStatusUpdated', onStatusUpdate);
      socket.off('userTyping', onType);
      socket.off('userStopTyping', onStopType);
    };
  }, [activeJobId, showToast, socket]);

  useEffect(() => {
    if (chatContainerRef.current) {
      // Wait for the DOM to paint the new messages before calculating scrollHeight
      requestAnimationFrame(() => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        if (scrollHeight - scrollTop - clientHeight < 200 || messages.length <= 1) {
          chatContainerRef.current.scrollTo({ top: scrollHeight, behavior: 'smooth' });
        }
      });
    }
  }, [messages]);

  useEffect(() => {
    setTeamSize(1);
  }, [selectedService]);

  useEffect(() => {
    let isMounted = true;
    if (currentTab === 'history') {
      const fetchHistory = async () => { 
        setIsLoadingHistory(true);
        try {
          const data = await fetchJson('/jobs/history');
          if (isMounted) setJobHistory(Array.isArray(data) ? data : []);
        } catch (e) { if (isMounted) showToast('Failed to load history', 'error'); }
        finally { if (isMounted) setIsLoadingHistory(false); }
      }; 
      fetchHistory();
    }
    return () => { isMounted = false; };
  }, [currentTab, showToast]);

  const handleInitiateBooking = () => {
    if (!address) return showToast('Please enter your full address to book a service.', 'warning');
    if (!coordinates) return showToast('Please select a valid address from the dropdown or use GPS.', 'warning');
    // Generate random price 300 - 700 per electrician needed
    const price = (Math.floor(Math.random() * 401) + 300) * teamSize;
    setBookingPrice(price);
  };

  const handleApplyCoupon = async () => {
    if (!couponInput) return;
    setIsApplyingCoupon(true);
    try {
      const res = await fetchJson('/coupons/validate', { method: 'POST', body: { code: couponInput } });
      setAppliedCoupon({ code: couponInput.toUpperCase(), discount: res.discountAmount });
      showToast('Coupon applied successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      setAppliedCoupon(null);
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleConfirmPayment = async () => {
    setIsBooking(true);
    try {
      const job = await fetchJson('/jobs', {
        method: 'POST',
        body: { serviceType: selectedService, address, coordinates, estimatedPrice: bookingPrice, teamSize, couponCode: appliedCoupon?.code }
      });
      setActiveJobId(job._id);
      setJobOTP(job.jobOTP);
      setBookingPrice(null);
      setTeamStatusMessage('Payment submitted. Waiting for Admin verification...');
      showToast(`Payment registered! Verifying...`, 'success');
      sendPush('Payment Processing', 'Your payment is being verified by Admin.');
      setJobCompleted(false);
      setIsTeamFull(false);
    } catch (error) {
      showToast(error.message || 'Failed to process payment.', 'error');
    } finally {
      if (mounted.current) setIsBooking(false);
    }
  };

  const handleCancelJob = async () => {
    try {
      await fetchJson(`/jobs/${activeJobId}/cancel`, { method: 'PUT' });
      setActiveJobId(null);
      setAppliedCoupon(null);
      setCouponInput('');
      setAssignedElectricians([]);
      setTeamStatusMessage('');
      setLiveLocation(null);
      setMessages([]);
      setIsTeamFull(false);
      setJobCompleted(false);
      setShowRating(false);
      setJobOTP('');
      setBookingPrice(null);
      setRating(0);
      showToast('Job cancelled successfully.', 'success');
      sendPush('Job Cancelled', 'Your service request has been cancelled.');
    } catch (error) {
      showToast(error.message || 'Failed to cancel job.', 'error');
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const msgData = {
      jobId: activeJobId,
      senderId: user.id || user._id,
      senderName: user?.name || 'Customer',
      text: chatInput.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('sendMessage', msgData);
    setMessages((prev) => [...prev, { ...msgData, isSelf: true }]);
    setChatInput('');
  };

  const handleLocateMe = () => {
    if ('geolocation' in navigator) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!mounted.current) return;
          setAddress(`Lat: ${position.coords.latitude.toFixed(4)}, Lng: ${position.coords.longitude.toFixed(4)}`);
          setCoordinates([position.coords.longitude, position.coords.latitude]);
          setIsLocating(false);
          setShowSuggestions(false);
        },
        (error) => {
          let msg = 'Could not detect your location.';
          if (error.code === 1) msg = 'Location access denied. Please enable permissions.';
          else if (error.code === 2) msg = 'Location unavailable. Try again later.';
          else if (error.code === 3) msg = 'Location request timed out.';
          showToast(msg, 'error');
          if (mounted.current) setIsLocating(false);
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
      sendPush('Job Completed', 'Thank you for confirming. Don\'t forget to rate!');
    } catch (error) {
      showToast(error.message || 'Failed to complete job.', 'error');
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
        body: { rating, tip: tipAmount }
      });
      showToast(`Thank you for your ${rating}-star feedback!${tipAmount > 0 ? ' Tip added.' : ''}`, 'success');
      sendPush('Feedback Sent', 'Thank you for rating your electrician!');
      
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
      setTipAmount(0);
    } catch (error) {
      showToast(error.message || 'Failed to submit rating.', 'error');
    }
  };

  const handleDownloadInvoice = (job) => {
    const invoiceText = `
WATTZEN ELECTRICAL SERVICES
=========================================
INVOICE RECEIPT
=========================================
Job ID: ${job._id}
Date: ${new Date(job.createdAt).toLocaleString()}
Service: ${job.serviceType.replace('_', ' ').toUpperCase()}
Status: ${job.status.toUpperCase()}
-----------------------------------------
Customer Details:
Name: ${user?.name || 'Customer'}
Phone: ${user?.phone || 'N/A'}
Address: ${job.address}
-----------------------------------------
Service Professional(s):
${job.electricians && job.electricians.length > 0 ? job.electricians.map(e => `- ${e.name} (${e.phone || 'N/A'})`).join('\n') : 'N/A'}
-----------------------------------------
TOTAL AMOUNT PAID: ₹${job.estimatedPrice}
=========================================
Thank you for choosing Wattzen!
Support: projects.nikunj.singh@gmail.com
    `;
    const blob = new Blob([invoiceText.trim()], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Wattzen_Invoice_${job._id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleRebook = (job) => {
    setSelectedService(job.serviceType);
    setAddress(job.address);
    if (job.location && job.location.coordinates) {
      setCoordinates(job.location.coordinates);
    }
    setCurrentTab('active');
    showToast('Details copied to a new booking!', 'success');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const finalPrice = appliedCoupon ? Math.max(0, bookingPrice - appliedCoupon.discount) : bookingPrice;

  const handleSaveAddress = (type) => {
    if (!address || !coordinates) return showToast('Please select a valid location first.', 'warning');
    const updated = { ...savedAddresses, [type]: { address, coordinates } };
    setSavedAddresses(updated);
    localStorage.setItem('wattzen_saved_addresses', JSON.stringify(updated));
    showToast(`Address saved as ${type}!`, 'success');
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
                <input type="text" value={address} maxLength={250} onChange={(e) => { setAddress(e.target.value); setCoordinates(null); setShowSuggestions(true); }} placeholder="Enter your full address..." style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: '800', color: 'var(--text-main)', fontSize: '16px', width: '100%' }} />
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
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', paddingLeft: '32px' }}>
              {['Home', 'Work'].map(type => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '12px', borderColor: 'var(--border-light)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => {
                    if (savedAddresses[type]) {
                      setAddress(savedAddresses[type].address);
                      setCoordinates(savedAddresses[type].coordinates);
                      showToast(`Loaded ${type} address`, 'success');
                    } else {
                      handleSaveAddress(type);
                    }
                  }}>
                    <i className={`fas fa-${type === 'Home' ? 'home' : 'briefcase'}`} style={{ color: 'var(--primary)' }}></i> {savedAddresses[type] ? type : `Save ${type}`}
                  </button>
                  {savedAddresses[type] && (
                    <i className="fas fa-times-circle" style={{ fontSize: '0.9rem', color: 'var(--text-muted)', cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'} onClick={() => {
                      const updated = { ...savedAddresses };
                      delete updated[type];
                      setSavedAddresses(updated);
                      localStorage.setItem('wattzen_saved_addresses', JSON.stringify(updated));
                    }} title={`Remove ${type}`}></i>
                  )}
                </div>
              ))}
            </div>
          </div>
      <button className="btn" style={{ padding: '10px', borderRadius: '50%', width: '45px', height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={handleLocateMe} title="Detect Location" disabled={isLocating}>
        {isLocating ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-crosshairs"></i>}
      </button>
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
          <div className="card-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.4rem', margin: 0 }}><i className="fas fa-hand-sparkles" style={{ marginRight: '8px', color: 'var(--warning)' }}></i> Hello, {user?.name?.split(' ')[0] || 'User'}</h3>
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

          {isLoadingActiveJob ? (
            <div style={{ marginTop: '16px' }}>
              <div className="skeleton" style={{ height: '54px', width: '100%', borderRadius: '14px', marginBottom: '16px' }}></div>
              <div className="skeleton" style={{ height: '120px', width: '100%', borderRadius: '16px' }}></div>
            </div>
          ) : !activeJobId && !bookingPrice ? (
            <button className="btn btn-block" style={{ marginTop: '16px' }} onClick={handleInitiateBooking} disabled={isBooking}>
              <i className="fas fa-bolt"></i> {isBooking ? 'Creating Job...' : 'Find Electricians Near Me'}
            </button>
          ) : !activeJobId && bookingPrice ? (
            <div style={{ marginTop: '16px', padding: '24px', background: 'var(--surface)', borderRadius: '16px', border: '2px solid var(--primary)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}>
              <h3 style={{ color: 'var(--text-main)', margin: '0 0 8px 0' }}>Upfront Payment Required</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>To secure your booking, please pay the estimated service fee.</p>
              <h2 style={{ fontSize: '2.5rem', color: 'var(--success)', margin: '0 0 4px 0' }}>
                ₹{finalPrice} {appliedCoupon && <span style={{ fontSize: '1rem', textDecoration: 'line-through', color: 'var(--text-muted)' }}>₹{bookingPrice}</span>}
              </h2>
              
              <div style={{ margin: '16px auto 20px', maxWidth: '300px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" className="form-control" value={couponInput} onChange={e => setCouponInput(e.target.value.toUpperCase())} placeholder="Have a Coupon Code?" disabled={!!appliedCoupon} style={{ textTransform: 'uppercase', flex: 1, margin: 0, padding: '10px' }} maxLength="9" />
                  {!appliedCoupon ? (
                    <button className="btn" style={{ padding: '10px 16px' }} onClick={handleApplyCoupon} disabled={isApplyingCoupon || !couponInput}>
                      {isApplyingCoupon ? '...' : 'Apply'}
                    </button>
                  ) : (
                    <button className="btn" style={{ padding: '10px 16px', background: 'var(--danger)' }} onClick={() => { setAppliedCoupon(null); setCouponInput(''); }}>Remove</button>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <button style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }} onClick={() => setShowPriceBreakdown(!showPriceBreakdown)}>
                  {showPriceBreakdown ? 'Hide Price Breakdown' : 'View Price Breakdown'} <i className={`fas fa-chevron-${showPriceBreakdown ? 'up' : 'down'}`}></i>
                </button>
                {showPriceBreakdown && (
                  <div style={{ background: 'var(--secondary)', padding: '12px', borderRadius: '8px', marginTop: '8px', fontSize: '0.85rem', textAlign: 'left', border: '1px dashed var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Base Rate (Estimated):</span> <span>₹{Math.round(bookingPrice / teamSize)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Team Size Multiplier:</span> <span>x{teamSize}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Platform Fee:</span> <span style={{ color: 'var(--success)' }}>₹0 (Waived)</span></div>
                    {appliedCoupon && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Coupon Discount:</span> <span style={{ color: 'var(--success)' }}>-₹{appliedCoupon.discount}</span></div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderTop: '1px solid var(--border-light)', paddingTop: '4px', marginTop: '4px' }}><span>Total Payable:</span> <span>₹{finalPrice}</span></div>
                  </div>
                )}
              </div>
              <a href={`upi://pay?pa=9211293576@ptaxis&pn=WATTZEN&am=${Number(finalPrice)}&cu=INR`} className="btn btn-block" style={{ background: '#10b981', display: 'block', textDecoration: 'none', marginBottom: '12px' }}>
                <i className="fas fa-qrcode"></i> Pay via UPI App
              </a>
              <button className="btn-outline btn btn-block" onClick={handleConfirmPayment} disabled={isBooking}>
                {isBooking ? 'Verifying...' : 'I have completed the payment'}
              </button>
          <button className="btn" style={{ background: 'transparent', color: 'var(--danger)', marginTop: '12px', boxShadow: 'none', border: '1px solid var(--danger)', padding: '10px' }} onClick={() => { setBookingPrice(null); setAppliedCoupon(null); setCouponInput(''); }}>Cancel Booking</button>
            </div>
          ) : !isTeamFull ? (
            <div style={{ marginTop: '16px', padding: '24px', background: 'var(--secondary)', borderRadius: '12px', textAlign: 'center', border: '1px dashed var(--primary)' }}>
              <i className="fas fa-spinner fa-spin" style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '1.5rem' }}></i>
              <div style={{ fontWeight: 'bold' }}>Searching for nearby electricians...</div>
              {teamStatusMessage && <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '8px' }}>{teamStatusMessage}</div>}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '12px' }}>
                Tracking Job ID: <span style={{ fontFamily: 'monospace' }}>{activeJobId}</span>
                <button onClick={() => { 
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(`Tracking WATTZEN Job: ${activeJobId}`)
                      .then(() => showToast('Tracking ID copied!', 'success'))
                      .catch(() => showToast('Failed to copy Tracking ID.', 'error'));
                  } else {
                    showToast('Clipboard access denied by browser.', 'error');
                  }
                }} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '4px' }} title="Copy Tracking ID">
                  <i className="fas fa-copy"></i>
                </button>
              </div>
              <button className="btn btn-outline" style={{ marginTop: '12px', borderColor: 'var(--danger)', color: 'var(--danger)', padding: '6px 12px', fontSize: '0.85rem' }} onClick={handleCancelJob}>
                Cancel Search
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid var(--success)' }}>
              <i className="fas fa-check-circle" style={{ color: 'var(--success)', marginBottom: '8px', fontSize: '1.5rem' }}></i>
              <div style={{ fontWeight: 'bold', color: 'var(--success)', textAlign: 'center' }}>Your Team is Assembled!</div>
              
              {jobOTP && (
                <div style={{ margin: '16px 0', padding: '12px', background: 'var(--surface)', border: '2px dashed var(--primary)', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Share this 4-Digit OTP with your electrician upon arrival:</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', letterSpacing: '4px', color: 'var(--primary)' }}>{jobOTP}</div>
                </div>
              )}

              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '8px' }}>
                {assignedElectricians.map(e => (
                    <div key={e._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface)', padding: '12px', borderRadius: '8px', marginBottom: '8px', justifyContent: 'space-between', border: '1px solid var(--border-light)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className="fas fa-user-hard-hat" style={{color: 'var(--primary)', fontSize: '1.2rem'}}></i> 
                          <strong style={{ fontSize: '1.05rem' }}>{e.name}</strong>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          <i className="fas fa-star" style={{ color: 'var(--gold)' }}></i> {e.averageRating ? Number(e.averageRating).toFixed(1) : 'New'} ({e.totalReviews || 0} jobs)
                        </div>
                      </div>
                      <a href={`tel:${e.phone}`} className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '20px' }}><i className="fas fa-phone"></i> Call</a>
                    </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                {!jobCompleted && (
                  <button className="btn" style={{ flex: 1 }} onClick={handleCompleteJob}>
                    <i className="fas fa-check-circle"></i> Mark Job as Done
                  </button>
                )}
              <a href={`mailto:projects.nikunj.singh@gmail.com?subject=Emergency%20Support%20-%20Job%20${activeJobId}`} className="btn btn-outline" style={{ padding: '14px', flex: '0 0 auto', borderColor: 'var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-btn)' }} title="Contact Support">
                  <i className="fas fa-headset"></i>
                </a>
                <button className="btn" style={{ padding: '14px', flex: '0 0 auto', background: 'var(--danger)', color: 'white', borderRadius: 'var(--radius-btn)' }} onClick={() => {
                  if(window.confirm('Trigger EMERGENCY SOS? This will alert the admin immediately.')) {
                    if(socket?.connected) socket.emit('triggerSOS', { jobId: activeJobId, userId: user._id, role: 'customer' });
                    showToast('SOS Alert Sent! Support is being notified.', 'success');
                  }
                }} title="Emergency SOS">
                  <i className="fas fa-triangle-exclamation"></i>
                </button>
              </div>
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
              <div style={{ marginBottom: '24px' }}>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-main)', fontWeight: 'bold' }}>Add a Tip (Optional)</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {[0, 50, 100, 200].map(amt => (
                    <button key={amt} className={`btn ${tipAmount === amt ? '' : 'btn-outline'}`} style={{ padding: '6px 16px', borderRadius: '20px', borderColor: tipAmount === amt ? 'transparent' : 'var(--primary)', color: tipAmount === amt ? 'white' : 'var(--primary)' }} onClick={() => setTipAmount(amt)}>
                      {amt === 0 ? 'No Tip' : `₹${amt}`}
                    </button>
                  ))}
                </div>
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
                  }} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." maxLength="1000" style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} /> 
                  <button className="btn" style={{ padding: '10px 16px', borderRadius: '20px' }} onClick={handleSendMessage}><i className="fas fa-paper-plane"></i></button>
                </div>
              </div>
            </React.Fragment>
          )}
        </div>
      ) : (
        <div className="card" style={{ animation: 'fadeInUp 0.4s forwards' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ margin: 0 }}><i className="fas fa-history" style={{ color: 'var(--primary)' }}></i> Your Job History</h3>
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
              {['all', 'completed', 'cancelled'].map(filter => (
                <button key={filter} className={`btn ${historyFilter === filter ? '' : 'btn-outline'}`} style={{ padding: '4px 12px', fontSize: '0.8rem', borderRadius: '20px', textTransform: 'capitalize' }} onClick={() => setHistoryFilter(filter)}>
                  {filter}
                </button>
              ))}
            </div>
          </div>
          {isLoadingHistory ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '100px', width: '100%', borderRadius: '12px' }}></div>)}
            </div>
          ) : jobHistory.filter(job => historyFilter === 'all' ? true : job.status === historyFilter).length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No {historyFilter !== 'all' ? historyFilter : 'past'} jobs found.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {jobHistory.filter(job => historyFilter === 'all' ? true : job.status === historyFilter).map(job => (
                <div key={job._id} style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '1.1rem', textTransform: 'capitalize' }}>{job.serviceType.replace('_', ' ')}</strong>
                    <span className="badge" style={{ background: job.status === 'completed' ? 'var(--success)' : (job.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)'), color: 'white' }}>{job.status}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}><i className="far fa-calendar-alt"></i> {new Date(job.createdAt).toLocaleDateString()}</div>
                  <div style={{ fontSize: '0.95rem', marginTop: '8px', fontWeight: 'bold', color: 'var(--primary)' }}>₹{job.estimatedPrice}</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                      {job.status === 'completed' && (
                        <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'var(--primary)' }} onClick={() => handleDownloadInvoice(job)}>
                          <i className="fas fa-file-invoice"></i> Invoice
                        </button>
                      )}
                      <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'var(--surface)', color: 'var(--text-main)', border: '1px solid var(--border-light)', boxShadow: 'none' }} onClick={() => handleRebook(job)}>
                        <i className="fas fa-redo"></i> Book Again
                      </button>
                    </div>
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
        <div className="card" style={{ animationDelay: '0.2s', background: 'linear-gradient(135deg, var(--primary), var(--primary-light))', color: 'white', border: 'none' }}>
          <h4 style={{ color: 'white', margin: '0 0 12px 0' }}><i className="fas fa-gift"></i> Refer & Earn</h4>
          <p style={{ fontSize: '0.9rem', marginBottom: '12px', opacity: 0.9 }}>Share WATTZEN with friends! You both get ₹100 off when they book their first service.</p>
          <div style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px', alignItems: 'center' }}>
            <span style={{ flex: 1, fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '2px', textAlign: 'center' }}>{user?._id?.slice(-6).toUpperCase() || 'WATTZEN'}</span>
            <button className="btn" style={{ background: 'white', color: 'var(--primary)', padding: '6px 12px', boxShadow: 'none' }} onClick={() => {
              const text = `Join WATTZEN using my referral code ${user?._id?.slice(-6).toUpperCase() || 'WATTZEN'} and get ₹100 off your first booking!`;
              if(navigator.share) navigator.share({ title: 'WATTZEN Invite', text }).catch(()=>{});
              else { navigator.clipboard.writeText(text); showToast('Referral code copied!', 'success'); }
            }}><i className="fas fa-share-nodes"></i> Share</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Electrician Dashboard Component ---
function ElectricianHome({ user, showToast, onEditProfile, onUpdateUser }) {
  const { socket } = useSocket();
  const [isOnline, setIsOnline] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [availableJobs, setAvailableJobs] = useState([]);
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
  const [acceptingJobId, setAcceptingJobId] = useState(null);
  const [onlineTime, setOnlineTime] = useState(0);
  const [enteredOtp, setEnteredOtp] = useState('');
  const realCoordsRef = useRef([77.5946, 12.9716]); // Fallback to Bangalore, dynamically updated
  
  const mounted = useRef(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);
  const userId = user?._id || user?.id;
  const isApproved = user?.isApproved;
  const safetyDepositPaid = user?.safetyDepositPaid;
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const jobStatus = currentJob?.status;
  const teamSize = currentJob?.teamSize || 1;
  const currentTeamSize = currentJob?.electricians?.length || 0;
  const isTeamJob = teamSize > 1;
  const isTeamWaiting = isTeamJob && jobStatus === 'searching' && currentTeamSize < teamSize;
  const isJobActive = jobStatus === 'assigned' || jobStatus === 'in_progress';
  const hasArrived = isJobActive && !isTracking; // Simplified logic for arrival

  const handlePayDeposit = async () => {
    try {
      const res = await fetchJson('/electrician/pay-deposit', { method: 'POST' });
      onUpdateUser(res);
      showToast('Safety deposit paid successfully!', 'success');
      sendPush('Deposit Confirmed', 'Your safety deposit has been received.');
    } catch(e) {
      showToast(e.message, 'error');
    }
  };

  useEffect(() => {
    let interval;
    if (isOnline) {
      interval = setInterval(() => setOnlineTime(prev => prev + 1), 1000);
    } else {
      setOnlineTime(0);
    }
    return () => clearInterval(interval);
  }, [isOnline]);

  const formatOnlineTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  };

  // Listen for Live Admin Approval
  useEffect(() => {
    const handleAccountApproved = (approvedId) => {
      if (String(approvedId) === String(user?._id || user?.id)) {
        showToast('Your account has been approved by the Admin! You can now go online.', 'success');
        fetchJson('/me').then(res => onUpdateUser(res)).catch(() => {});
      }
    };
    socket.on('accountApproved', handleAccountApproved);
    return () => socket.off('accountApproved', handleAccountApproved);
  }, [socket, user, showToast, onUpdateUser]);

  // Restore Active Job and Chat History on Page Refresh
  useEffect(() => {
    let isMounted = true;
    const fetchActiveJob = async () => {
      try {
        const job = await fetchJson('/jobs/active');
        if (isMounted && job && job._id) {
          setActiveJobId(job._id);
          setCurrentJob(job);
          if (job.status === 'assigned' || job.status === 'in_progress') {
            setIsTracking(true);
          }
          if (job.messages && job.messages.length > 0) {
            setMessages(job.messages.map(m => ({ ...m, isSelf: String(m.senderId) === String(user?._id || user?.id) })));
          }
        }
      } catch (e) { console.error('Failed to restore active job', e); }
    };
    fetchActiveJob();
    return () => { isMounted = false; };
  }, [userId]);

  useEffect(() => {
    if (isOnline) {
      const onMsg = (data) => {
        setMessages((prev) => [...prev, { ...data, isSelf: false }]);
        // Trigger a native push notification if the app is minimized/hidden
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`New message from ${data.senderName}`, { body: data.text, icon: '/wmremove-transformed.png' });
        }
        sendPush(`New message from ${data.senderName}`, data.text);
      };
      const onType = (data) => setTypingUser(data.senderName);
      const onStopType = () => setTypingUser(null);
      const onAccept = (data) => {
        const currentUser = userRef.current;
        if (data.electricians.some(e => String(e._id) === String(currentUser?._id) || String(e.id) === String(currentUser?._id))) {
            setCurrentJob(prev => ({...prev, status: 'assigned', electricians: data.electricians}));
            setIsTracking(true); // All members start tracking when team is full
            showToast('Team is full! Job is now active.', 'success');
            sendPush('Job Started', 'The team is full! You can now start the job.');
        }
      };
      const onCancel = () => {
        showToast('The customer cancelled the job.', 'warning');
        sendPush('Job Cancelled', 'The customer has cancelled the active job.');
        setIsTracking(false);
        setActiveJobId(null);
        setCurrentJob(null);
        setAvailableJobs([]);
        setMessages([]);
      };
      const onComplete = () => {
        showToast('Customer marked job as complete! Earnings added to wallet.', 'success');
        sendPush('Payment Received', 'Customer completed the job. Earnings have been added to your wallet.');
        fetchJson('/me').then(res => {
          setWalletBal(res.walletBalance);
          setJobsCompleted(res.jobsCompleted);
        }).catch(() => {});
          
          setActiveJobId(null);
          setCurrentJob(null);
          setIsTracking(false);
          setMessages([]);
      };
      const onJoin = (data) => {
        setCurrentJob(prev => {
          if (!prev) return prev;
          if (prev.electricians.some(e => String(e._id) === String(data.electrician._id))) return prev;
          return { ...prev, electricians: [...prev.electricians, data.electrician] };
        });
        sendPush('Team Update', `${data.electrician.name} joined the job team.`);
      };
      const onDrop = (data) => {
        setCurrentJob(prev => prev ? { ...prev, electricians: prev.electricians.filter(e => String(e._id) !== String(data.electricianId)) } : prev);
        showToast('A team member dropped out of the job.', 'warning');
      };
      const onStatusUpdate = (data) => {
        setCurrentJob(prev => prev ? { ...prev, status: data.status } : prev);
        if (data.status === 'in_progress') setIsTracking(false);
      };

      socket.on('receiveMessage', onMsg);
      socket.on('userTyping', onType);
      socket.on('userStopTyping', onStopType);
      socket.on('jobAccepted', onAccept);
      socket.on('jobCancelled', onCancel);
      socket.on('electricianDropped', onDrop);
      socket.on('jobStatusUpdated', onStatusUpdate);
      socket.on('jobCompleted', onComplete);
      socket.on('teamMemberJoined', onJoin);

      return () => {
        socket.off('receiveMessage', onMsg);
        socket.off('jobAccepted', onAccept);
        socket.off('jobCancelled', onCancel);
        socket.off('jobCompleted', onComplete);
        socket.off('teamMemberJoined', onJoin);
        socket.off('electricianDropped', onDrop);
        socket.off('jobStatusUpdated', onStatusUpdate);
        socket.off('userTyping', onType);
        socket.off('userStopTyping', onStopType);
      }; 
    } else {
      setIsTracking(false);
    }
  }, [isOnline, showToast, socket]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        if (socket?.connected && activeJobId) socket.emit('stopTyping', { jobId: activeJobId });
      }
    };
  }, [socket, activeJobId]);

  useEffect(() => {
    if (isOnline && activeJobId) {
      // FIX: Ensure the electrician rejoins the room if their internet drops and the socket reconnects
      const joinRoom = () => socket.emit('joinJobRoom', activeJobId);
      if (socket.connected) {
        joinRoom(); // Join immediately if already connected
      }
      socket.on('connect', joinRoom);
      
      return () => {
        socket.off('connect', joinRoom);
      };
    } 
  }, [isOnline, activeJobId, socket]);

  useEffect(() => {
    let geoId;
    if (isOnline && 'geolocation' in navigator) {
      geoId = navigator.geolocation.watchPosition(
        (pos) => { realCoordsRef.current = [pos.coords.longitude, pos.coords.latitude]; },
        (err) => {
          console.warn('Geolocation error:', err);
          if (err.code === 1) showToast('GPS permission denied. Tracking is disabled.', 'error');
        },
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    }
    return () => {
      if (geoId) navigator.geolocation.clearWatch(geoId);
    };
  }, [isOnline]);

  useEffect(() => {
    let pollInterval;
    let isMounted = true;
    if (isOnline && !currentJob && isApproved && safetyDepositPaid) {
      const checkJobs = async () => {
        try {
          const coords = realCoordsRef.current;
          // Fetch up to 10 nearby jobs to display in the feed
          const data = await fetchJson(`/jobs/available?latitude=${coords[1]}&longitude=${coords[0]}&maxDistance=15&limit=10`);
          if (!isMounted) return;
          
          setAvailableJobs(Array.isArray(data) ? data : []);
        } catch (e) {
          console.error('Failed to fetch jobs:', e);
        }
      };
      checkJobs();
      
      // FIX: Actually start the interval so electricians don't miss jobs if they log in late
      pollInterval = setInterval(checkJobs, 10000); 

      const handleNewJob = (job) => {
        if (job.status === 'searching') {
          setAvailableJobs(prev => {
            if (prev.some(j => String(j._id) === String(job._id))) return prev;
            return [job, ...prev]; // Prepend the new job to the top of the list
          });
          sendPush('New Job Alert!', `A new ${job.serviceType.replace('_', ' ')} job is available nearby.`, { jobId: job._id }, [{ action: 'accept', title: 'Accept Job' }]);
        }
      };
      socket.on('newJobAvailable', handleNewJob);

      return () => {
        isMounted = false;
        clearInterval(pollInterval);
        socket.off('newJobAvailable', handleNewJob);
      };
    } 
  }, [isOnline, currentJob, isApproved, safetyDepositPaid, socket]);

  useEffect(() => {
    if (chatContainerRef.current) {
      // Wait for the DOM to paint the new messages before calculating scrollHeight
      requestAnimationFrame(() => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        if (scrollHeight - scrollTop - clientHeight < 200 || messages.length <= 1) {
          chatContainerRef.current.scrollTo({ top: scrollHeight, behavior: 'smooth' });
        }
      });
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
          .reduce((sum, job) => sum + Math.round(((job.originalPrice || job.estimatedPrice) * 0.8) / Math.max(1, job.electricians?.length || 1)), 0);
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

  const trackingDestRef = useRef([77.5946, 12.9716]);
  useEffect(() => {
    if (currentJob?.location?.coordinates) trackingDestRef.current = currentJob.location.coordinates;
  }, [currentJob]);

  useEffect(() => {
    let interval;
    if (isTracking) {
      let currentDist = 3.5;
      let currentEta = 12;
      interval = setInterval(() => {
        currentDist = Math.max(0, currentDist - 0.5);
        currentEta = Math.max(0, currentEta - 2);

        const dest = trackingDestRef.current;
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
      text: chatInput.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('sendMessage', msgData);
    setMessages((prev) => [...prev, { ...msgData, isSelf: true }]);
    setChatInput('');
  };

  const handleAcceptJob = async (jobId) => {
    if (acceptingJobId) return;
    setAcceptingJobId(jobId);
    try {
      const acceptedJob = await fetchJson(`/jobs/${jobId}/accept`, { method: 'PUT' });
      
      // Fix: Join room AFTER API responds successfully to prevent phantom socket connections if API fails
      socket.emit('joinJobRoom', jobId);
      setActiveJobId(jobId); // Link the job and join the chat room only AFTER accepting
      setAvailableJobs([]); // Clear the list to focus on the active job
      setCurrentJob(acceptedJob); // Set the full job object
      showToast('Job Accepted Successfully!', 'success');
      sendPush('Job Accepted', 'You have successfully claimed the job!');
      
      // Prevent socket race condition: if the team is already full upon acceptance, start tracking instantly
      if (acceptedJob.status === 'assigned') {
        setIsTracking(true);
      }
    } catch (error) {
      showToast(error.message || 'Failed to accept job.', 'error');
      // Remove the failed job from the UI list so they can accept a different one
      setAvailableJobs(prev => prev.filter(j => j._id !== jobId));
      setActiveJobId(null);
    } finally {
      if (mounted.current) setAcceptingJobId(null);
    }
  };

  const handleVerifyOtp = async () => {
    if (!enteredOtp || enteredOtp.length !== 4) return showToast('Enter 4-digit OTP', 'error');
    try {
      await fetchJson(`/jobs/${activeJobId}/verify-otp`, { method: 'PUT', body: { otp: enteredOtp } });
      showToast('OTP Verified! Job is now in progress.', 'success');
      setCurrentJob(prev => ({ ...prev, status: 'in_progress' }));
      setIsTracking(false);
    } catch (e) {
      showToast(e.message || 'Invalid OTP', 'error');
    }
  };

  const handleDropJob = async () => {
    if (!window.confirm('WARNING: Drop this job? This will negatively impact your rating and standing.')) return;
    try {
      await fetchJson(`/jobs/${activeJobId}/drop`, { method: 'PUT' });
      showToast('You have dropped the job.', 'warning');
      setActiveJobId(null);
      setCurrentJob(null);
      setIsTracking(false);
      setMessages([]);
    } catch (error) {
      showToast(error.message || 'Failed to drop job.', 'error');
    }
  };

  const acceptJobRef = useRef(handleAcceptJob);
  useEffect(() => { acceptJobRef.current = handleAcceptJob; }, [handleAcceptJob]);

  // Listen for the "Accept Job" action from the Service Worker Push Notification
  useEffect(() => {
    const handleSWMessage = (event) => {
      if (event.data && event.data.type === 'ACCEPT_JOB' && event.data.jobId) {
        acceptJobRef.current(event.data.jobId);
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }
    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
    };
  }, []);

  const handleRequestWithdrawal = async () => {
    try {
      const res = await fetchJson('/withdrawals', { method: 'POST' });
      showToast('Withdrawal request sent to Admin.', 'success');
      sendPush('Withdrawal Requested', 'Your fund withdrawal is pending approval.');
      setWalletBal(0); // Optimistically set to 0
    } catch (error) {
      showToast(error.message || 'Failed to request withdrawal.', 'error');
    }
  };

  return (
    <div className="dashboard-grid">
      <div>
        <div className="card">
          <div className="card-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: '1.4rem', margin: 0 }}><i className="fas fa-toolbox" style={{ color: 'var(--primary)' }}></i> Welcome back, {user?.name?.split(' ')[0] || 'User'}</h3>
              {isOnline && <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginTop: '6px', fontWeight: 'bold' }}><i className="fas fa-clock"></i> Active Shift: {formatOnlineTime(onlineTime)}</div>}
            </div>
            <button 
              className={`btn ${isOnline ? '' : 'btn-outline'}`} 
              onClick={() => { 
                if (!user?.safetyDepositPaid) return showToast('Please pay the safety deposit first.', 'warning');
                if (!user?.isApproved) return showToast('Admin verification pending. You cannot go online yet.', 'warning');
                if (isOnline && activeJobId) return showToast('Cannot go offline while on an active job.', 'warning'); 
                setIsOnline(!isOnline); 
                // Request Push Notification access on user interaction to prevent browser blocking
                if (!isOnline && 'Notification' in window && Notification.permission === 'default') {
                  Notification.requestPermission();
                }
              }} 
              disabled={(isOnline && !!activeJobId) || !user?.isApproved || !user?.safetyDepositPaid}
              style={(!user?.isApproved || !user?.safetyDepositPaid) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              {isOnline ? <React.Fragment><span className="pulse-dot" style={{ marginRight: '8px' }}></span>Online</React.Fragment> : 'Go Online'}
            </button>
          </div>
          
          {(!user?.safetyDepositPaid || !user?.isApproved) && (
            <div style={{ marginTop: '0', marginBottom: '16px', padding: '16px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid var(--warning)', borderRadius: '12px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <i className="fas fa-triangle-exclamation" style={{ fontSize: '1.5rem', color: 'var(--warning)', marginTop: '4px' }}></i>
              <div>
                <strong style={{ display: 'block', fontSize: '1.05rem', color: 'var(--warning)', marginBottom: '4px' }}>Action Required to Go Online</strong>
                {!user?.safetyDepositPaid ? (
                  <React.Fragment>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--text-main)' }}>To maintain trust and quality on our platform, please pay a fully refundable ₹500 safety deposit before accepting jobs.</p>
                    <button className="btn" style={{ padding: '6px 16px', fontSize: '0.85rem' }} onClick={handlePayDeposit}><i className="fas fa-qrcode" style={{ marginRight: '8px' }}></i> Pay ₹500 via UPI</button>
                  </React.Fragment>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>Your documents and details are currently under review. You will be able to go online and accept jobs once a Master Admin verifies your profile.</p>
                )}
              </div>
            </div>
          )}

            <div className="inline-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '16px' }}>
              <div style={{ flex: '1 1 calc(50% - 8px)', minWidth: '120px', padding: '16px', background: 'var(--secondary)', borderRadius: '16px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase' }}>WALLET BALANCE</span>
              <h2 style={{ color: 'var(--success)', fontSize: '2.2rem', margin: '4px 0 0 0' }}>₹{walletBal.toFixed(0)}</h2>
            </div>
              <div style={{ flex: '1 1 calc(50% - 8px)', minWidth: '120px', padding: '16px', background: 'var(--secondary)', borderRadius: '16px' }}>
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
              {availableJobs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>We are matching you with customers within a 15km radius.</p>
              ) : (
                <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
                  {availableJobs.map(job => (
                    <div key={job._id} style={{ padding: '20px', background: 'var(--surface)', borderRadius: '16px', border: '2px solid var(--success)', boxShadow: 'var(--shadow-lg)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--success)' }}>NEW MATCH FOUND</span>
                        <span style={{ fontWeight: 'bold', color: 'var(--primary)', fontSize: '1.2rem' }}>₹{job.originalPrice || job.estimatedPrice}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-main)', textTransform: 'capitalize' }}><strong>Service:</strong> {job.serviceType.replace('_', ' ')}</p>
                      <p style={{ margin: '4px 0 12px 0', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                        <strong>Location:</strong> <a href={`https://www.openstreetmap.org/?mlat=${job.location?.coordinates?.[1]}&mlon=${job.location?.coordinates?.[0]}#map=16/${job.location?.coordinates?.[1]}/${job.location?.coordinates?.[0]}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{job.address} <i className="fas fa-external-link-alt"></i></a>
                      </p>
                      <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Job ID: <span style={{ fontFamily: 'monospace' }}>{job._id}</span></p>
                      <button className="btn" style={{ width: '100%', background: 'var(--success)', marginTop: '8px' }} onClick={() => handleAcceptJob(job._id)} disabled={!!acceptingJobId}>
                    {acceptingJobId === job._id ? <><i className="fas fa-circle-notch fa-spin" style={{ marginRight: '8px' }}></i>Accepting...</> : 'Accept Job & Start Tracking'}
                      </button>
                    </div>
                  ))}
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
              {currentJob?.status === 'assigned' && !isTracking && (
                <div style={{ marginTop: '16px', background: 'var(--surface)', padding: '16px', borderRadius: '12px', border: '1px dashed var(--primary)' }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', fontWeight: 'bold' }}>Ask the customer for the 4-digit OTP to start the job.</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" className="form-control" placeholder="0000" maxLength="4" value={enteredOtp} onChange={e => setEnteredOtp(e.target.value.replace(/\D/g, ''))} style={{ margin: 0, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px', fontWeight: 'bold' }} />
                    <button className="btn" onClick={handleVerifyOtp} style={{ whiteSpace: 'nowrap' }}>Verify OTP</button>
                  </div>
                </div>
              )}
              <p style={{ color: 'var(--warning)', marginTop: '16px', fontWeight: 'bold' }}>
                <i className="fas fa-info-circle"></i> Ask the customer to mark the job as 'Done' on their app when finished to receive your payout.
              </p>
              <button className="btn-outline" style={{ marginTop: '12px', borderColor: 'var(--danger)', color: 'var(--danger)', padding: '8px 16px', width: '100%', borderRadius: '8px' }} onClick={() => {
                if(window.confirm('Trigger EMERGENCY SOS? Support will be notified immediately.')) {
                  if(socket?.connected) socket.emit('triggerSOS', { jobId: activeJobId, userId: user._id, role: 'electrician' });
                  showToast('SOS Alert Sent!', 'success');
                }
              }}><i className="fas fa-triangle-exclamation"></i> Emergency SOS</button>
              <button className="btn-outline" style={{ marginTop: '12px', borderColor: 'var(--warning)', color: 'var(--warning)', padding: '8px 16px', width: '100%', borderRadius: '8px' }} onClick={handleDropJob}>
                <i className="fas fa-person-walking-arrow-right"></i> Emergency Drop Job
              </button>
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
                    if (!typingTimeoutRef.current) {
                      socket.emit('typing', { jobId: activeJobId, senderName: user?.name?.split(' ')[0] || 'Electrician' }); 
                    } else {
                      clearTimeout(typingTimeoutRef.current);
                    }
                    typingTimeoutRef.current = setTimeout(() => { socket.emit('stopTyping', { jobId: activeJobId }); typingTimeoutRef.current = null; }, 1500);
                  }
                }} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." maxLength="1000" style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} /> 
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
        <div className="card" style={{ animationDelay: '0.25s', border: '1px dashed var(--gold)' }}>
          <h4 style={{ margin: '0 0 8px 0' }}><i className="fas fa-users" style={{ color: 'var(--gold)' }}></i> Build the Network</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '12px' }}>Invite other certified electricians. Get a ₹500 bonus when they complete 5 jobs!</p>
          <button className="btn btn-outline" style={{ width: '100%', borderColor: 'var(--gold)', color: 'var(--gold)' }} onClick={() => {
            const text = `Join WATTZEN as a verified Electrician! Use my referral code ${user?._id?.slice(-6).toUpperCase() || 'WATTZEN'}.`;
            if(navigator.share) navigator.share({ title: 'WATTZEN Partner', text }).catch(()=>{});
            else { navigator.clipboard.writeText(text); showToast('Invite link copied!', 'success'); }
          }}><i className="fas fa-share-nodes"></i> Share Invite Link</button>
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
                    <div style={{ fontSize: '0.95rem', marginTop: '8px', fontWeight: 'bold', color: 'var(--primary)' }}>Earnings: <span style={{ color: 'var(--success)' }}>₹{Math.round(((job.originalPrice || job.estimatedPrice) * 0.8) / Math.max(1, job.electricians?.length || 1))}</span></div>
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
      </div>
    </div>
  );
}

// --- Admin Dashboard Components ---
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
  for (let i = 1; i <= 25; i++) {
    const isCustomer = Math.random() > 0.35;
    const fName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lName = lastNames[Math.floor(Math.random() * lastNames.length)];
    mockUsers.push({
      _id: `MOCK-${1000 + i}`,
      role: isCustomer ? 'customer' : 'electrician',
      name: `${fName} ${lName}`,
      phone: `+91 9${Math.floor(100000000 + Math.random() * 900000000)}`,
      plainPassword: 'mockpassword123',
      walletBalance: Math.floor(Math.random() * 2000),
      jobsCompleted: Math.floor(Math.random() * 10),
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
  const [isLoading, setIsLoading] = useState(true);
  const [financeData, setFinanceData] = useState({ pendingJobs: [], pendingWithdrawals: [], stats: {}, recentCompletedJobs: [], withdrawalLogs: [] });
  const [isDownloading, setIsDownloading] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [reviewUser, setReviewUser] = useState(null);
  const [bannedIps, setBannedIps] = useState([]);
  const [ipToBan, setIpToBan] = useState('');
  const [banReason, setBanReason] = useState('');
  const [couponsData, setCouponsData] = useState([]);
  const [newCouponAmount, setNewCouponAmount] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [systemLogs, setSystemLogs] = useState([]);
  const [archivedUsers, setArchivedUsers] = useState([]);
  const [activityUser, setActivityUser] = useState(null);
  const [activityData, setActivityData] = useState({ logs: [], userTimings: {} });
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [useMockData, setUseMockData] = useState(false);
  const [mockData, setMockData] = useState([]);
  const [systemStatus, setSystemStatus] = useState({ uptime: 0, dbConnected: false });
  
  const mounted = useRef(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);

  const fetchDashboardData = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const users = await fetchJson('/admin/users');
      setLiveData(Array.isArray(users) ? users : []);
      const fin = await fetchJson('/admin/finance');
      setFinanceData(fin && Array.isArray(fin.pendingJobs) ? fin : { pendingJobs: [], pendingWithdrawals: [], stats: {}, recentCompletedJobs: [], withdrawalLogs: [] });
      const banned = await fetchJson('/admin/security/banned-ips');
      setBannedIps(Array.isArray(banned) ? banned : []);
      const coups = await fetchJson('/admin/coupons');
      setCouponsData(Array.isArray(coups) ? coups : []);
      const logs = await fetchJson('/admin/logs');
      setSystemLogs(Array.isArray(logs) ? logs : []);
      const archives = await fetchJson('/admin/archives/users');
      setArchivedUsers(Array.isArray(archives) ? archives : []);
      const health = await fetchJson('/health');
      setSystemStatus(health || { uptime: 0, dbConnected: false });
    } catch (error) {
      showToast(`Failed to fetch dashboard data: ${error.message}`, 'error');
      console.error('Dashboard error:', error);
      showToast('Failed to fetch dashboard data.', 'error');
    } finally {
      if (mounted.current) setIsLoading(false);
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
    let checkInterval;
    const triggerAnim = () => {
      if (typeof window !== 'undefined' && window.anime) {
        window.anime({ targets: '.admin-metric-card', translateY: [30, 0], opacity: [0, 1], delay: window.anime && typeof window.anime.stagger === 'function' ? window.anime.stagger(150) : 0, duration: 800, easing: 'easeOutCubic' });
        return true;
      }
      return false;
    };
    if (!triggerAnim()) checkInterval = setInterval(() => { if (triggerAnim()) clearInterval(checkInterval); }, 200);
    return () => { if (checkInterval) clearInterval(checkInterval); };
  }, []);

  const totalElectricians = liveData.filter(u => u.role === 'electrician').length;
  const totalCustomers = liveData.filter(u => u.role === 'customer').length;

  const currentData = useMockData ? [...(Array.isArray(liveData) ? liveData : []), ...mockData] : (Array.isArray(liveData) ? liveData : []);

  const filteredDB = currentData.filter(row => 
    row && Object.values(row).some(val =>
      val != null && String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const formatUptime = (seconds) => {
    if (!seconds) return 'Loading...';
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

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
        const escapeCSV = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
        const customerName = job.customer ? escapeCSV(job.customer.name) : '"N/A"';
        const customerPhone = job.customer ? escapeCSV(job.customer.phone) : '"N/A"';
        const electricians = job.electricians && job.electricians.length > 0 
          ? escapeCSV(job.electricians.map(e => e?.name || 'Unknown').join(' & ')) 
          : '"None"';
        const completedAt = escapeCSV(job.updatedAt || job.createdAt ? new Date(job.updatedAt || job.createdAt).toLocaleString() : 'N/A');
        
        const row = [
          job._id, escapeCSV(job.serviceType), escapeCSV(job.address), job.estimatedPrice,
          customerName, customerPhone, electricians, completedAt
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
      window.URL.revokeObjectURL(url);
      
      showToast('Report generated successfully!', 'success');
    } catch (error) {
      showToast(`Failed to generate report: ${error.message}`, 'error');
      console.error('Report error:', error);
      showToast('Failed to generate report.', 'error');
    } finally {
      if (mounted.current) setIsDownloading(false);
    }
  };

  const handleViewActivity = async (user) => {
    try {
      const data = await fetchJson(`/admin/users/${user._id}/activity`);
      setActivityData(data);
      setActivityUser(user);
    } catch (e) {
      showToast('Failed to load user activity logs.', 'error');
    }
  };

  const handleForcePassword = async (id) => {
    if (!newPasswordInput || newPasswordInput.length < 6) return showToast('Password must be at least 6 characters.', 'error');
    if (!window.confirm('WARNING: Force reset this user\'s password? They will be logged out if they are currently online.')) return;
    try {
      await fetchJson(`/admin/users/${id}/force-password`, { method: 'PUT', body: { newPassword: newPasswordInput } });
      showToast('Password forcefully overwritten.', 'success');
      setNewPasswordInput('');
    } catch (e) { showToast(e.message || 'Failed to reset password.', 'error'); }
  };

  const handleApprovePayment = async (id) => {
    try {
      await fetchJson(`/admin/jobs/${id}/verify-payment`, { method: 'PUT' });
      showToast('Payment verified. Job is now active.', 'success');
      sendPush('Payment Approved', 'The job is now live for electricians to accept.');
      // The WebSocket 'adminRefresh' event will automatically pull the fresh lists
      } catch (e) {
        console.error('Payment approval error:', e); 
        showToast(e.message || 'Failed to verify payment.', 'error'); 
    }
  };

  const handleApproveWithdrawal = async (id) => {
    try {
      await fetchJson(`/admin/withdrawals/${id}/approve`, { method: 'PUT' });
      showToast('Withdrawal approved.', 'success');
      sendPush('Withdrawal Approved', 'Electrician funds have been marked as transferred.');
      // The WebSocket 'adminRefresh' event will automatically pull the fresh lists
      } catch (e) { 
        console.error('Withdrawal error:', e);
        showToast(e.message || 'Failed to approve withdrawal.', 'error'); 
    }
  };

  const handleRejectWithdrawal = async (id) => {
    if (!window.confirm('Are you sure you want to reject this withdrawal? The funds will be refunded back to the electrician\'s wallet.')) return;
    try {
      await fetchJson(`/admin/withdrawals/${id}/reject`, { method: 'PUT' });
      showToast('Withdrawal rejected and refunded.', 'success');
      sendPush('Withdrawal Rejected', 'The withdrawal request was rejected and funds were returned.');
      // The WebSocket 'adminRefresh' event will automatically pull the fresh lists
    } catch (e) {
      console.error('Withdrawal rejection error:', e);
      showToast(e.message || 'Failed to reject withdrawal.', 'error');
    }
  };

  const handleReviewDocs = async (row) => {
    try {
      const docs = await fetchJson(`/admin/users/${row._id}/docs`);
      setReviewUser({ ...row, ...docs });
    } catch (error) {
      showToast('Failed to load documents', 'error');
    }
  };

  const handleDeleteUser = async (id) => {
    const action = window.prompt('Type "ARCHIVE" to soft-delete, or "PURGE" to completely obliterate this user permanently:');
    if (action !== 'ARCHIVE' && action !== 'PURGE') {
      if (action !== null) showToast('Deletion cancelled.', 'warning');
      return;
    }
    try {
      const endpoint = action === 'PURGE' ? `/admin/users/${id}?hard=true` : `/admin/users/${id}`;
      await fetchJson(endpoint, { method: 'DELETE' });
      showToast(`User ${action === 'PURGE' ? 'permanently purged' : 'archived'} successfully.`, 'success');
      fetchDashboardData();
    } catch(e) {
      showToast(e.message || 'Failed to delete user', 'error');
    }
  };

  const handlePermanentDeleteArchive = async (archiveId) => {
    const confirmText = window.prompt('WARNING: This will permanently erase this user data from the database. Type "PURGE" to confirm:');
    if (confirmText !== 'PURGE') {
      if (confirmText !== null) showToast('Permanent deletion cancelled.', 'warning');
      return;
    }
    try {
      await fetchJson(`/admin/archives/users/${archiveId}`, { method: 'DELETE' });
      showToast('Archived record permanently obliterated.', 'success');
      fetchDashboardData();
    } catch(e) {
      showToast(e.message || 'Failed to purge record.', 'error');
    }
  };

  const handleEditWallet = async (user) => {
    const currentBal = user.walletBalance || 0;
    const amount = window.prompt(`Update wallet balance for ${user.name} (Current: ₹${currentBal})`, currentBal);
    if (amount === null || amount === "") return;
    
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return showToast('Invalid amount. Must be a positive number.', 'error');
    }

    try {
      await fetchJson(`/admin/users/${user._id}/wallet`, { 
        method: 'PUT', 
        body: { walletBalance: parsedAmount } 
      });
      showToast(`Wallet balance updated to ₹${parsedAmount}`, 'success');
      fetchDashboardData();
    } catch(e) {
      showToast(e.message || 'Failed to update wallet', 'error');
    }
  };

  const handleApproveElectrician = async (id) => {
    try {
      await fetchJson(`/admin/users/${id}/approve`, { method: 'PUT' });
      showToast('Electrician approved and verified', 'success');
      fetchDashboardData();
    } catch(e) {
      showToast('Failed to approve electrician', 'error');
    }
  };

  const handleRejectElectrician = async (id) => {
    if (!window.confirm('Are you sure you want to reject this application? The account will be deleted.')) return;
    try {
      await fetchJson(`/admin/users/${id}/reject`, { method: 'DELETE' });
      showToast('Application rejected and account deleted.', 'success');
      fetchDashboardData();
    } catch(e) {
      showToast('Failed to reject application', 'error');
    }
  };

  const handleBanIp = async (e) => {
    e.preventDefault();
    if (!ipToBan.trim()) return showToast('Please enter an IP address.', 'error');
    if (!window.confirm(`WARNING: Are you sure you want to permanently ban the IP ${ipToBan}?`)) return;
    try {
      await fetchJson('/admin/security/ban-ip', { method: 'POST', body: { ip: ipToBan.trim(), reason: banReason.trim() } });
      showToast('IP Address banned successfully.', 'success');
      setIpToBan(''); setBanReason(''); fetchDashboardData();
    } catch(e) { showToast(e.message || 'Failed to ban IP.', 'error'); }
  };

  const handleUnbanIp = async (ip) => {
    if (!window.confirm(`Unban the IP ${ip}?`)) return;
    try {
      await fetchJson(`/admin/security/banned-ips/${encodeURIComponent(ip)}`, { method: 'DELETE' });
      showToast('IP Address unbanned.', 'success');
      fetchDashboardData();
    } catch(e) { showToast(e.message || 'Failed to unban IP.', 'error'); }
  };

  const handleBroadcast = async () => {
    if(!broadcastMsg.trim()) return;
    try {
      await fetchJson('/admin/broadcast', { method: 'POST', body: { message: broadcastMsg.trim() } });
      showToast('Broadcast sent to all active users!', 'success');
      sendPush('Broadcast Sent', 'Your message was delivered to all online users.');
      setBroadcastMsg('');
      } catch(e) { 
      console.error('Broadcast error:', e);
      showToast(e.message || 'Failed to send broadcast.', 'error'); 
    }
  };

  const handleForceCancelJob = async (id) => {
    if (!window.confirm('WARNING: Force cancel this job? This will notify users and refund any upfront payments.')) return;
    try {
      await fetchJson(`/admin/jobs/${id}/cancel`, { method: 'PUT' });
      showToast('Job cancelled forcefully.', 'success');
    } catch (e) {
      showToast(e.message || 'Failed to cancel job.', 'error');
    }
  };

  const handleGenerateCoupon = async (e) => {
    e.preventDefault();
    if (!newCouponAmount || Number(newCouponAmount) <= 0) return showToast('Please enter a valid discount amount.', 'error');
    try {
      await fetchJson('/admin/coupons', { method: 'POST', body: { discountAmount: Number(newCouponAmount) } });
      showToast('Coupon generated successfully!', 'success');
      setNewCouponAmount('');
      fetchDashboardData();
    } catch(e) { showToast(e.message || 'Failed to generate coupon.', 'error'); }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchDashboardData();
    setTimeout(() => { if (mounted.current) setIsRefreshing(false); }, 1000);
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
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Connected to Production Database</span>
          </div>
        </div>
        <button className="btn btn-outline" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onLogout}>
          <i className="fas fa-power-off"></i> Terminate Session
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <input type="text" value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)} placeholder="Type a system-wide broadcast message..." className="form-control" style={{ margin: 0, flex: 1 }} maxLength="1000" />
        <button className="btn" style={{ background: 'var(--warning)' }} onClick={handleBroadcast}><i className="fas fa-bullhorn"></i> Send Broadcast</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <MetricCard icon="fa-users" title="Total Users" value={currentData.length.toLocaleString()} trend={`${totalCustomers} Customers, ${totalElectricians} Electricians`} color="var(--primary)" />
        <MetricCard icon="fa-helmet-safety" title="Total Electricians" value={totalElectricians.toLocaleString()} trend="Verified professionals" color="var(--warning)" />
        <MetricCard icon="fa-sack-dollar" title="Gross Revenue" value={`₹${(financeData.stats?.totalRevenue || 0).toLocaleString()}`} trend="From all completed jobs" color="var(--success)" />
        <MetricCard icon="fa-server" title="Server Uptime" value={formatUptime(systemStatus.uptime)} trend={systemStatus.dbConnected ? "Database Connected" : "Database Offline"} color={systemStatus.dbConnected ? "var(--success)" : "var(--danger)"} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <TabButton active={activeTab === 'database'} onClick={() => setActiveTab('database')} icon="fa-database" label="Global Database" />
        <TabButton active={activeTab === 'finance'} onClick={() => setActiveTab('finance')} icon="fa-indian-rupee-sign" label="Finance & Approvals" />
        <TabButton active={activeTab === 'security'} onClick={() => setActiveTab('security')} icon="fa-shield-halved" label="Security & Bans" />
        <TabButton active={activeTab === 'archives'} onClick={() => setActiveTab('archives')} icon="fa-box-archive" label="Deleted Archives" />
        <TabButton active={activeTab === 'coupons'} onClick={() => setActiveTab('coupons')} icon="fa-ticket" label="Discount Coupons" />
        <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon="fa-terminal" label="System Logs" />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 600, background: 'var(--surface)', padding: '8px 16px', borderRadius: '30px', border: '1px solid var(--border-light)' }}>
            <input type="checkbox" checked={useMockData} onChange={(e) => setUseMockData(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }} />
            Enable Mock Data
          </label>
        <button className="btn btn-outline" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} onClick={handleRefresh} disabled={isLoading || isRefreshing}>
          <i className={`fas ${isLoading || isRefreshing ? 'fa-spinner fa-spin' : 'fa-sync'}`}></i> Refresh Data
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
                    <th style={{ padding: '14px 16px' }}>Phone & Password</th>
                    <th style={{ padding: '14px 16px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                {isLoading ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>
                        <i className="fas fa-spinner fa-spin fa-2x" style={{ color: 'var(--primary)' }}></i>
                        <p style={{ marginTop: '10px', color: 'var(--text-muted)' }}>Loading Live Data...</p>
                      </td>
                    </tr>
                  ) : filteredDB.map((row, idx) => {
                    const calcStatus = (r) => r.walletBalance > 0 || r.jobsCompleted > 0 ? 'Active' : 'New';
                    return (
                      <tr key={row._id} style={{ borderBottom: '1px solid var(--border-light)', background: idx % 2 === 0 ? 'transparent' : 'var(--secondary)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row._id}</td>
                      <td style={{ padding: '14px 16px' }}><span className="badge" style={{ textTransform: 'capitalize', background: row.role === 'customer' ? 'var(--primary-light)' : '#fffbeb', color: row.role === 'customer' ? 'var(--primary)' : 'var(--warning)' }}>{row.role}</span></td>
                      <td style={{ padding: '14px 16px', fontWeight: 500 }}>{row.name}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 'bold' }}><i className="fas fa-phone" style={{ color: 'var(--text-muted)', marginRight: '4px' }}></i> {row.phone}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--danger)', marginTop: '4px' }} title="Real Password"><i className="fas fa-unlock-keyhole" style={{ marginRight: '4px' }}></i> {row.plainPassword || '***'}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ color: calcStatus(row) === 'New' ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                          • {row.status || calcStatus(row)}
                        </span>
                        <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--text-main)', borderColor: 'var(--border-light)' }} onClick={() => handleViewActivity(row)} title="View User Logs & Timings">
                            <i className="fas fa-clock-rotate-left"></i> Logs
                          </button>
                          {row.role === 'electrician' && (
                            <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'var(--primary)' }} onClick={() => { handleReviewDocs(row); setNewPasswordInput(''); }}>
                              <i className="fas fa-folder-open"></i> Docs
                            </button>
                          )}
                          {row.role !== 'admin' && (
                            <React.Fragment>
                              <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--success)', borderColor: 'var(--success)' }} onClick={() => handleEditWallet(row)} title="Edit Wallet Balance">
                                <i className="fas fa-wallet"></i> ₹{row.walletBalance || 0}
                              </button>
                              <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDeleteUser(row._id)} title="Force Delete User">
                                <i className="fas fa-trash"></i>
                              </button>
                            </React.Fragment>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {reviewUser && (
          <div className="modal-overlay visible" style={{ zIndex: 10000 }} onClick={() => setReviewUser(null)}>
            <div className="modal-content" style={{ maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Review: {reviewUser.name}</h3>
                <button onClick={() => setReviewUser(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
              </div>
              <div style={{ marginBottom: '16px', fontSize: '0.95rem' }}>
                <p style={{ margin: '4px 0' }}><strong>Phone:</strong> {reviewUser.phone}</p>
                <p style={{ margin: '4px 0' }}><strong>Status:</strong> {reviewUser.isApproved ? <span style={{color: 'var(--success)'}}>Approved</span> : <span style={{color: 'var(--warning)'}}>Pending Verification</span>}</p>
                <p style={{ margin: '4px 0' }}><strong>Bank Info:</strong> {reviewUser.bankDetails || 'Not Provided'}</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                {['idCardUrl', 'panCardUrl', 'photoUrl'].map((key, i) => {
                  const labels = ['Govt ID', 'PAN Card', 'Photo'];
                  const icons = ['fa-id-card', 'fa-id-card', 'fa-camera'];
                  return reviewUser[key] ? (
                    <div key={key} style={{ cursor: 'pointer', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '8px', textAlign: 'center' }} onClick={() => setPreviewImage({ url: reviewUser[key], title: labels[i] })}>
                      <img src={reviewUser[key]} alt={labels[i]} style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '4px', marginBottom: '8px' }} />
                      <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)' }}><i className={`fas ${icons[i]}`}></i> {labels[i]}</span>
                    </div>
                  ) : (
                    <div key={key} style={{ padding: '20px', background: 'var(--secondary)', textAlign: 'center', fontSize: '0.85rem', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No {labels[i]}</div>
                  );
                })}
              </div>
              {!reviewUser.isApproved && (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn" style={{ flex: 1, background: 'var(--success)' }} onClick={() => { handleApproveElectrician(reviewUser._id); setReviewUser(null); }}>
                    <i className="fas fa-check-circle"></i> Approve Account
                  </button>
                  <button className="btn btn-outline" style={{ flex: 1, borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => { handleRejectElectrician(reviewUser._id); setReviewUser(null); }}>
                    <i className="fas fa-times-circle"></i> Reject
                  </button>
                </div>
              )}
              
              <div style={{ marginTop: '24px', padding: '16px', background: 'var(--secondary)', borderRadius: '8px', border: '1px dashed var(--danger)' }}>
                <h4 style={{ color: 'var(--danger)', margin: '0 0 12px 0' }}><i className="fas fa-key"></i> Force Password Reset</h4>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input type="text" className="form-control" placeholder="Type new secure password" value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)} style={{ margin: 0, flex: 1 }} />
                  <button className="btn" style={{ background: 'var(--danger)', whiteSpace: 'nowrap' }} onClick={() => handleForcePassword(reviewUser._id)}>Force Reset</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {previewImage && (
          <div className="modal-overlay visible" style={{ zIndex: 10001 }} onClick={() => setPreviewImage(null)}>
            <div className="modal-content" style={{ maxWidth: '90vw', width: 'auto', maxHeight: '90vh', padding: '20px', textAlign: 'center', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>{previewImage.title}</h3>
                <button onClick={() => setPreviewImage(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', color: 'var(--text-main)', cursor: 'pointer' }}>&times;</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--secondary)', borderRadius: '8px', padding: '10px' }}>
                <img src={previewImage.url} alt={previewImage.title} style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />
              </div>
              <div style={{ marginTop: '16px' }}>
                <a href={previewImage.url} download={`document-${Date.now()}.jpg`} className="btn"><i className="fas fa-download"></i> Download Image</a>
              </div>
            </div>
          </div>
        )}
        
        {activityUser && (
          <div className="modal-overlay visible" style={{ zIndex: 10000 }} onClick={() => setActivityUser(null)}>
            <div className="modal-content" style={{ maxWidth: '700px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}><i className="fas fa-user-clock" style={{ color: 'var(--primary)' }}></i> Activity: {activityUser.name}</h3>
                <button onClick={() => setActivityUser(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
              </div>
              
              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', background: 'var(--secondary)', padding: '16px', borderRadius: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Account Created</div>
                  <div style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>{new Date(activityData.userTimings?.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Last Updated</div>
                  <div style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>{new Date(activityData.userTimings?.updatedAt).toLocaleString()}</div>
                </div>
              </div>
              
              <h4 style={{ marginBottom: '12px', color: 'var(--text-main)' }}>System Logs Involving User</h4>
              <div style={{ background: '#0f172a', padding: '12px', borderRadius: '12px', overflowX: 'auto', maxHeight: '400px' }}>
                {activityData.logs.length === 0 ? <p style={{ color: '#64748b', margin: 0 }}>No logs found for this user.</p> : activityData.logs.map(log => (
                  <div key={log._id} style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px dashed #1e293b', fontSize: '0.85rem' }}>
                    <span style={{ color: '#64748b' }}>[{new Date(log.createdAt).toLocaleString()}]</span> <span style={{ color: log.level === 'INFO' ? '#38bdf8' : (log.level === 'WARN' ? '#fbbf24' : '#ef4444'), fontWeight: 'bold' }}>{log.level}</span> <span style={{ color: '#c084fc' }}>{log.src}</span> <span style={{ color: '#f8fafc' }}>{log.event}: <span style={{ color: '#94a3b8' }}>{log.details}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'finance' && (
          <div style={{ padding: '20px' }}>
            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-chart-pie"></i> Financial Statistics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
              <MetricCard icon="fa-sack-dollar" title="Gross Revenue" value={`₹${financeData.stats?.totalRevenue?.toLocaleString() || 0}`} trend="Total value of completed jobs" color="var(--primary)" />
              <MetricCard icon="fa-chart-line" title="Platform Profit" value={`₹${financeData.stats?.totalProfit?.toLocaleString() || 0}`} trend="20% Commission" color="var(--success)" />
              <MetricCard icon="fa-money-bill-transfer" title="Total Payouts" value={`₹${financeData.stats?.totalPayouts?.toLocaleString() || 0}`} trend="Approved withdrawals" color="var(--warning)" />
              <MetricCard icon="fa-percent" title="Gross Margin" value={financeData.stats?.grossMargin || '20%'} trend="Fixed platform fee" color="var(--gold)" />
            </div>

            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-receipt"></i> Pending User Payments</h3>
            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
          {(financeData.pendingJobs || []).length === 0 && <p style={{ color: 'var(--text-muted)' }}>No payments pending verification.</p>}
          {(financeData.pendingJobs || []).map(job => (
                <div key={job._id} style={{ background: 'var(--secondary)', padding: '16px', borderRadius: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{job.serviceType}</strong> - ₹{job.estimatedPrice} {job.originalPrice && job.originalPrice !== job.estimatedPrice ? <span style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>(Coupon Used)</span> : ''} <br/>
                    <small>Customer: {job.customer?.name} ({job.customer?.phone})</small>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn" style={{ background: 'var(--success)' }} onClick={() => handleApprovePayment(job._id)}>Approve Payment</button>
                    <button className="btn btn-outline" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => handleForceCancelJob(job._id)}>Force Cancel</button>
                  </div>
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
                    <button className="btn btn-outline" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => handleRejectWithdrawal(req._id)}>Reject</button>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px', marginTop: '32px' }}><i className="fas fa-file-invoice-dollar"></i> Completed Job Revenue Logs</h3>
            <div style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>Date</th>
                    <th style={{ padding: '14px 16px' }}>Service</th>
                    <th style={{ padding: '14px 16px' }}>Customer</th>
                    <th style={{ padding: '14px 16px' }}>Electrician(s)</th>
                    <th style={{ padding: '14px 16px' }}>Gross Revenue</th>
                    <th style={{ padding: '14px 16px' }}>Profit (20%)</th>
                  </tr>
                </thead>
                <tbody>
                  {(financeData.recentCompletedJobs || []).length === 0 ? <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No completed jobs yet.</td></tr> : (financeData.recentCompletedJobs || []).map(job => {
                    const rev = job.originalPrice || job.estimatedPrice;
                    const profit = rev * 0.2;
                    return (
                    <tr key={job._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '14px 16px' }}>{new Date(job.createdAt).toLocaleString()}</td>
                      <td style={{ padding: '14px 16px', textTransform: 'capitalize' }}>{job.serviceType.replace('_', ' ')}</td>
                      <td style={{ padding: '14px 16px' }}>{job.customer?.name || 'N/A'}</td>
                      <td style={{ padding: '14px 16px' }}>{job.electricians?.map(e => e.name).join(', ') || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontWeight: 'bold', color: 'var(--primary)' }}>₹{rev}</td>
                      <td style={{ padding: '14px 16px', fontWeight: 'bold', color: 'var(--success)' }}>₹{profit.toFixed(2)}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>

            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px', marginTop: '32px' }}><i className="fas fa-building-columns"></i> Historical Payout Logs</h3>
            <div style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>Date Processed</th>
                    <th style={{ padding: '14px 16px' }}>Electrician</th>
                    <th style={{ padding: '14px 16px' }}>Phone</th>
                    <th style={{ padding: '14px 16px' }}>Amount</th>
                    <th style={{ padding: '14px 16px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(financeData.withdrawalLogs || []).length === 0 ? <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No payout history.</td></tr> : (financeData.withdrawalLogs || []).map(log => (
                    <tr key={log._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '14px 16px' }}>{new Date(log.updatedAt).toLocaleString()}</td>
                      <td style={{ padding: '14px 16px', fontWeight: 'bold' }}>{log.electrician?.name || 'N/A'}</td>
                      <td style={{ padding: '14px 16px' }}>{log.electrician?.phone || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', fontWeight: 'bold' }}>₹{log.amount}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className="badge" style={{ background: log.status === 'approved' ? 'var(--success)' : 'var(--danger)', color: 'white' }}>{log.status.toUpperCase()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'security' && (
          <div style={{ padding: '20px' }}>
            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-shield-halved"></i> IP Ban Management</h3>
            <div style={{ background: 'var(--secondary)', padding: '20px', borderRadius: '12px', border: '1px dashed var(--danger)', marginBottom: '24px' }}>
              <h4 style={{ color: 'var(--danger)', margin: '0 0 12px 0' }}>Block a New IP Address</h4>
              <form onSubmit={handleBanIp} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <input type="text" className="form-control" value={ipToBan} onChange={e => setIpToBan(e.target.value)} placeholder="Enter IP Address (e.g. 192.168.1.1)" style={{ flex: '1 1 200px', margin: 0 }} required />
                <input type="text" className="form-control" value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="Reason (Optional)" style={{ flex: '2 1 300px', margin: 0 }} />
                <button type="submit" className="btn" style={{ background: 'var(--danger)' }}><i className="fas fa-ban"></i> Ban IP</button>
              </form>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>IP Address</th>
                    <th style={{ padding: '14px 16px' }}>Reason</th>
                    <th style={{ padding: '14px 16px' }}>Date Banned</th>
                    <th style={{ padding: '14px 16px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bannedIps.length === 0 ? (
                    <tr><td colSpan="4" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No IP addresses are currently banned.</td></tr>
                  ) : bannedIps.map(record => (
                    <tr key={record._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--danger)' }}>{record.ip}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-main)' }}>{record.reason || 'N/A'}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{new Date(record.createdAt).toLocaleString()}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--success)', borderColor: 'var(--success)' }} onClick={() => handleUnbanIp(record.ip)}><i className="fas fa-unlock"></i> Unban</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'archives' && (
          <div style={{ padding: '20px' }}>
            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-box-archive"></i> Deleted Users & Data</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>Original ID</th>
                    <th style={{ padding: '14px 16px' }}>Name & Phone</th>
                    <th style={{ padding: '14px 16px' }}>Deleted By</th>
                    <th style={{ padding: '14px 16px' }}>Deleted At</th>
                    <th style={{ padding: '14px 16px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedUsers.length === 0 ? <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No archived records found.</td></tr> : archivedUsers.map(u => (
                    <tr key={u._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--danger)' }}>{u.originalId}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <strong>{u.name}</strong><br/>
                        <small><i className="fas fa-phone"></i> {u.phone}</small><br/>
                        <small style={{ color: 'var(--danger)' }}><i className="fas fa-unlock-keyhole"></i> {u.plainPassword || '***'}</small>
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--warning)' }}>{u.deletedBy}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{new Date(u.deletedAt).toLocaleString()}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'white', background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handlePermanentDeleteArchive(u._id)} title="Permanently Erase Record">
                          <i className="fas fa-fire"></i> Purge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'coupons' && (
          <div style={{ padding: '20px' }}>
            <h3 style={{ color: 'var(--text-main)', marginBottom: '16px' }}><i className="fas fa-ticket"></i> Generate & Track Coupons</h3>
            <div style={{ background: 'var(--secondary)', padding: '20px', borderRadius: '12px', border: '1px dashed var(--primary)', marginBottom: '24px' }}>
              <h4 style={{ color: 'var(--primary)', margin: '0 0 12px 0' }}>Create a New Coupon</h4>
              <form onSubmit={handleGenerateCoupon} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="input-icon-wrapper" style={{ flex: '1 1 200px' }}>
                  <i className="fas fa-indian-rupee-sign" style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }}></i>
                  <input type="number" className="form-control" value={newCouponAmount} onChange={e => setNewCouponAmount(e.target.value)} placeholder="Discount Amount (e.g. 100)" style={{ margin: 0, paddingLeft: '32px' }} required min="1" />
                </div>
                <button type="submit" className="btn" style={{ background: 'var(--primary)' }}><i className="fas fa-plus"></i> Generate Code</button>
              </form>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>Code</th>
                    <th style={{ padding: '14px 16px' }}>Discount</th>
                    <th style={{ padding: '14px 16px' }}>Status</th>
                    <th style={{ padding: '14px 16px' }}>Generated At</th>
                  </tr>
                </thead>
                <tbody>
                  {couponsData.length === 0 ? <tr><td colSpan="4" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No coupons generated yet.</td></tr> : couponsData.map(c => (
                    <tr key={c._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1.1rem', color: c.isUsed ? 'var(--text-muted)' : 'var(--primary)' }}>{c.code}</td>
                      <td style={{ padding: '14px 16px', fontWeight: 'bold' }}>₹{c.discountAmount}</td>
                      <td style={{ padding: '14px 16px' }}>{c.isUsed ? <span style={{ color: 'var(--danger)' }} title={c.usedBy ? `Used by: ${c.usedBy.name} (${c.usedBy.phone})` : ''}>Used <i className="fas fa-info-circle"></i></span> : <span style={{ color: 'var(--success)' }}>Active</span>}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'logs' && (
          <div style={{ background: '#0f172a', color: '#e2e8f0', minHeight: '500px', padding: '16px', overflowX: 'auto' }}>
            {systemLogs.length === 0 ? <p style={{ color: '#64748b' }}>No system logs available.</p> : systemLogs.map((log) => (
              <div key={log._id} style={{ marginBottom: '10px', display: 'flex', gap: '16px', paddingBottom: '10px', borderBottom: '1px dashed #1e293b', minWidth: '600px' }}>
                <span style={{ color: '#64748b' }}>[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                <span style={{ color: log.level === 'INFO' ? '#38bdf8' : (log.level === 'WARN' ? '#fbbf24' : '#ef4444'), fontWeight: 'bold', width: '60px' }}>{log.level}</span>
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
  const { socket, isConnected } = useSocket();
  const [user, setUser] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('wattzen_theme') === 'dark');
  const [toasts, setToasts] = useState([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [showConnectionWarning, setShowConnectionWarning] = useState(false);
  const [isBrowserOffline, setIsBrowserOffline] = useState(!navigator.onLine);

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
    // Request push notification permission upon explicit user login
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    navigate(`/${role}`);
  };

  const handleProfileUpdate = (updatedUser) => {
    // Merge with existing user data to prevent partial API responses from wiping local fields (like walletBalance)
    const userWithRole = { ...user, ...updatedUser, role: user.role };
    setUser(userWithRole);
    localStorage.setItem('user', JSON.stringify(userWithRole));
  };

  const handleLogout = React.useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    if (socket.connected) socket.disconnect(); // Prevent zombie socket connections on account switch
    navigate('/login');
  }, [navigate, socket]);

  const handleLogoutRef = useRef(handleLogout);
  useEffect(() => { handleLogoutRef.current = handleLogout; }, [handleLogout]);

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

  // Browser Native Offline/Online Listeners
  useEffect(() => {
    const handleOnline = () => { setIsBrowserOffline(false); showToast('Back online! Network connection restored.', 'success'); };
    const handleOffline = () => { setIsBrowserOffline(true); showToast('You are offline. Live tracking and chat are disabled.', 'warning'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  // Prevent the "Connection lost" banner from flashing instantly on page load
  useEffect(() => {
    let timer;
    if (!isConnected && user && !isInitializing) {
      timer = setTimeout(() => setShowConnectionWarning(true), 4000); // Wait 4s before showing warning
    } else {
      setShowConnectionWarning(false);
    }
    return () => clearTimeout(timer);
  }, [isConnected, user, isInitializing]);

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
      if (!localStorage.getItem('token')) return; // 6. Prevent double auth-expired toasts/loops
      showToast('Session expired. Please log in again.', 'warning');
      sendPush('Session Expired', 'Your secure session has expired. Please log in again.');
        handleLogoutRef.current();
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
        // FIX: Prevent forced logouts on Render cold starts or transient network drops. 
        // Only log out if the backend explicitly rejected the token (Session expired).
        if (isMounted && (error.message.includes('expired') || error.message.includes('Invalid user data'))) {
          handleLogoutRef.current();
        }
      } finally {
        if (isMounted) {
          setIsInitializing(false);
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
      // Always ensure the token is up to date when the user state changes
      socket.auth = { token: localStorage.getItem('token') };
      const handleReconnectAttempt = () => { socket.auth = { token: localStorage.getItem('token') }; };
      
      if (!socket.connected) {
        socket.connect();
        
        // 5. Inject fresh token on reconnect attempts if the user logs out/in while offline
        socket.io.on('reconnect_attempt', handleReconnectAttempt);
      }
      const handleBroadcast = (msg) => {
        showToast(`📢 Admin Broadcast: ${msg}`, 'warning');
        sendPush('Admin Broadcast', msg);
      };
      const handleConnectError = (err) => {
        if (err.message.includes('Authentication error')) {
          window.dispatchEvent(new Event('auth-expired'));
        }
      };

      socket.on('systemBroadcast', handleBroadcast);
      socket.on('connect_error', handleConnectError);
      
      return () => {
        if (socket.io) socket.io.off('reconnect_attempt', handleReconnectAttempt);
        socket.off('systemBroadcast', handleBroadcast);
        socket.off('connect_error', handleConnectError);
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
      padding: isAuthView ? '0' : '16px',
      margin: '0 auto'
    }}>
      {isBrowserOffline ? (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', background: 'var(--danger)', color: 'white', textAlign: 'center', padding: '6px', fontSize: '0.85rem', zIndex: 10000, fontWeight: 'bold', boxShadow: 'var(--shadow-md)' }}>
          <i className="fas fa-wifi" style={{ marginRight: '8px' }}></i> You are offline. Check your internet connection.
        </div>
      ) : showConnectionWarning ? (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', background: 'var(--warning)', color: '#0f172a', textAlign: 'center', padding: '6px', fontSize: '0.85rem', zIndex: 10000, fontWeight: 'bold', boxShadow: 'var(--shadow-md)' }}>
          <i className="fas fa-satellite-dish" style={{ marginRight: '8px', animation: 'pulse 1.5s infinite' }}></i> Syncing real-time server... (This may take up to 50s)
        </div>
      ) : null}

      <Routes>
        <Route path="/" element={user ? <Navigate to={`/${user.role}`} replace /> : <Landing onEnter={() => navigate('/login')} onSecret={handleSecretAdminLogin} />} />
        <Route path="/login" element={user ? <Navigate to={`/${user.role}`} replace /> : <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />} />
        
        <Route path="/admin" element={user?.role === 'admin' ? <AdminPanel user={user} onLogout={handleLogout} showToast={showToast} /> : <Navigate to="/login" replace />} />
        
        <Route path="/customer" element={user?.role === 'customer' ? (
          <React.Fragment>
            <Navbar user={user} onLogout={handleLogout} toggleTheme={toggleTheme} isDarkMode={isDarkMode} onEditProfile={() => setIsProfileModalOpen(true)} />
            <div style={{ padding: '20px 0', paddingBottom: '90px' }}><CustomerHome user={user} showToast={showToast} onEditProfile={() => setIsProfileModalOpen(true)} /></div>
          </React.Fragment>
        ) : <Navigate to="/login" replace />} />

        <Route path="/electrician" element={user?.role === 'electrician' ? (
          <React.Fragment>
            <Navbar user={user} onLogout={handleLogout} toggleTheme={toggleTheme} isDarkMode={isDarkMode} onEditProfile={() => setIsProfileModalOpen(true)} />
            <div style={{ padding: '20px 0', paddingBottom: '90px' }}><ElectricianHome user={user} showToast={showToast} onEditProfile={() => setIsProfileModalOpen(true)} onUpdateUser={handleProfileUpdate} /></div>
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
    <ErrorBoundary>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ErrorBoundary>
  );
}