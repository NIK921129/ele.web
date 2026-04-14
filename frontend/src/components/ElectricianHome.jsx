import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';
import { fetchJson } from '../api';

export default function ElectricianHome({ user }) {
  const [isOnline, setIsOnline] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [availableJob, setAvailableJob] = useState(null);
  const chatContainerRef = useRef(null);

  // Manage socket connection based on online status
  useEffect(() => {
    if (isOnline) {
      socket.connect();

      socket.on('receiveMessage', (data) => {
        // Mark incoming messages as 'other' for UI alignment
        setMessages((prev) => [...prev, { ...data, sender: 'other' }]);
      });
    } else {
      setIsTracking(false);
      socket.disconnect();
    }
    return () => {
      socket.off('receiveMessage');
      socket.disconnect();
    };
  }, [isOnline]);

  // Separate the room joining logic so accepting a job doesn't drop the socket connection
  useEffect(() => {
    if (isOnline && activeJobId) {
      socket.emit('joinJobRoom', activeJobId);
    }
  }, [isOnline, activeJobId]);

  // Poll for available jobs when online but not tracking
  useEffect(() => {
    let pollInterval;
    if (isOnline && !isTracking) {
      const checkJobs = async () => {
        try {
          // Pass the electrician's current mock coordinates to trigger the geospatial matching algorithm
          const job = await fetchJson('/jobs/available?latitude=12.9716&longitude=77.5946&maxDistance=15');
          setAvailableJob(job);
          if (job && job._id) setActiveJobId(job._id);
        } catch (e) {
          console.error('Failed to fetch jobs:', e);
        }
      };
      checkJobs();
      pollInterval = setInterval(checkJobs, 5000); // Check every 5 seconds
    }
    return () => clearInterval(pollInterval);
  }, [isOnline, isTracking]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Simulate emitting live location data when tracking is active
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
          coordinates: [77.5946, 12.9716], // Mock [lng, lat]
          distance: currentDist.toFixed(1),
          eta: currentEta
        });

        if (currentDist <= 0) setIsTracking(false);
      }, 3000); // Ping every 3 seconds for demonstration
    }
    return () => clearInterval(interval);
  }, [isTracking]);

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const msgData = {
      jobId: activeJobId,
      senderId: user.id || user._id, // Send the actual user ID securely
      sender: user?.name || 'Electrician',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('sendMessage', msgData);
    setMessages((prev) => [...prev, { ...msgData, sender: 'self' }]);
    setChatInput('');
  };

  const handleAcceptJob = async () => {
    try {
      await fetchJson(`/jobs/${availableJob._id}/accept`, { method: 'PUT' });
      setIsTracking(true);
      setAvailableJob(null);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleCompleteJob = async () => {
    try {
      await fetchJson(`/jobs/${activeJobId}/complete`, { method: 'PUT' });
      setIsTracking(false);
      setActiveJobId(null);
      setMessages([]);
      alert('Job successfully marked as completed!');
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="dashboard-grid">
      <div>
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '1.4rem' }}><i className="fas fa-toolbox" style={{ color: 'var(--primary)' }}></i> Welcome back, {user?.name.split(' ')[0]}</h3>
            <button className={`btn ${isOnline ? '' : 'btn-outline'}`} onClick={() => setIsOnline(!isOnline)}>
              {isOnline ? <><span className="pulse-dot" style={{ marginRight: '8px' }}></span>Online</> : 'Go Online'}
            </button>
          </div>
          <div className="inline-stats" style={{ display: 'flex', gap: '20px', marginTop: '16px' }}>
            <div style={{ flex: 1, padding: '16px', background: 'var(--secondary)', borderRadius: '16px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase' }}>TODAY'S EARNINGS</span>
              <h2 style={{ color: 'var(--success)', fontSize: '2.2rem', margin: '4px 0 0 0' }}>₹0</h2>
            </div>
            <div style={{ flex: 1, padding: '16px', background: 'var(--secondary)', borderRadius: '16px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase' }}>JOBS COMPLETED</span>
              <h2 style={{ color: 'var(--text-main)', fontSize: '2.2rem', margin: '4px 0 0 0' }}>0</h2>
            </div>
          </div>
        </div>

        {isOnline && !isTracking && (
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
                  <span className="badge" style={{ background: '#dcfce7', color: '#166534', marginBottom: '12px', display: 'inline-block' }}>NEW MATCH FOUND</span>
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

        {isTracking && (
          <div className="card" style={{ animationDelay: '0.1s', border: '2px solid var(--success)', background: '#ecfdf5' }}>
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <i className="fas fa-location-arrow fa-fade fa-3x" style={{ color: 'var(--success)', marginBottom: '16px' }}></i>
              <h4 style={{ color: 'var(--success)' }}>En Route to Customer</h4>
              <p style={{ color: 'var(--text-main)' }}>Live location sharing is active. The customer is seeing your approach!</p>
              <button className="btn btn-outline" style={{ marginTop: '16px', borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => setIsTracking(false)}>
                Stop Tracking (Arrived)
              </button>
              <button className="btn" style={{ marginTop: '16px', marginLeft: '12px', background: 'var(--success)' }} onClick={handleCompleteJob}>
                <i className="fas fa-check-circle"></i> Mark as Completed
              </button>
            </div>
        
        {/* Real-time Chat Widget */}
        <div style={{ marginTop: '16px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ background: 'var(--primary)', color: 'white', padding: '10px 16px', fontWeight: 'bold' }}>
            <i className="fas fa-comments"></i> Message Customer
          </div>
          <div ref={chatContainerRef} style={{ padding: '16px', height: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--secondary)' }}>
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.sender === 'self' ? 'flex-end' : 'flex-start', background: m.sender === 'self' ? 'var(--primary)' : 'var(--surface)', color: m.sender === 'self' ? 'white' : 'var(--text-main)', padding: '8px 12px', borderRadius: '12px', maxWidth: '80%', border: m.sender === 'self' ? 'none' : '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.9rem' }}>{m.text}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.8, textAlign: 'right', marginTop: '4px' }}>{m.time}</div>
              </div>
            ))}
            {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', margin: 'auto' }}>No messages yet. Send an update!</div>}
          </div>
          <div style={{ padding: '10px', display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)' }}>
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} />
            <button className="btn" style={{ padding: '10px 16px', borderRadius: '20px' }} onClick={handleSendMessage}><i className="fas fa-paper-plane"></i></button>
          </div>
        </div>
          </div>
        )}

        {/* New Work Manual & Guidelines Feature */}
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
          <i className="fas fa-wallet"></i> <strong>Weekly Payout Tracker</strong>
          <h3 style={{ margin: '8px 0' }}>₹4,250</h3>
          <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>Next payout processing on Friday.</p>
          <button className="btn btn-block" style={{ background: 'rgba(255,255,255,0.2)', color: 'white', marginTop: '12px' }}>Withdraw to Bank</button>
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