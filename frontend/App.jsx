import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { BrowserRouter, Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';

// ==========================================
// 1. API & SOCKET UTILITIES
// ==========================================
const BASE_URL = window.API_CONFIG?.BASE_URL || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:5000' : 'https://wattzen-backend.onrender.com');
const API_BASE_URL = `${BASE_URL}/api`;
const socket = io(BASE_URL, { autoConnect: false });

async function fetchJson(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      headers,
      ...options,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
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
    const updateMouse = (x, y) => {
      if (requestRef.current) return;
      requestRef.current = requestAnimationFrame(() => {
        setMouse({ x: x / window.innerWidth - 0.5, y: y / window.innerHeight - 0.5 });
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
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
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
          <img src="./wmremove-transformed.png" alt="WATTZEN" style={{ width: '100px', height: 'auto' }} />
        </div>
        <h1 className="landing-title">Power Your <span>Network</span></h1>
        <p className="landing-desc">
          Experience the next generation of electrical services. Instant connections, live tracking, and certified safety — all in one seamless, high-powered space.
        </p>
        <button className="btn landing-btn" onClick={onEnter}>
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
function Navbar({ user, onLogout, toggleTheme, isDarkMode }) {
  return (
    <div className="navbar">
      <div className="logo-area">
        <div className="logo-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
          <img src="./wmremove-transformed.png" alt="WATTZEN Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="logo-text">WATT<span>ZEN</span></div>
      </div>
      <div className="profile-badge">
        <button onClick={toggleTheme} title="Toggle Theme" style={{ border: 'none', background: 'var(--secondary)', width: '42px', height: '42px', borderRadius: '50%', cursor: 'pointer', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)' }}>
          <i className={`fas ${isDarkMode ? 'fa-sun' : 'fa-moon'}`} style={{ fontSize: '1.2rem' }}></i>
        </button>
        <div className="notification-icon"><i className="far fa-bell"></i></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="profile-name" style={{ fontWeight: 600 }}>{user?.name}</span>
          <div style={{ background: 'var(--surface)', width: '42px', height: '42px', borderRadius: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-light)' }}>
            <i className="fas fa-user-circle" style={{ fontSize: '28px', color: 'var(--primary)' }}></i>
          </div>
        </div>
        <button className="btn btn-outline" style={{ padding: '6px 12px', marginLeft: '10px' }} onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

// --- Login Component ---
function Login({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="logo-area" style={{ justifyContent: 'center', marginBottom: '8px', transform: 'scale(1.2)' }}>
        <div className="logo-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
          <img src="./wmremove-transformed.png" alt="WATTZEN Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="logo-text">WATT<span>ZEN</span></div>
      </div>
      <div style={{ textAlign: 'center', color: 'var(--primary)', fontWeight: '700', letterSpacing: '1.5px', marginBottom: '32px', fontSize: '0.85rem' }}>POWER YOUR NETWORK</div>
      <div className="login-card">
        <h1>{isLogin ? 'Welcome Back' : 'Create Account'}</h1>
        <p>{isLogin ? 'Log in to your account to continue.' : 'Join the best electrician network.'}</p>
        
        {error && <div style={{ color: 'white', background: 'var(--danger)', padding: '10px', borderRadius: '8px', marginBottom: '16px' }}>{error}</div>}
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button type="button" className={`btn btn-block ${role === 'customer' ? '' : 'btn-outline'}`} onClick={() => setRole('customer')} style={{ padding: '10px' }}>Customer</button>
          <button type="button" className={`btn btn-block ${role === 'electrician' ? '' : 'btn-outline'}`} onClick={() => setRole('electrician')} style={{ padding: '10px' }}>Electrician</button>
        </div>

        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          {!isLogin && (
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} required placeholder="John Doe" />
            </div>
          )}
          <div className="form-group">
            <label>Phone Number</label>
            <input type="tel" className="form-control" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="1234567890" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <button type="submit" className="btn btn-block" disabled={loading} style={{ marginTop: '10px' }}>
            {loading ? 'Processing...' : (isLogin ? 'Log In' : 'Sign Up')}
          </button>
        </form>
        
        <div style={{ marginTop: '20px', fontSize: '0.9rem' }}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <a href="#!" onClick={(e) => { e.preventDefault(); setIsLogin(!isLogin); setError(null); }} style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'none' }}>
            {isLogin ? 'Sign Up' : 'Log In'}
          </a>
        </div>
      </div>
    </div>
  );
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
  
  const [activeCategory, setActiveCategory] = useState('repairs');
  const [teamSize, setTeamSize] = useState(1);

  const categories = [
    { id: 'repairs', name: 'Quick Repairs', icon: 'fa-screwdriver-wrench' },
    { id: 'appliances', name: 'Appliance Setup', icon: 'fa-plug' },
    { id: 'projects', name: 'Big Projects', icon: 'fa-hard-hat' }
  ];

  const currentServices = SERVICES.filter(s => s.category === activeCategory);
  const selectedServiceObj = SERVICES.find(s => s.id === selectedService);

  useEffect(() => {
    if (!activeJobId) return;
    socket.connect();
    socket.emit('joinJobRoom', activeJobId);

    socket.on('electricianLocationChanged', (data) => {
      setLiveLocation(data);
    });
    socket.on('receiveMessage', (data) => {
      setMessages((prev) => [...prev, { ...data, isSelf: false }]);
    });
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
        setAssignedElectricians(prev => [...prev, data.electrician]);
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
      socket.disconnect();
    };
  }, [activeJobId]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    setTeamSize(1);
  }, [selectedService]);

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
          showToast('Could not detect your location. Please check browser permissions.', 'error');
        }
      );
    } else {
      showToast('Geolocation is not supported by your browser.', 'error');
    }
  };

  const handleCompleteJob = async () => {
    try {
      await fetchJson(`/jobs/${activeJobId}/complete`, { method: 'PUT' });
      showToast('Job marked as completed. Please rate your experience!', 'success');
    } catch (error) {
      showToast(error.message, 'error');
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
    }
  };

  return (
    <div className="dashboard-grid">
      <div>
        <div className="promo-banner">
          <div>
            <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: '#60a5fa', marginBottom: '8px', display: 'inline-block' }}>SUMMER SALE</span>
            <h2 style={{ margin: 0, color: 'white', fontSize: '1.5rem' }}>20% Off AC Servicing</h2>
            <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.95rem' }}>Beat the heat with verified cooling experts.</p>
          </div>
          <button className="btn" style={{ background: 'white', color: '#0f172a', fontWeight: 'bold', boxShadow: 'none', padding: '12px 20px' }}>Claim Offer</button>
        </div>

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

          <div className="address-bar">
            <i className="fas fa-location-dot"></i>
            <input type="text" className="address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter your full address..." />
            <button className="btn" style={{ padding: '10px 20px' }} onClick={handleLocateMe} title="Detect Location"><i className="fas fa-crosshairs"></i></button>
          </div>

          {!activeJobId && !bookingPrice ? (
            <button className="btn btn-block" style={{ marginTop: '16px' }} onClick={handleInitiateBooking} disabled={isBooking}>
              <i className="fas fa-bolt"></i> {isBooking ? 'Creating Job...' : 'Find Electricians Near Me'}
            </button>
          ) : !activeJobId && bookingPrice ? (
            <div style={{ marginTop: '16px', padding: '24px', background: 'var(--surface)', borderRadius: '16px', border: '2px solid var(--primary)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}>
              <h3 style={{ color: 'var(--text-main)', margin: '0 0 8px 0' }}>Upfront Payment Required</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>To secure your booking, please pay the estimated service fee.</p>
              <h2 style={{ fontSize: '2.5rem', color: 'var(--success)', margin: '0 0 20px 0' }}>₹{bookingPrice}</h2>
              <a href={`upi://pay?pa=9211293576@ptaxis&pn=WATTZEN&am=${bookingPrice}&cu=INR`} className="btn btn-block" style={{ background: '#10b981', display: 'block', textDecoration: 'none', marginBottom: '12px' }}>
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
                    <div key={e._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface)', padding: '8px', borderRadius: '8px', marginBottom: '4px' }}><i className="fas fa-user-hard-hat" style={{color: 'var(--primary)'}}></i> <strong>{e.name}</strong> ({e.phone})</div>
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
                <div style={{ padding: '10px', display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)' }}>
                  <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} />
                  <button className="btn" style={{ padding: '10px 16px', borderRadius: '20px' }} onClick={handleSendMessage}><i className="fas fa-paper-plane"></i></button>
                </div>
              </div>
            </React.Fragment>
          )}
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
function ElectricianHome({ user, showToast }) {
  const [isOnline, setIsOnline] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [availableJob, setAvailableJob] = useState(null);
  const [walletBal, setWalletBal] = useState(user?.walletBalance || 0);
  const [currentJob, setCurrentJob] = useState(null); // Will hold the full job object
  const chatContainerRef = useRef(null);

  const jobStatus = currentJob?.status;
  const teamSize = currentJob?.teamSize || 1;
  const currentTeamSize = currentJob?.electricians?.length || 0;
  const isTeamJob = teamSize > 1;
  const isTeamWaiting = isTeamJob && jobStatus === 'searching' && currentTeamSize < teamSize;
  const isJobActive = jobStatus === 'assigned' || jobStatus === 'in_progress';
  const hasArrived = isJobActive && !isTracking; // Simplified logic for arrival

  useEffect(() => {
    if (isOnline) {
      socket.connect();
      socket.on('receiveMessage', (data) => {
        setMessages((prev) => [...prev, { ...data, isSelf: false }]);
      });
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
        fetchJson('/me').then(res => setWalletBal(res.walletBalance)).catch(() => {});
      });
    } else {
      setIsTracking(false);
      socket.disconnect();
    }
    return () => {
      socket.off('receiveMessage');
      socket.off('jobAccepted');
      socket.off('jobCancelled');
      socket.off('jobCompleted');
      socket.disconnect();
    };
  }, [isOnline]);

  useEffect(() => {
    if (isOnline && activeJobId) {
      socket.emit('joinJobRoom', activeJobId);
    }
  }, [isOnline, activeJobId]);

  useEffect(() => {
    let pollInterval;
    if (isOnline && !currentJob) {
      const checkJobs = async () => {
        try {
          const job = await fetchJson('/jobs/available?latitude=12.9716&longitude=77.5946&maxDistance=15');
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

      const handleNewJob = (job) => {
        if (job.status === 'searching') {
          setAvailableJob(job);
        }
      };
      socket.on('newJobAvailable', handleNewJob);

      return () => {
        socket.off('newJobAvailable', handleNewJob);
      };
    }
  }, [isOnline, currentJob]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    let interval;
    if (isTracking) {
      let currentDist = 3.5;
      let currentEta = 12;
      interval = setInterval(() => {
        currentDist = Math.max(0, currentDist - 0.5);
        currentEta = Math.max(0, currentEta - 2);
        socket.emit('updateLocation', {
          jobId: activeJobId,
          coordinates: [77.5946, 12.9716],
          distance: currentDist.toFixed(1),
          eta: currentEta
        });
        if (currentDist <= 0) {
          setIsTracking(false);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isTracking, activeJobId]);

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
    try {
      const acceptedJob = await fetchJson(`/jobs/${availableJob._id}/accept`, { method: 'PUT' });
      setActiveJobId(availableJob._id); // Link the job and join the chat room only AFTER accepting
      setAvailableJob(null);
      setCurrentJob(acceptedJob); // Set the full job object
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  const handleRequestWithdrawal = async () => {
    try {
      const res = await fetchJson('/withdrawals', { method: 'POST' });
      showToast('Withdrawal request sent to Admin.', 'success');
      setWalletBal(0); // Optimistically set to 0
    } catch (error) {
      showToast(error.message, 'error');
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
              <h2 style={{ color: 'var(--text-main)', fontSize: '2.2rem', margin: '4px 0 0 0' }}>0</h2>
            </div>
          </div>
        </div>

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
                  <p style={{ margin: '4px 0 12px 0', fontSize: '0.9rem', color: 'var(--text-main)' }}><strong>Location:</strong> {availableJob.address}</p>
                  <p style={{ margin: '4px 0 12px 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Job ID: <span style={{ fontFamily: 'monospace' }}>{availableJob._id}</span></p>
                  <button className="btn" style={{ width: '100%', background: 'var(--success)', marginTop: '8px' }} onClick={handleAcceptJob}>
                    Accept Job & Start Tracking
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
                </React.Fragment>
              ) : hasArrived ? (
                <React.Fragment>
                  <i className="fas fa-map-pin fa-3x" style={{ color: 'var(--primary)', marginBottom: '16px' }}></i>
                  <h4 style={{ color: 'var(--primary)' }}>You Have Arrived</h4>
                  <p style={{ color: 'var(--text-main)' }}>You can now begin the service. Message the customer if needed.</p>
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
          <div style={{ padding: '10px', display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)' }}>
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} />
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
    <div style={{ background: 'var(--surface)', padding: '20px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-light)' }}>
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
  const [activeTab, setActiveTab] = useState('database');
  const [searchTerm, setSearchTerm] = useState('');
  const [liveData, setLiveData] = useState([]);
  const [mockData, setMockData] = useState([]);
  const [useMockData, setUseMockData] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [financeData, setFinanceData] = useState({ pendingJobs: [], pendingWithdrawals: [] });
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setIsLoading(true);
        const users = await fetchJson('/admin/users');
        setLiveData(users);
        const fin = await fetchJson('/admin/finance');
        setFinanceData(fin);
      } catch (error) {
        showToast(`Failed to fetch users: ${error.message}`, 'error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
    setMockData(generateMockUsers());
  }, []);

  const currentData = useMockData ? mockData : liveData;

  const filteredDB = currentData.filter(row => 
    Object.values(row).some(val =>
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
          ? `"${job.electricians.map(e => e.name).join(' & ')}"` 
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
    } finally {
      setIsDownloading(false);
    }
  };

  const handleApprovePayment = async (id) => {
    try {
      await fetchJson(`/admin/jobs/${id}/verify-payment`, { method: 'PUT' });
      showToast('Payment verified. Job is now active.', 'success');
      // Refresh lists
      const fin = await fetchJson('/admin/finance');
      setFinanceData(fin);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleApproveWithdrawal = async (id) => {
    try {
      await fetchJson(`/admin/withdrawals/${id}/approve`, { method: 'PUT' });
      showToast('Withdrawal approved.', 'success');
      const fin = await fetchJson('/admin/finance');
      setFinanceData(fin);
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'var(--font-family, sans-serif)' }}>
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
          <button className="btn btn-outline" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={handleDownloadReport} disabled={isDownloading}>
            <i className={`fas ${isDownloading ? 'fa-spinner fa-spin' : 'fa-file-csv'}`}></i> {isDownloading ? 'Generating...' : 'Export Completed Jobs'}
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: '16px', boxShadow: 'var(--shadow-md)', overflow: 'hidden', border: '1px solid var(--border-light)' }}>
        {activeTab === 'database' && (
          <div>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}><i className="fas fa-table" style={{ color: 'var(--primary)' }}></i> Master Records</h3>
              <input type="text" aria-label="Search records" placeholder="Search IDs, Names, Locations..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border-light)', width: '300px', outline: 'none' }} />
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
              {financeData.pendingJobs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No payments pending verification.</p>}
              {financeData.pendingJobs.map(job => (
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
              {financeData.pendingWithdrawals.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No pending withdrawal requests.</p>}
              {financeData.pendingWithdrawals.map(req => (
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
          <div style={{ background: '#0f172a', color: '#e2e8f0', minHeight: '500px', padding: '16px' }}>
            {mockLogs.map((log, idx) => (
              <div key={idx} style={{ marginBottom: '10px', display: 'flex', gap: '16px', paddingBottom: '10px', borderBottom: '1px dashed #1e293b' }}>
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
  const [user, setUser] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isInitializing, setIsInitializing] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  // CONSOLIDATED HANDLERS: These must only be declared once.
  const handleLoginSuccess = (userData, role) => {
    const userWithRole = { ...userData, role };
    setUser(userWithRole);
    localStorage.setItem('user', JSON.stringify(userWithRole));
    navigate(`/${role}`);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    navigate('/');
  };

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.body.classList.toggle('dark-mode');
  };

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  useEffect(() => {
    const validateSession = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        if (location.pathname !== '/' && location.pathname !== '/login') {
          navigate('/');
        }
        setIsInitializing(false);
        return;
      }

      // Add a timeout safeguard to ensure the UI eventually loads
      const timeoutId = setTimeout(() => setIsInitializing(false), 5000);

      try {
        // BUG FIX: Stale user data in localStorage.
        // Verify token by fetching the latest user data from the server.
        const freshUser = await fetchJson('/me');
        if (freshUser && freshUser._id) {
          const userWithRole = { ...freshUser, role: freshUser.role };
          setUser(userWithRole);
          localStorage.setItem('user', JSON.stringify(userWithRole));
          const targetPath = `/${freshUser.role}`;
          if (location.pathname !== targetPath) {
            navigate(targetPath);
          }
        } else {
          throw new Error('Invalid user data received from server.');
        }
      } catch (error) {
        console.error("Session validation failed:", error.message);
        handleLogout();
      } finally {
        setIsInitializing(false);
        clearTimeout(timeoutId);
      }
    };
    validateSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSecretAdminLogin = async () => {
    const pwd = prompt("Enter Admin Secret PIN:");
    if (!pwd) return;
    try {
      const data = await fetchJson('/admin/secret-login', { method: 'POST', body: { password: pwd } });
      localStorage.setItem('token', data.token);
      const userWithRole = { ...data.user, role: 'admin' };
      setUser(userWithRole);
      navigate('/admin');
      showToast('Master Access Granted', 'success');
    } catch(e) {
      showToast('Access Denied', 'error');
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
        <Route path="/" element={<Landing onEnter={() => navigate('/login')} onSecret={handleSecretAdminLogin} />} />
        <Route path="/login" element={<Login onLoginSuccess={handleLoginSuccess} />} />
        
        <Route path="/admin" element={user?.role === 'admin' ? <AdminPanel user={user} onLogout={handleLogout} showToast={showToast} /> : <Navigate to="/login" replace />} />
        
        <Route path="/customer" element={user?.role === 'customer' ? (
          <React.Fragment>
            <Navbar user={user} onLogout={handleLogout} toggleTheme={toggleTheme} isDarkMode={isDarkMode} />
            <div style={{ padding: '20px 0' }}><CustomerHome user={user} showToast={showToast} /></div>
          </React.Fragment>
        ) : <Navigate to="/login" replace />} />

        <Route path="/electrician" element={user?.role === 'electrician' ? (
          <React.Fragment>
            <Navbar user={user} onLogout={handleLogout} toggleTheme={toggleTheme} isDarkMode={isDarkMode} />
            <div style={{ padding: '20px 0' }}><ElectricianHome user={user} showToast={showToast} /></div>
          </React.Fragment>
        ) : <Navigate to="/login" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

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