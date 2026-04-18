import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const _envUrl = import.meta.env.VITE_API_URL;
const BASE_URL = _envUrl || (
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'))
    ? `http://${window.location.hostname}:5000`
    : 'https://wattzen-backend.onrender.com' // Always fallback to HTTPS in production
);

const socketInstance = io(BASE_URL, {
  autoConnect: false, // We will connect manually when a user is logged in.
  reconnectionAttempts: 5,
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