import { create } from 'zustand';
import { io } from 'socket.io-client';
import { API_URL } from '../config';

const useSocketStore = create((set, get) => ({
  socket: null,
  connect: () => {
    if (!get().socket) {
      const newSocket = io(API_URL);
      set({ socket: newSocket });
      return newSocket;
    }
    return get().socket;
  },
  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null });
    }
  }
}));

export default useSocketStore;
