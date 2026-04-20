import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// Dynamically connect WebSockets -> Backend
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'));
const BASE_URL = import.meta.env.VITE_API_URL || (isLocal ? `http://${window.location.hostname}:5000` : 'https://voltflow-backend.onrender.com');

const socketInstance = io(BASE_URL, {
  autoConnect: false, // We will connect manually when a user is logged in.
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000, // Socket Jitter to prevent Thundering Herd
  randomizationFactor: 0.5,
  transports: ['websocket', 'polling'], // Fallback for restrictive corporate firewalls/proxies
});

const SocketContext = createContext();

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(socketInstance.connected);

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    socketInstance.on('connect', onConnect);
    socketInstance.on('disconnect', onDisconnect);

    return () => {
      socketInstance.off('connect', onConnect);
      socketInstance.off('disconnect', onDisconnect);
    };
  }, []);

  const value = { socket: socketInstance, isConnected };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}