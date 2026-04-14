import { io } from 'socket.io-client';

// Use environment variable for the backend URL, with localhost as fallback for local dev
export const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000', { autoConnect: false });