import React, { useState } from 'react';

// --- MOCK ADMIN DATABASE ---
const mockDB = [
  { id: 'USR-1001', type: 'Customer', name: 'Rahul Sharma', phone: '+91 9876543210', pass: 'bcrypt_$2a$12$Kx...', location: 'Koramangala, BLR', service: 'Wiring Issue', payment: '₹349 (Paid)', status: 'Active' },
  { id: 'ELC-2041', type: 'Electrician', name: 'Rajesh Kumar', phone: '+91 9988776655', pass: 'bcrypt_$2a$12$Lp...', location: 'HSR Layout, BLR', service: 'N/A', payment: '₹1250 (Earned)', status: 'Online' },
  { id: 'USR-1002', type: 'Customer', name: 'Anita Desai', phone: '+91 9123456780', pass: 'bcrypt_$2a$12$Zq...', location: 'Indiranagar, BLR', service: 'AC Servicing', payment: '₹950 (Pending)', status: 'Searching' },
  { id: 'ELC-2042', type: 'Electrician', name: 'Suresh Yadav', phone: '+91 9888112233', pass: 'bcrypt_$2a$12$Vn...', location: 'BTM Layout, BLR', service: 'N/A', payment: '₹4250 (Earned)', status: 'Offline' },
  { id: 'USR-1003', type: 'Customer', name: 'Vikram Singh', phone: '+91 9777665544', pass: 'bcrypt_$2a$12$Qw...', location: 'Whitefield, BLR', service: 'EV Charger', payment: '₹2500 (Paid)', status: 'Completed' },
  { id: 'ELC-2043', type: 'Electrician', name: 'Manoj Singh', phone: '+91 9111222333', pass: 'bcrypt_$2a$12$Rt...', location: 'Marathahalli, BLR', service: 'N/A', payment: '₹850 (Earned)', status: 'Suspended' },
];

const mockLogs = [
  { time: '10:42:01 AM', level: 'INFO', src: 'AuthService', event: 'User Login', details: 'ELC-2041 authenticated successfully. IP: 192.168.1.4' },
  { time: '10:45:12 AM', level: 'WARN', src: 'GeoTracker', event: 'High Latency', details: 'Location tracking API response > 500ms for ELC-2041' },
  { time: '10:48:33 AM', level: 'INFO', src: 'PaymentGateway', event: 'Payment Processed', details: 'Txn #TX-9982 successful for USR-1001. Amount: ₹349' },
  { time: '10:50:05 AM', level: 'ERROR', src: 'Socket.IO', event: 'Connection Drop', details: 'USR-1002 dropped connection unexpectedly. Reconnecting...' },
  { time: '10:55:10 AM', level: 'INFO', src: 'JobMatcher', event: 'Algorithm Match', details: 'Matched USR-1003 with ELC-2042. Distance: 1.2km' },
];

