import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const BASE_URL = 'https://wattzen-backend.onrender.com';

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