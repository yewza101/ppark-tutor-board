import { create } from 'zustand';

// A malformed 'user' entry (truncated write, manual edit, old schema) used to throw
// at module load and leave the whole app on a blank screen with no way back.
const readUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return null;
  }
};

// Tokens expire after 24h; keeping an expired one just turns every request into a 401.
const isExpired = (token) => {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]));
    return typeof exp === 'number' && exp * 1000 <= Date.now();
  } catch {
    return true;
  }
};

const readToken = () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  if (isExpired(token)) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return null;
  }
  return token;
};

const initialToken = readToken();

const useAuthStore = create((set) => ({
  user: initialToken ? readUser() : null,
  token: initialToken,

  login: (userData, token) => {
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', token);
    set({ user: userData, token });
  },

  logout: () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
