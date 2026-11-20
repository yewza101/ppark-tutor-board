// The Railway backend is gone; the backend runs on Render again. VITE_API_URL (set in
// Vercel) still wins, so this fallback only matters when that variable is missing.
export const API_URL = import.meta.env.VITE_API_URL || 'https://ppark-backend.onrender.com';
