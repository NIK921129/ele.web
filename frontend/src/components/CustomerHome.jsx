import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';
import { fetchJson } from '../api';

// Expanded list of services
const SERVICES = [
  { id: 'wiring', name: 'Wiring Issue', icon: 'fa-plug-circle-bolt' },
  { id: 'fan', name: 'Fan Repair', icon: 'fa-fan' },
  { id: 'switch', name: 'Switchboard', icon: 'fa-toggle-on' },
  { id: 'install', name: 'Installation', icon: 'fa-screwdriver-wrench' },
  { id: 'ac', name: 'AC Servicing', icon: 'fa-snowflake' },
  { id: 'ev', name: 'EV Charger', icon: 'fa-car-battery' },
  { id: 'smart', name: 'Smart Home', icon: 'fa-house-signal' },
  { id: 'inverter', name: 'Inverter/UPS', icon: 'fa-battery-full' }
];

export default function CustomerHome({ user }) {
  const [selectedService, setSelectedService] = useState('wiring');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState([77.5946, 12.9716]); // [lng, lat] default to BLR for testing
  const [liveLocation, setLiveLocation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [isBooking, setIsBooking] = useState(false);
  const [assignedElectrician, setAssignedElectrician] = useState(null);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const chatContainerRef = useRef(null);

  // Socket.io connection and listeners
  useEffect(() => {
    if (!activeJobId) return;

    socket.connect();
    socket.emit('joinJobRoom', activeJobId);

    socket.on('electricianLocationChanged', (data) => {
      console.log('Live location update received:', data);
      setLiveLocation(data);
    });

    socket.on('receiveMessage', (data) => {
      // Mark incoming messages as 'other' for UI alignment
      setMessages((prev) => [...prev, { ...data, sender: 'other' }]);
    });

    socket.on('jobAccepted', (data) => {
      setAssignedElectrician(data.electrician);
    });

    socket.on('jobCompleted', () => {
      setJobCompleted(true);
    });

    // Cleanup function to prevent memory leaks and duplicate listeners
    return () => {
      socket.off('electricianLocationChanged');
      socket.off('receiveMessage');
      socket.off('jobAccepted');
      socket.off('jobCompleted');
      socket.disconnect();
    };
  }, [activeJobId]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleBookJob = async () => {
    if (!address) return alert('Please enter your full address to book a service.');
    setIsBooking(true);
    try {
      const job = await fetchJson('/jobs', {
        method: 'POST',
        body: {
          serviceType: selectedService,
          address: address,
          coordinates: coordinates,
          estimatedPrice: 349
        }
      });
      setActiveJobId(job._id);
      alert(`Job created successfully! DB ID: ${job._id}`);
      setJobCompleted(false);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsBooking(false);
    }
  };

  const handleCancelJob = async () => {
    try {
      await fetchJson(`/jobs/${activeJobId}/cancel`, { method: 'PUT' });
      setActiveJobId(null);
      setAssignedElectrician(null);
      setLiveLocation(null);
      setMessages([]);
      setJobCompleted(false);
      setShowRating(false);
      setRating(0);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const msgData = {
      jobId: activeJobId,
      senderId: user.id || user._id, // Send the actual user ID securely
      sender: user?.name || 'Customer',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('sendMessage', msgData);
    setMessages((prev) => [...prev, { ...msgData, sender: 'self' }]);
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
          alert('Could not detect your location. Please check browser permissions.');
        }
      );
    } else {
      alert('Geolocation is not supported by your browser.');
    }
  };

  const handlePayment = () => {
    // Mock payment processing and resetting state
    alert('Payment Processed! Thank you for using VoltFlow.');
    setShowRating(true);
  };

  const handleSubmitRating = async () => {
    try {
      const electricianId = assignedElectrician.id || assignedElectrician._id;
      await fetchJson(`/users/${electricianId}/rate`, {
        method: 'POST',
        body: { rating }
      });
      alert(`Thank you for your ${rating}-star feedback!`);
    } catch (error) {
      alert(error.message);
    }
    setActiveJobId(null);
    setAssignedElectrician(null);
    setLiveLocation(null);
    setJobCompleted(false);
    setMessages([]);
    setShowRating(false);
    setRating(0);
  };

  return (
    <div className="dashboard-grid">
      <div>
        <div className="promo-banner" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: 'white', padding: '24px', borderRadius: 'var(--radius-card)', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'var(--shadow-lg)', border: '1px solid #334155' }}>
          <div>
            <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: '#60a5fa', marginBottom: '8px', display: 'inline-block' }}>SUMMER SALE</span>
            <h2 style={{ margin: 0, color: 'white', fontSize: '1.5rem' }}>20% Off AC Servicing</h2>
            <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.95rem' }}>Beat the heat with verified cooling experts.</p>
          </div>
          <button className="btn" style={{ background: 'white', color: '#0f172a', fontWeight: 'bold', boxShadow: 'none', padding: '12px 20px' }}>Claim Offer</button>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '1.4rem' }}><i className="fas fa-hand-sparkles" style={{ marginRight: '8px', color: 'var(--warning)' }}></i> Hello, {user?.name.split(' ')[0]}</h3>
            <span className="badge" style={{ background: 'var(--gold)', color: '#854d0e', padding: '6px 12px' }}>
              <i className="fas fa-gem"></i> Premium
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>What do you need help with today? Choose from our expanded catalog.</p>
          
          <div className="service-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
            {SERVICES.map(s => (
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

          <div className="address-bar">
            <i className="fas fa-location-dot"></i>
            <input type="text" className="address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter your full address..." />
            <button className="btn" style={{ padding: '10px 20px' }} onClick={handleLocateMe} title="Detect Location"><i className="fas fa-crosshairs"></i></button>
          </div>

          {!activeJobId ? (
            <button className="btn btn-block" style={{ marginTop: '16px' }} onClick={handleBookJob} disabled={isBooking}>
              <i className="fas fa-bolt"></i> {isBooking ? 'Creating Job...' : 'Find Electricians Near Me'}
            </button>
          ) : !assignedElectrician ? (
            <div style={{ marginTop: '16px', padding: '16px', background: 'var(--secondary)', borderRadius: '12px', textAlign: 'center', border: '1px dashed var(--primary)' }}>
              <i className="fas fa-spinner fa-spin" style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '1.5rem' }}></i>
              <div style={{ fontWeight: 'bold' }}>Searching for nearby electricians...</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Tracking Job ID: <span style={{ fontFamily: 'monospace' }}>{activeJobId}</span></div>
              <button className="btn btn-outline" style={{ marginTop: '12px', borderColor: 'var(--danger)', color: 'var(--danger)', padding: '6px 12px', fontSize: '0.85rem' }} onClick={handleCancelJob}>
                Cancel Search
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '16px', padding: '16px', background: '#ecfdf5', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--success)' }}>
              <i className="fas fa-check-circle" style={{ color: 'var(--success)', marginBottom: '8px', fontSize: '1.5rem' }}></i>
              <div style={{ fontWeight: 'bold', color: 'var(--success)' }}>Job Accepted!</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{assignedElectrician.name} is preparing to depart.</div>
            </div>
          )}

          {/* Dynamic UI to show the location updates when they arrive */}
          {jobCompleted ? (
            showRating ? (
              <div style={{ marginTop: '16px', padding: '24px', background: 'var(--surface)', borderRadius: '12px', border: '2px solid var(--primary)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}>
                <h3 style={{ color: 'var(--text-main)', margin: '0 0 8px 0' }}>Rate your Experience</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>How was your service with <strong>{assignedElectrician?.name}</strong>?</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', fontSize: '2.5rem', marginBottom: '24px' }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <i 
                      key={star} 
                      className="fas fa-star" 
                      style={{ cursor: 'pointer', color: star <= (hoverRating || rating) ? 'var(--gold)' : 'var(--border-light)', transition: 'color 0.2s, transform 0.2s' }}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(star)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Rate ${star} stars`}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRating(star); } }}
                    ></i>
                  ))}
                </div>
                <button className="btn btn-block" onClick={handleSubmitRating} disabled={rating === 0}>
                  Submit Feedback
                </button>
              </div>
            ) : (
              <div style={{ marginTop: '16px', padding: '24px', background: 'var(--surface)', borderRadius: '12px', border: '2px solid var(--primary)', textAlign: 'center', boxShadow: 'var(--shadow-md)' }}>
                <h3 style={{ color: 'var(--primary)', margin: '0 0 8px 0' }}><i className="fas fa-file-invoice-dollar"></i> Invoice Summary</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>Service completed by <strong>{assignedElectrician?.name}</strong>.</p>
                <h2 style={{ fontSize: '2.5rem', color: 'var(--text-main)', margin: '0 0 20px 0' }}>₹349</h2>
                <button className="btn btn-block" onClick={handlePayment}>
                  <i className="fas fa-credit-card"></i> Pay & Rate
                </button>
              </div>
            )
          ) : (assignedElectrician || liveLocation) && (
            <>
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
              
              {/* Real-time Chat Widget */}
              <div style={{ marginTop: '16px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ background: 'var(--primary)', color: 'white', padding: '10px 16px', fontWeight: 'bold' }}>
                  <i className="fas fa-comments"></i> Message Electrician
                </div>
                <div ref={chatContainerRef} style={{ padding: '16px', height: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--secondary)' }}>
                  {messages.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.sender === 'self' ? 'flex-end' : 'flex-start', background: m.sender === 'self' ? 'var(--primary)' : 'var(--surface)', color: m.sender === 'self' ? 'white' : 'var(--text-main)', padding: '8px 12px', borderRadius: '12px', maxWidth: '80%', border: m.sender === 'self' ? 'none' : '1px solid var(--border-light)' }}>
                      <div style={{ fontSize: '0.9rem' }}>{m.text}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.8, textAlign: 'right', marginTop: '4px' }}>{m.time}</div>
                    </div>
                  ))}
                  {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', margin: 'auto' }}>No messages yet. Say hi!</div>}
                </div>
                <div style={{ padding: '10px', display: 'flex', gap: '8px', borderTop: '1px solid var(--border-light)' }}>
                  <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid var(--border-light)', outline: 'none' }} />
                  <button className="btn" style={{ padding: '10px 16px', borderRadius: '20px' }} onClick={handleSendMessage}><i className="fas fa-paper-plane"></i></button>
                </div>
              </div>
            </>
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