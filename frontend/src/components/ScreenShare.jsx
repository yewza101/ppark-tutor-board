import React, { useEffect, useRef, useState } from 'react';
import useAuthStore from '../store/useAuthStore';

const ScreenShare = ({ socket, boardId, isScreenSharing, onScreenShareToggle }) => {
  const [remoteStreams, setRemoteStreams] = useState({});
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const user = useAuthStore(state => state.user);
  
  // We need to keep track of active sockets in the room so we can send offers
  // The simplest way is to rely on 'user-joined-voice' or just broadcast
  // But WebRTC requires targeted offers. We'll use the existing voice socket connections
  // However, screen share can just listen to anyone joining.

  useEffect(() => {
    if (!socket) return;

    if (isScreenSharing && user?.role === 'admin') {
      startScreenShare();
    } else {
      stopScreenShare();
    }

    async function startScreenShare() {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        localStreamRef.current = stream;
        
        // Listen for when the user clicks 'Stop sharing' on the browser's native UI
        stream.getVideoTracks()[0].onended = () => {
          onScreenShareToggle(false);
        };

        socket.emit('screen-started', { boardId, username: user.username });
      } catch (err) {
        console.error("Screen share access denied:", err);
        onScreenShareToggle(false);
      }
    }

    function stopScreenShare() {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
      setRemoteStreams({});
      
      if (user?.role === 'admin') {
        socket.emit('screen-stopped', { boardId });
      }
    }

    // --- Signal Handlers ---
    
    // When a student receives screen-started, they wait for the offer.
    // Or, if the student is already there, the admin needs to know they are there.
    // Let's have students emit a "request-screen" if they join while screen share is active.
    
    const handleScreenStarted = ({ socketId, username }) => {
      // Admin started screen sharing. I am a student. I should send a signal that I am ready.
      socket.emit('request-screen', { targetSocketId: socketId });
    };

    const handleRequestScreen = async ({ callerSocketId }) => {
      // I am Admin. A student wants my screen.
      if (!isScreenSharing || !localStreamRef.current) return;
      
      const pc = createPeerConnection(callerSocketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('screen-offer', {
        targetSocketId: callerSocketId,
        offer
      });
    };

    const handleOffer = async ({ offer, callerSocketId }) => {
      // I am a student, receiving an offer from Admin.
      const pc = createPeerConnection(callerSocketId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('screen-answer', {
        targetSocketId: callerSocketId,
        answer
      });
    };

    const handleAnswer = async ({ answer, callerSocketId }) => {
      // I am Admin, receiving answer from student.
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
          console.error("Error adding ice candidate for screen share", e);
        }
      }
    };

    const handleScreenStopped = () => {
      // Admin stopped screen sharing
      setRemoteStreams({});
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
    };

    socket.on('screen-started', handleScreenStarted);
    socket.on('request-screen', handleRequestScreen);
    socket.on('screen-offer', handleOffer);
    socket.on('screen-answer', handleAnswer);
    socket.on('screen-ice-candidate', handleIceCandidate);
    socket.on('screen-stopped', handleScreenStopped);

    return () => {
      if (socket) {
        socket.off('screen-started', handleScreenStarted);
        socket.off('request-screen', handleRequestScreen);
        socket.off('screen-offer', handleOffer);
        socket.off('screen-answer', handleAnswer);
        socket.off('screen-ice-candidate', handleIceCandidate);
        socket.off('screen-stopped', handleScreenStopped);
      }
    };
  }, [socket, isScreenSharing, boardId, user, onScreenShareToggle]);

  const createPeerConnection = (targetSocketId) => {
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
        socket.emit('screen-ice-candidate', {
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({
        ...prev,
        [targetSocketId]: event.streams[0]
      }));
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        if (peerConnectionsRef.current[targetSocketId]) {
          peerConnectionsRef.current[targetSocketId].close();
          delete peerConnectionsRef.current[targetSocketId];
        }
        setRemoteStreams(prev => {
          const newState = { ...prev };
          delete newState[targetSocketId];
          return newState;
        });
      }
    };

    return pc;
  };

  // Render logic
  // For Admin: we don't render anything here, we just broadcast.
  // For Students: we render the received video stream.
  
  if (user?.role === 'admin' || Object.keys(remoteStreams).length === 0) {
    return null;
  }

  // Find the first available remote stream (Admin's screen)
  const stream = Object.values(remoteStreams)[0];

  return (
    <div className="absolute top-20 left-4 z-40 bg-gray-900 rounded-lg shadow-2xl overflow-hidden border border-gray-700 resize overflow-auto" style={{ width: '400px', height: '250px', minWidth: '200px', minHeight: '150px' }}>
      <div className="bg-gray-800 text-white text-xs p-2 font-bold cursor-move flex justify-between">
        <span>Admin Screen Share</span>
      </div>
      <video
        autoPlay
        playsInline
        ref={(el) => {
          if (el && stream) {
            el.srcObject = stream;
          }
        }}
        className="w-full h-full object-contain bg-black"
      />
    </div>
  );
};

export default ScreenShare;
