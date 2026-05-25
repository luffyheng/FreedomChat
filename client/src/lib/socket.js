import { io } from 'socket.io-client';

// In production, connect to the Railway backend URL.
// In local dev, connect to the same origin (Vite proxies /socket.io).
const serverUrl = import.meta.env.VITE_API_URL || '/';

export const socket = io(serverUrl, {
  autoConnect: true,
  withCredentials: true,
});
