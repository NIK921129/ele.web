import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Navbar from './components/Navbar';
import CustomerHome from './components/CustomerHome';
import ElectricianHome from './components/ElectricianHome';
import AdminPanel from './components/AdminPanel';

export default function App() {
  const [currentView, setCurrentView] = useState('login');
  const [user, setUser] = useState(null);

  // Check for existing session on load
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);
        setCurrentView(userData.role);
      } catch (e) {
        // If stored user is corrupted, clear storage and force login
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    } else if (token || savedUser) {
      // Clear partial or ghost sessions
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }, []);

  const handleLoginSuccess = (userData, role) => {
    const userWithRole = { ...userData, role };
    setUser(userWithRole);
    setCurrentView(role);
    localStorage.setItem('user', JSON.stringify(userWithRole));
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setCurrentView('login');
  };

  return (
    <div className="app-container">
      {currentView === 'login' ? (
        <Login onLoginSuccess={handleLoginSuccess} />
      ) : currentView === 'admin' ? (
        <div style={{ animation: 'fadeIn 0.5s forwards', width: '100%', maxWidth: '1400px', margin: '0 auto' }}>
          <AdminPanel user={user} onLogout={handleLogout} />
        </div>
      ) : (
        <div style={{ animation: 'fadeIn 0.5s forwards' }}>
          <Navbar user={user} onLogout={handleLogout} />
          <div style={{ padding: '20px 0' }}>
            {currentView === 'customer' && <CustomerHome user={user} />}
            {currentView === 'electrician' && <ElectricianHome user={user} />}
          </div>
        </div>
      )}
    </div>
  );
}