import { io } from 'socket.io-client';
import { API_URL } from './config';

// The server now rejects unauthenticated sockets, so every connection must carry the
// same JWT the REST calls use. Reading it at connect time (not at module load) keeps
// a reconnect after re-login from presenting a stale token.
export const createSocket = (token) =>
  io(API_URL, {
    auth: { token: token || localStorage.getItem('token') || '' },
    transports: ['websocket', 'polling']
  });

export default createSocket;
