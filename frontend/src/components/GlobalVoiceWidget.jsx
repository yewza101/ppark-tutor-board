import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import useAuthStore from '../store/useAuthStore';
import { API_URL } from '../config';
import { useLocation } from 'react-router-dom';

const GlobalVoiceWidget = () => {
  const user = useAuthStore(state => state.user);
  
  const [socket, setSocket] = useState(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [peers, setPeers] = useState({}); // { socketId: { username, stream, isMuted } }
  const [showParticipants, setShowParticipants] = useState(false);
  const [widgetPos, setWidgetPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 70 : 300, y: 80 });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isReadonly = searchParams.get('readonly') === 'true';
  let currentGroup = searchParams.get('group');
  if (!currentGroup && location.pathname.startsWith('/monitor/')) {
    currentGroup = location.pathname.split('/monitor/')[1];
  }
  const voiceRoomId = currentGroup ? `voice_group_${currentGroup}` : 'voice_global';
  const activeVoiceRoomIdRef = useRef(voiceRoomId);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});

  useEffect(() => {
    const handleResize = () => {
      setWidgetPos(prev => ({
        x: Math.min(prev.x, window.innerWidth - 70),
        y: Math.min(prev.y, window.innerHeight - 200)
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!user) return;
    const newSocket = io(API_URL);
    setSocket(newSocket);
    // Initial join
    newSocket.emit('join-board', { boardId: voiceRoomId, role: user.role });
    return () => newSocket.disconnect();
  }, [user]);

  // Handle room changes dynamically
  useEffect(() => {
    if (!socket || !user) return;
    
    if (activeVoiceRoomIdRef.current !== voiceRoomId) {
      if (isVoiceEnabled) {
         socket.emit('leave-voice', { boardId: activeVoiceRoomIdRef.current });
      }
      socket.emit('join-board', { boardId: voiceRoomId, role: user.role });
      
      // Clear peers from old room
      setPeers({});
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
      
      if (isVoiceEnabled && localStreamRef.current) {
         socket.emit('join-voice', { boardId: voiceRoomId, username: user?.username || 'Unknown' });
      }
      activeVoiceRoomIdRef.current = voiceRoomId;
    }
  }, [voiceRoomId, socket, isVoiceEnabled, user]);

  useEffect(() => {
    if (!socket || !isVoiceEnabled) return;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
    socket.emit('mic-status-changed', { boardId: voiceRoomId, isMuted });
  }, [isMuted, socket, isVoiceEnabled, voiceRoomId]);

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
        socket.emit('join-voice', { boardId: voiceRoomId, username: user?.username || 'Unknown' });
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Cannot access microphone. Please check permissions.");
        setIsVoiceEnabled(false);
      }
    };

    startVoice();

    const handleUserJoined = async ({ socketId, username }) => {
      setPeers(prev => ({
        ...prev,
        [socketId]: { ...prev[socketId], username, isMuted: false }
      }));
      const pc = createPeerConnection(socketId, username);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', {
        targetSocketId: socketId,
        offer,
        callerUsername: user?.username || 'Unknown'
      });
    };

    const processCandidateQueue = async (pc) => {
      if (pc.candidateQueue && pc.candidateQueue.length > 0) {
        for (const candidate of pc.candidateQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("Failed to add queued candidate:", e);
          }
        }
        pc.candidateQueue = [];
      }
    };

    const handleOffer = async ({ offer, callerSocketId, callerUsername }) => {
      const pc = createPeerConnection(callerSocketId, callerUsername);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await processCandidateQueue(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', {
          targetSocketId: callerSocketId,
          answer
        });
      } catch (err) {
        console.error("Error handling offer:", err);
      }
    };

    const handleAnswer = async ({ answer, callerSocketId }) => {
      const pc = peerConnectionsRef.current[callerSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await processCandidateQueue(pc);
        } catch (err) {
          console.error("Error handling answer:", err);
        }
      }
    };

    const handleIceCandidate = async ({ candidate, callerSocketId }) => {
      const pc = peerConnectionsRef.current[callerSocketId];
      if (pc && candidate) {
        try {
          // If remote description isn't set yet, the browser might throw an error.
          // In newer browsers, addIceCandidate queues it automatically, but we'll use a try/catch to be safe.
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Error adding ice candidate, queuing it manually:", e);
          if (!pc.candidateQueue) pc.candidateQueue = [];
          pc.candidateQueue.push(candidate);
        }
      }
    };

    const handleUserLeft = ({ socketId }) => {
      removePeer(socketId);
    };

    const handleMicStatus = ({ socketId, isMuted }) => {
      setPeers(prev => {
        if (!prev[socketId]) return prev;
        return { ...prev, [socketId]: { ...prev[socketId], isMuted } };
      });
    };

    const handleAdminMute = () => {
      setIsMuted(true);
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
  }, [socket, isVoiceEnabled]);

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
      setPeers(prev => ({
        ...prev,
        [targetSocketId]: { ...prev[targetSocketId], stream: event.streams[0] }
      }));
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
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
      return newPeers;
    });
  };

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    setPeers({});
    if (socket && isVoiceEnabled) {
      socket.emit('leave-voice', { boardId: activeVoiceRoomIdRef.current });
    }
  };

  const muteStudent = (socketId) => {
    if (user?.role === 'admin' && socket) {
      socket.emit('admin-mute-user', { targetSocketId: socketId });
    }
  };

  if (!user || isReadonly) return null;

  return (
    <>
      <div style={{ display: 'none' }}>
        {Object.entries(peers).map(([socketId, peer]) => (
          peer.stream && (
            <audio 
              key={socketId}
              autoPlay 
              ref={audio => { if (audio && audio.srcObject !== peer.stream) audio.srcObject = peer.stream; }}
            />
          )
        ))}
      </div>

      {showParticipants && user?.role === 'admin' && (
        <div className="fixed top-20 right-20 w-72 bg-white rounded-xl shadow-2xl overflow-hidden z-[9999] border border-gray-100">
          <div className="bg-indigo-600 text-white p-4 font-bold flex justify-between items-center">
            <span>Participants ({Object.keys(peers).length + (isVoiceEnabled ? 1 : 0)})</span>
            <button onClick={() => setShowParticipants(false)} className="hover:text-indigo-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {isVoiceEnabled && (
              <div className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <span className="font-medium text-gray-800">{user?.username} (You)</span>
                <span className={isMuted ? 'text-red-500 text-xs font-bold' : 'text-green-500 text-xs font-bold'}>
                  {isMuted ? 'MUTED' : 'LIVE'}
                </span>
              </div>
            )}
            {Object.entries(peers).map(([socketId, peer]) => (
              <div key={socketId} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <span className="font-medium text-gray-800">{peer.username}</span>
                <div className="flex items-center gap-2">
                  <span className={peer.isMuted ? 'text-red-500 text-xs font-bold' : 'text-green-500 text-xs font-bold'}>
                    {peer.isMuted ? 'MUTED' : 'LIVE'}
                  </span>
                  {!peer.isMuted && (
                    <button onClick={() => muteStudent(socketId)} className="p-1 text-red-500 hover:bg-red-100 rounded" title="Mute Student">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {Object.keys(peers).length === 0 && !isVoiceEnabled && (
              <div className="text-center text-gray-500 p-4">No one is in Voice Chat</div>
            )}
          </div>
        </div>
      )}

      {/* Voice Controls Widget */}
      <div 
        className="fixed z-[9998] flex flex-col items-center gap-3 bg-white/90 backdrop-blur p-2 rounded-2xl shadow-xl border border-gray-200 cursor-move"
        style={{ left: `${widgetPos.x}px`, top: `${widgetPos.y}px`, touchAction: 'none' }}
        onPointerDown={(e) => {
            dragRef.current = { isDragging: true, startX: e.clientX, startY: e.clientY, origX: widgetPos.x, origY: widgetPos.y };
            e.target.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
            if (dragRef.current.isDragging) {
                setWidgetPos({
                    x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
                    y: dragRef.current.origY + (e.clientY - dragRef.current.startY)
                });
            }
        }}
        onPointerUp={(e) => {
            dragRef.current.isDragging = false;
            e.target.releasePointerCapture(e.pointerId);
        }}
      >
        {user?.role === 'admin' && (
          <>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 px-1">Global Voice</div>
            <button
              onClick={() => setShowParticipants(!showParticipants)}
              className={`relative flex items-center justify-center w-10 h-10 rounded-full transition-all ${showParticipants ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              title="Voice Participants"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
              <span className="absolute -top-1 -right-1 bg-indigo-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {Object.keys(peers).length + (isVoiceEnabled ? 1 : 0)}
              </span>
            </button>
            <div className="w-8 h-px bg-gray-200 my-1" />
          </>
        )}

        {!isVoiceEnabled ? (
          <button
            onClick={() => setIsVoiceEnabled(true)}
            className="flex items-center justify-center px-4 h-10 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-all"
            title="Join Global Voice"
          >
            Join Voice
          </button>
        ) : (
          <>
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`flex items-center justify-center w-10 h-10 rounded-full shadow-md transition-all ${
                isMuted ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'
              }`}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                setIsVoiceEnabled(false);
                setIsMuted(false);
              }}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-md transition-all"
              title="Leave Voice"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            </button>
          </>
        )}
      </div>
    </>
  );
};

export default GlobalVoiceWidget;
