import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Mic, MicOff, PhoneOff, Users, GripVertical } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { API_URL } from '../config';
import { useLocation } from 'react-router-dom';

const safeSetPointerCapture = (target, pointerId) => {
  try {
    if (target && target.setPointerCapture) {
      target.setPointerCapture(pointerId);
    }
  } catch (err) {}
};

const GlobalVoiceWidget = () => {
  const user = useAuthStore(state => state.user);
  
  const [socket, setSocket] = useState(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [peers, setPeers] = useState({}); // { socketId: { username, stream, isMuted } }
  const [showParticipants, setShowParticipants] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0); // 0 to 100
  const [widgetPos, setWidgetPos] = useState({ 
    x: typeof window !== 'undefined' ? Math.max(16, window.innerWidth - 260) : 300, 
    y: 80 
  });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isReadonly = searchParams.get('readonly') === 'true';
  let currentGroup = searchParams.get('group');
  if (!currentGroup && location.pathname.startsWith('/monitor/')) {
    currentGroup = location.pathname.split('/monitor/')[1];
  } else if (!currentGroup && location.pathname.startsWith('/board/teacher_board_')) {
    currentGroup = location.pathname.split('/board/teacher_board_')[1];
  } else if (!currentGroup && user?.role !== 'admin' && user?.group_name) {
    currentGroup = user.group_name;
  }
  
  const voiceRoomId = currentGroup ? `voice_group_${currentGroup}` : (user?.role === 'admin' ? `voice_teacher_${user.username}` : 'voice_global');
  const activeVoiceRoomIdRef = useRef(voiceRoomId);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});

  useEffect(() => {
    const handleResize = () => {
      setWidgetPos(prev => ({
        x: Math.min(prev.x, window.innerWidth - 260),
        y: Math.min(prev.y, window.innerHeight - 100)
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!user) return;
    const newSocket = io(API_URL);
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
        newSocket.emit('join-board', { boardId: voiceRoomId, role: user.role });
    });
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
    if (isMuted) setVolumeLevel(0);
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
        setupAudioMeter(stream);
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

  const setupAudioMeter = (stream) => {
    try {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 90) * 100));
        setVolumeLevel(normalized);

        animFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (err) {
      console.warn('Audio metering error:', err);
    }
  };

  const cleanup = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
        }
      } catch (e) {}
      audioContextRef.current = null;
    }
    setVolumeLevel(0);

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
        <div className="fixed top-20 right-20 w-72 bg-white rounded-2xl shadow-2xl overflow-hidden z-[9999] border border-gray-100">
          <div className="bg-indigo-600 text-white p-4 font-bold flex justify-between items-center">
            <span>ผู้เข้าร่วมสนทนา ({Object.keys(peers).length + (isVoiceEnabled ? 1 : 0)})</span>
            <button onClick={() => setShowParticipants(false)} className="hover:text-indigo-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {isVoiceEnabled && (
              <div className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <span className="font-medium text-gray-800">{user?.username} (คุณ)</span>
                <span className={isMuted ? 'text-rose-600 text-xs font-bold' : 'text-emerald-600 text-xs font-bold'}>
                  {isMuted ? '🔴 ปิดไมค์' : '🟢 เปิดไมค์'}
                </span>
              </div>
            )}
            {Object.entries(peers).map(([socketId, peer]) => (
              <div key={socketId} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg">
                <span className="font-medium text-gray-800">{peer.username}</span>
                <div className="flex items-center gap-2">
                  <span className={peer.isMuted ? 'text-rose-600 text-xs font-bold' : 'text-emerald-600 text-xs font-bold'}>
                    {peer.isMuted ? '🔴 ปิดไมค์' : '🟢 เปิดไมค์'}
                  </span>
                  {!peer.isMuted && (
                    <button onClick={() => muteStudent(socketId)} className="p-1.5 text-rose-500 hover:bg-rose-100 rounded-lg transition-colors" title="สั่งปิดไมค์นักเรียน">
                      <MicOff size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {Object.keys(peers).length === 0 && !isVoiceEnabled && (
              <div className="text-center text-gray-500 p-4 text-sm">ยังไม่มีใครอยู่ในห้องเสียง</div>
            )}
          </div>
        </div>
      )}

      {/* Voice Controls Widget */}
      <div 
        className="fixed z-[9998] flex items-center bg-white/95 backdrop-blur-md px-3 py-2 rounded-2xl shadow-xl border border-gray-200 select-none cursor-move transition-all"
        style={{ left: `${widgetPos.x}px`, top: `${widgetPos.y}px`, touchAction: 'none' }}
        onPointerDown={(e) => {
            dragRef.current = { isDragging: true, startX: e.clientX, startY: e.clientY, origX: widgetPos.x, origY: widgetPos.y };
            safeSetPointerCapture(e.target, e.pointerId);
        }}
        onPointerMove={(e) => {
            if (dragRef.current.isDragging) {
                setWidgetPos({
                    x: Math.max(10, Math.min(window.innerWidth - 270, dragRef.current.origX + (e.clientX - dragRef.current.startX))),
                    y: Math.max(10, Math.min(window.innerHeight - 80, dragRef.current.origY + (e.clientY - dragRef.current.startY)))
                });
            }
        }}
        onPointerUp={(e) => {
            dragRef.current.isDragging = false;
            try { if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId); } catch(err) {}
        }}
      >
        {/* Drag Handle */}
        <div className="pl-1 pr-1.5 py-2 text-gray-300 hover:text-gray-500 cursor-grab flex items-center" title="ลากเพื่อย้ายตำแหน่ง">
          <GripVertical size={16} />
        </div>

        {user?.role === 'admin' && (
          <div className="flex items-center">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowParticipants(!showParticipants)}
              className={`relative p-2 rounded-xl transition-all ${showParticipants ? 'bg-indigo-100 text-indigo-600' : 'text-gray-500 hover:bg-gray-100'}`}
              title="ดูรายชื่อในห้องเสียง"
            >
              <Users size={18} />
              <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {Object.keys(peers).length + (isVoiceEnabled ? 1 : 0)}
              </span>
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2" />
          </div>
        )}

        {!isVoiceEnabled ? (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setIsVoiceEnabled(true)}
            className="flex items-center gap-2.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 active:scale-95 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all text-sm"
            title="แตะเพื่อเปิดไมค์พูดคุย"
          >
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
              <Mic size={16} className="text-white" />
            </div>
            <div className="flex flex-col text-left">
              <span className="leading-tight text-xs font-bold">เปิดไมค์คุย (Join Voice)</span>
              <span className="text-[10px] font-normal text-indigo-100">แตะเพื่อเริ่มคุย</span>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            {/* Mic Toggle Button with dynamic reactive green glow */}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setIsMuted(!isMuted)}
              className={`relative flex items-center justify-center w-11 h-11 rounded-full font-bold shadow-md active:scale-90 transition-all ${
                isMuted
                  ? 'bg-rose-500 hover:bg-rose-600 text-white ring-4 ring-rose-100'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white ring-4 ring-emerald-100'
              }`}
              style={{
                boxShadow: !isMuted && volumeLevel > 5 
                  ? `0 0 0 ${4 + (volumeLevel / 100) * 12}px rgba(34, 197, 94, ${0.3 + (volumeLevel / 100) * 0.4}), 0 0 ${(volumeLevel / 100) * 22}px rgba(34, 197, 94, 0.7)` 
                  : undefined,
                transform: !isMuted && volumeLevel > 5 
                  ? `scale(${1 + Math.min(0.12, (volumeLevel / 100) * 0.12)})` 
                  : undefined,
                transition: 'box-shadow 0.08s ease-out, transform 0.08s ease-out, background-color 0.2s'
              }}
              title={isMuted ? "แตะเพื่อเปิดไมค์" : "แตะเพื่อปิดไมค์"}
            >
              {isMuted ? (
                <MicOff size={22} className="text-white" />
              ) : (
                <Mic size={22} className="text-white" />
              )}
            </button>

            {/* Status Text & Audio Wave */}
            <div 
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setIsMuted(!isMuted)}
              className="flex flex-col justify-center cursor-pointer min-w-[110px]"
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-bold ${isMuted ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {isMuted ? '🔴 ปิดไมค์อยู่' : '🟢 เปิดไมค์อยู่'}
                </span>

                {/* Real-time Green Volume Wave Bars */}
                {!isMuted && (
                  <div className="flex items-end gap-0.5 h-3 ml-0.5">
                    <span 
                      className="w-1 bg-emerald-500 rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(4, Math.min(12, 4 + (volumeLevel / 100) * 8))}px` }}
                    />
                    <span 
                      className="w-1 bg-emerald-500 rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(4, Math.min(14, 4 + (volumeLevel / 100) * 10))}px` }}
                    />
                    <span 
                      className="w-1 bg-emerald-500 rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(4, Math.min(10, 4 + (volumeLevel / 100) * 6))}px` }}
                    />
                  </div>
                )}
              </div>
              
              <span className={`text-[10px] ${isMuted ? 'text-rose-500 font-medium' : (volumeLevel > 8 ? 'text-emerald-600 font-bold animate-pulse' : 'text-gray-400')}`}>
                {isMuted ? 'แตะเพื่อเปิดไมค์' : (volumeLevel > 8 ? 'กำลังพูด (เสียงเข้า)' : 'แตะเพื่อปิดไมค์')}
              </span>
            </div>

            <div className="w-px h-6 bg-gray-200 mx-0.5" />

            {/* Leave Voice Button */}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                setIsVoiceEnabled(false);
                setIsMuted(false);
              }}
              className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              title="ออกจากห้องคุยเสียง (วางสาย)"
            >
              <PhoneOff size={18} />
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default GlobalVoiceWidget;
