import React, { useEffect, useRef, useState } from 'react';
import useAuthStore from '../store/useAuthStore';

const VoiceChat = ({ socket, boardId, isVoiceEnabled, onVoiceToggle, isMuted, setIsMuted, onPeersUpdate }) => {
  const [peers, setPeers] = useState({}); // { socketId: { username, stream, isMuted } }
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // { socketId: RTCPeerConnection }
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (!socket || !isVoiceEnabled) return;
    
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
    socket.emit('mic-status-changed', { boardId, isMuted });
  }, [isMuted, socket, isVoiceEnabled, boardId]);

  useEffect(() => {
    if (!socket || !isVoiceEnabled) {
      cleanup();
      return;
    }

    const startVoice = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        
        socket.emit('join-voice', { boardId, username: user?.username || 'Unknown' });
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Cannot access microphone. Please check permissions.");
        onVoiceToggle(false);
      }
    };

    startVoice();

    // Handlers
    const handleUserJoined = async ({ socketId, username }) => {
      console.log(`User joined voice: ${username} (${socketId})`);
      setPeers(prev => {
        const newPeers = { ...prev, [socketId]: { ...prev[socketId], username, isMuted: false } };
        if (onPeersUpdate) onPeersUpdate(newPeers);
        return newPeers;
      });
      const pc = createPeerConnection(socketId, username);
      
      // We are the caller (the one who was already here)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc-offer', {
        targetSocketId: socketId,
        offer,
        callerUsername: user?.username || 'Unknown'
      });
    };

    const handleOffer = async ({ offer, callerSocketId, callerUsername }) => {
      console.log(`Received offer from ${callerUsername} (${callerSocketId})`);
      const pc = createPeerConnection(callerSocketId, callerUsername);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('webrtc-answer', {
        targetSocketId: callerSocketId,
        answer
      });
    };

    const handleAnswer = async ({ answer, callerSocketId }) => {
      const pc = peerConnectionsRef.current[callerSocketId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = async ({ candidate, callerSocketId }) => {
      const pc = peerConnectionsRef.current[callerSocketId];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding ice candidate", e);
        }
      }
    };

    const handleUserLeft = ({ socketId }) => {
      removePeer(socketId);
    };

    const handleMicStatus = ({ socketId, isMuted }) => {
      setPeers(prev => {
        if (!prev[socketId]) return prev;
        const newPeers = { ...prev, [socketId]: { ...prev[socketId], isMuted } };
        if (onPeersUpdate) onPeersUpdate(newPeers);
        return newPeers;
      });
    };

    const handleAdminMute = () => {
      if (setIsMuted) setIsMuted(true);
    };

    socket.on('user-joined-voice', handleUserJoined);
    socket.on('webrtc-offer', handleOffer);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);
    socket.on('user-left-voice', handleUserLeft);
    socket.on('mic-status-changed', handleMicStatus);
    socket.on('admin-mute-user', handleAdminMute);

    return () => {
      cleanup();
      if (socket) {
        socket.off('user-joined-voice', handleUserJoined);
        socket.off('webrtc-offer', handleOffer);
        socket.off('webrtc-answer', handleAnswer);
        socket.off('webrtc-ice-candidate', handleIceCandidate);
        socket.off('user-left-voice', handleUserLeft);
        socket.off('mic-status-changed', handleMicStatus);
        socket.off('admin-mute-user', handleAdminMute);
      }
    };
  }, [socket, isVoiceEnabled, boardId, user]); // Removed isMuted to prevent reconnects

  const createPeerConnection = (targetSocketId, username) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    peerConnectionsRef.current[targetSocketId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      setPeers(prev => {
        const newPeers = {
          ...prev,
          [targetSocketId]: {
            ...prev[targetSocketId],
            username,
            stream: event.streams[0]
          }
        };
        if (onPeersUpdate) onPeersUpdate(newPeers);
        return newPeers;
      });
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        removePeer(targetSocketId);
      }
    };

    return pc;
  };

  const removePeer = (socketId) => {
    if (peerConnectionsRef.current[socketId]) {
      peerConnectionsRef.current[socketId].close();
      delete peerConnectionsRef.current[socketId];
    }
    setPeers(prev => {
      const newPeers = { ...prev };
      delete newPeers[socketId];
      if (onPeersUpdate) onPeersUpdate(newPeers);
      return newPeers;
    });
  };

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.keys(peerConnectionsRef.current).forEach(socketId => {
      removePeer(socketId);
    });
    setPeers({});
    if (onPeersUpdate) onPeersUpdate({});
    if (socket && isVoiceEnabled) {
       socket.emit('leave-voice', { boardId });
    }
  };

  return (
    <div style={{ display: 'none' }}>
      {Object.entries(peers).map(([socketId, peer]) => (
        <AudioStream key={socketId} stream={peer.stream} />
      ))}
    </div>
  );
};

const AudioStream = ({ stream }) => {
  const audioRef = useRef(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
};

export default VoiceChat;
