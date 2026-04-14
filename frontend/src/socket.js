import { io } from 'socket.io-client';

// Use environment variable for the backend URL, with localhost as fallback for local dev
const baseURL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
export const socket = io(baseURL.replace(/\/$/, ''), { autoConnect: false });