export default function AdminPanel({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('database');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredDB = mockDB.filter(row => 
    Object.values(row).some(val =>
      val != null && String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  return (
    <div style={{ padding: '20px', fontFamily: 'var(--font-family, sans-serif)' }}>
      {/* Admin Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: 'var(--surface)', padding: '16px 24px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--danger)', color: 'white', padding: '10px', borderRadius: '12px' }}>
            <i className="fas fa-user-shield fa-lg"></i>
          </div>
          <div>
            <h2 style={{ margin: 0, color: 'var(--danger)' }}>Master Admin Portal</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Connected to Production Database (Cluster-0)</span>
          </div>
        </div>
        <button className="btn btn-outline" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onLogout}>
          <i className="fas fa-power-off"></i> Terminate Session
        </button>
      </div>

      {/* Top Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <MetricCard icon="fa-users" title="Total Users" value="14,205" trend="+12% this week" color="var(--primary)" />
        <MetricCard icon="fa-helmet-safety" title="Active Electricians" value="842" trend="124 currently online" color="var(--warning)" />
        <MetricCard icon="fa-indian-rupee-sign" title="Platform Revenue" value="₹12.4L" trend="3% fee taken" color="var(--success)" />
        <MetricCard icon="fa-server" title="System Uptime" value="99.99%" trend="All systems nominal" color="var(--text-main)" />
      </div>

      {/* Admin Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <TabButton active={activeTab === 'database'} onClick={() => setActiveTab('database')} icon="fa-database" label="Global Database" />
        <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon="fa-terminal" label="System Logs" />
      </div>

      {/* Main Content Area */}
      <div style={{ background: 'var(--surface)', borderRadius: '16px', boxShadow: 'var(--shadow-md)', overflow: 'hidden', border: '1px solid var(--border-light)' }}>
        
        {activeTab === 'database' && (
          <div>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}><i className="fas fa-table" style={{ color: 'var(--primary)' }}></i> Master Records (100+ Datapoints)</h3>
              <input 
                type="text" 
                aria-label="Search records"
                placeholder="Search IDs, Names, Locations..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border-light)', width: '300px', outline: 'none' }}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead style={{ background: 'var(--secondary)', color: 'var(--text-muted)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px' }}>System ID</th>
                    <th style={{ padding: '14px 16px' }}>Type</th>
                    <th style={{ padding: '14px 16px' }}>Full Name</th>
                    <th style={{ padding: '14px 16px' }}>Contact</th>
                    <th style={{ padding: '14px 16px' }}>Password Hash</th>
                    <th style={{ padding: '14px 16px' }}>Live Location</th>
                    <th style={{ padding: '14px 16px' }}>Active Service</th>
                    <th style={{ padding: '14px 16px' }}>Payment Details</th>
                    <th style={{ padding: '14px 16px' }}>Status</th>
                    <th style={{ padding: '14px 16px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDB.map((row, idx) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--border-light)', background: idx % 2 === 0 ? 'transparent' : 'var(--secondary)' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row.id}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className="badge" style={{ background: row.type === 'Customer' ? 'var(--primary-light)' : '#fffbeb', color: row.type === 'Customer' ? 'var(--primary)' : 'var(--warning)' }}>{row.type}</span>
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: 500 }}>{row.name}</td>
                      <td style={{ padding: '14px 16px' }}>{row.phone}</td>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: 'var(--danger)', fontSize: '0.8rem' }}>{row.pass}</td>
                      <td style={{ padding: '14px 16px' }}><i className="fas fa-map-marker-alt" style={{ color: 'var(--text-muted)' }}></i> {row.location}</td>
                      <td style={{ padding: '14px 16px' }}>{row.service}</td>
                      <td style={{ padding: '14px 16px' }}>{row.payment}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ color: row.status === 'Online' || row.status === 'Active' || row.status === 'Completed' ? 'var(--success)' : row.status === 'Suspended' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                          • {row.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', marginRight: '10px' }}><i className="fas fa-pen-to-square"></i></button>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}><i className="fas fa-ban"></i></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div style={{ background: '#0f172a', color: '#e2e8f0', minHeight: '500px' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#f8fafc' }}><i className="fas fa-network-wired" style={{ color: 'var(--success)' }}></i> Live Server Event Logs</h3>
              <button className="btn-outline" style={{ padding: '6px 12px', borderColor: '#334155', color: '#94a3b8' }}><i className="fas fa-download"></i> Export CSV</button>
            </div>
            <div style={{ padding: '16px', fontFamily: 'monospace', fontSize: '0.9rem' }}>
              {mockLogs.map((log, idx) => (
                <div key={`${log.time}-${idx}`} style={{ marginBottom: '10px', display: 'flex', gap: '16px', paddingBottom: '10px', borderBottom: '1px dashed #1e293b' }}>
                  <span style={{ color: '#64748b' }}>[{log.time}]</span>
                  <span style={{ 
                    color: log.level === 'INFO' ? '#38bdf8' : log.level === 'WARN' ? '#fbbf24' : '#ef4444', 
                    fontWeight: 'bold', width: '60px' 
                  }}>
                    {log.level}
                  </span>
                  <span style={{ color: '#c084fc', width: '150px' }}>{log.src}</span>
                  <span style={{ color: '#f8fafc', flex: 1 }}>{log.event}: <span style={{ color: '#94a3b8' }}>{log.details}</span></span>
                </div>
              ))}
              <div style={{ color: 'var(--success)', marginTop: '20px', animation: 'pulse 1.5s infinite' }}>
                <i className="fas fa-circle-notch fa-spin fa-xs"></i> Listening for new incoming events...
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// --- SUBCOMPONENTS ---

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