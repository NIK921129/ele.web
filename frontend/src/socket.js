import { io } from 'socket.io-client';

// Set autoConnect to false so we can manually connect when needed (e.g., after login or booking)
export const socket = io('http://localhost:5000', { autoConnect: false });