import React, { useEffect, useRef, useState } from 'react';
import useAuthStore from '../store/useAuthStore';

const ScreenShare = ({ socket, boardId, isScreenSharing, isLocalScreenShare, onScreenShareToggle }) => {
  const [remoteStreams, setRemoteStreams] = useState({});
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const user = useAuthStore(state => state.user);
  
  // Draggable state
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [isMinimized, setIsMinimized] = useState(false);
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const onDragStart = (e) => {
    dragRef.current.isDragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.origX = position.x;
    dragRef.current.origY = position.y;
    e.target.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy
    });
  };

  const onDragEnd = (e) => {
    dragRef.current.isDragging = false;
    e.target.releasePointerCapture(e.pointerId);
  };
  
  // We need to keep track of active sockets in the room so we can send offers
  // The simplest way is to rely on 'user-joined-voice' or just broadcast
  // But WebRTC requires targeted offers. We'll use the existing voice socket connections
  // However, screen share can just listen to anyone joining.

  useEffect(() => {
    if (!socket) return;

    if (isScreenSharing && isLocalScreenShare) {
      startScreenShare();
    } else if (isScreenSharing && !isLocalScreenShare) {
      // Students wait for the stream or request it
      // ONLY request if we don't have peer connections already setup
      if (Object.keys(peerConnectionsRef.current).length === 0) {
        socket.emit('request-screen', { boardId });
      }
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
      
      if (isLocalScreenShare) {
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
  }, [socket, isScreenSharing, boardId, isLocalScreenShare]); // Removed onScreenShareToggle to prevent infinite re-renders

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

  // Find the first available remote stream (Admin's screen)
  const stream = Object.values(remoteStreams)[0];
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
          playPromise.catch(err => {
             // Auto-play was prevented or already playing, ignore
          });
      }
    }
  });

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    
    // Fallback for iOS Safari which doesn't support generic Fullscreen API
    if (videoRef.current.webkitEnterFullscreen) {
      videoRef.current.webkitEnterFullscreen();
      return;
    }
    
    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Render logic
  // For Admin: we don't render anything here, we just broadcast.
  // For Students: we render the received video stream.
  
  if (isLocalScreenShare || Object.keys(remoteStreams).length === 0) {
    return null;
  }

  return (
    <div 
      className="absolute z-40 bg-gray-900 rounded-lg shadow-2xl overflow-hidden border border-gray-700 resize flex flex-col" 
      style={{ 
        left: position.x, 
        top: position.y, 
        width: isMinimized ? '200px' : '400px', 
        height: isMinimized ? 'auto' : '250px', 
        minWidth: '200px', 
        minHeight: isMinimized ? 'auto' : '150px' 
      }}
    >
      <div 
        className="bg-gray-800 text-white text-xs p-2 font-bold cursor-move flex justify-between items-center shrink-0 touch-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span>Admin Screen Share</span>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-gray-300 hover:text-white px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
            title={isMinimized ? "Expand" : "Minimize"}
          >
            {isMinimized ? '+' : '-'}
          </button>
          {!isMinimized && (
            <button 
          onClick={toggleFullscreen}
          className="text-gray-300 hover:text-white px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          title="Full Screen"
              onClick={toggleFullscreen}
              className="text-gray-300 hover:text-white px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
              title="Full Screen"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {!isMinimized && (
        <div className="flex-1 w-full bg-black relative">
          <video
            autoPlay
            playsInline
            ref={videoRef}
            onClick={toggleFullscreen}
            className="absolute inset-0 w-full h-full object-contain cursor-pointer"
          />
        </div>
      )}
    </div>
  );
};

export default ScreenShare;
