import axios from 'axios';
import { API_URL } from './config';

// Attach the auth token to every request to our own API, once, instead of at each
// call site. /api/upload started requiring a token and two of its three callers
// were left without one, which broke image upload and PDF import; a per-call
// header is a rule you have to remember every time, this one you cannot forget.
//
// Scoped to API_URL so the token is never sent to a third party.
axios.interceptors.request.use((config) => {
  const url = config.url || '';
  const ours = url.startsWith(API_URL) || url.startsWith('/');
  if (!ours) return config;

  // Respect a header the caller set explicitly.
  if (config.headers?.Authorization) return config;

  const token = localStorage.getItem('token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default axios;
