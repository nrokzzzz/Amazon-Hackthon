import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL,
  // If baseURL ever points at an ngrok tunnel, this skips ngrok's free-tier
  // browser-warning interstitial (ERR_NGROK_6024) so API calls return JSON.
  headers: { 'ngrok-skip-browser-warning': 'true' },
});

// Attach the JWT (stored in localStorage) to every request.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('cf_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export function setToken(token) {
  if (token) localStorage.setItem('cf_token', token);
  else localStorage.removeItem('cf_token');
}

export function getToken() {
  return localStorage.getItem('cf_token');
}
