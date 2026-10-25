import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Mic, MicOff, PhoneOff, Users, GripVertical, ChevronDown } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { API_URL } from '../config';
import { useLocation } from 'react-router-dom';
import axios from 'axios';

const safeSetPointerCapture = (target, pointerId) => {
  try {
    if (target && target.setPointerCapture) {
      target.setPointerCapture(pointerId);
    }
  } catch (err) {}
};

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

const GlobalVoiceWidget = () => {
  const { user, token } = useAuthStore();
  
  const [socket, setSocket] = useState(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [peers, setPeers] = useState({}); // { socketId: { username, stream, isMuted } }
  const [showParticipants, setShowParticipants] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0); // 0 to 100
  const [widgetPos, setWidgetPos] = useState({ 
    x: typeof window !== 'undefined' ? Math.max(16, window.innerWidth - 300) : 300, 
    y: 80 
  });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isReadonly = searchParams.get('readonly') === 'true';

  // Room & Group Management
  const [availableGroups, setAvailableGroups] = useState(['General']);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [activeGroup, setActiveGroup] = useState(() => {
    if (user?.role !== 'admin' && user?.group_name) return user.group_name;
    return localStorage.getItem('ppark_active_voice_group') || 'General';
  });

  // Fetch available groups for teacher dropdown
  useEffect(() => {
    if (user?.role !== 'admin' || !token) return;
    axios.get(`${API_URL}/api/admin/students`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (res.data && Array.isArray(res.data)) {
          const grps = Array.from(new Set(res.data.map(s => s.group_name || 'General'))).filter(Boolean);
          if (grps.length > 0) setAvailableGroups(grps);
        }
      })
      .catch(() => {});
  }, [user, token]);

  // Dynamically detect active group from route / state / params
  useEffect(() => {
    if (user?.role !== 'admin') {
      setActiveGroup(user?.group_name || 'General');
      return;
    }

    const queryGroup = searchParams.get('group');
    const stateGroup = location.state?.returnToGroup || location.state?.studentGroup;
    let detectedGroup = queryGroup || stateGroup;

    if (!detectedGroup) {
      if (location.pathname.startsWith('/monitor/')) {
        detectedGroup = decodeURIComponent(location.pathname.replace('/monitor/', ''));
      } else if (location.pathname.startsWith('/board/teacher_board_')) {
        detectedGroup = decodeURIComponent(location.pathname.replace('/board/teacher_board_', ''));
      } else if (location.pathname === '/board/teacher_board') {
        detectedGroup = 'General';
      }
    }

    if (detectedGroup && detectedGroup !== activeGroup) {
      setActiveGroup(detectedGroup);
      localStorage.setItem('ppark_active_voice_group', detectedGroup);
    }
  }, [location, user]);

  const voiceRoomId = `voice_group_${activeGroup}`;
  const activeVoiceRoomIdRef = useRef(voiceRoomId);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const pendingCandidatesRef = useRef({});

  // Responsive boundary check for draggable widget
  useEffect(() => {
    const handleResize = () => {
      setWidgetPos(prev => ({
        x: Math.min(prev.x, window.innerWidth - 300),
        y: Math.min(prev.y, window.innerHeight - 100)
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize Socket connection
  useEffect(() => {
    if (!user) return;
    const newSocket = io(API_URL);
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
      newSocket.emit('join-board', { boardId: voiceRoomId, role: user.role });
    });
    return () => newSocket.disconnect();
  }, [user]);

  // Handle Voice Room switches
  useEffect(() => {
    if (!socket || !user) return;
    
    if (activeVoiceRoomIdRef.current !== voiceRoomId) {
      if (isVoiceEnabled) {
        socket.emit('leave-voice', { boardId: activeVoiceRoomIdRef.current });
      }
      socket.emit('join-board', { boardId: voiceRoomId, role: user.role });
      
      // Clean up previous room peer connections
      setPeers({});
      Object.values(peerConnectionsRef.current).forEach(pc => {
        try { pc.close(); } catch (e) {}
      });
      peerConnectionsRef.current = {};
      pendingCandidatesRef.current = {};
      
      if (isVoiceEnabled && localStreamRef.current) {
        socket.emit('join-voice', { boardId: voiceRoomId, username: user?.username || 'Unknown' });
      }
      activeVoiceRoomIdRef.current = voiceRoomId;
    }
  }, [voiceRoomId, socket, isVoiceEnabled, user]);

  // Handle Mute / Unmute state on local audio track
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

  // Helper to drain queued ICE candidates once remote description is set
  const drainPendingCandidates = async (socketId, pc) => {
    const queue = pendingCandidatesRef.current[socketId] || [];
    delete pendingCandidatesRef.current[socketId];
    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('Failed to add queued candidate:', err);
      }
    }
  };

  // Helper to create an RTCPeerConnection with audio tracks attached
  const createPeerConnection = (targetSocketId, targetUsername) => {
    if (peerConnectionsRef.current[targetSocketId]) {
      try {
        peerConnectionsRef.current[targetSocketId].close();
      } catch (e) {}
      delete peerConnectionsRef.current[targetSocketId];
    }

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peerConnectionsRef.current[targetSocketId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-ice-candidate', {
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = (event.streams && event.streams[0]) 
        ? event.streams[0] 
        : new MediaStream([event.track]);
      
      setPeers(prev => ({
        ...prev,
        [targetSocketId]: { 
          ...prev[targetSocketId], 
          username: targetUsername || prev[targetSocketId]?.username || 'User',
          stream: remoteStream 
        }
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
      try {
        peerConnectionsRef.current[socketId].close();
      } catch (e) {}
      delete peerConnectionsRef.current[socketId];
    }
    delete pendingCandidatesRef.current[socketId];
    setPeers(prev => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  };

  // WebRTC Signaling lifecycle
  useEffect(() => {
    if (!socket || !isVoiceEnabled) {
      cleanup();
      return;
    }

    const startVoice = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
        setupAudioMeter(stream);
        
        socket.emit('join-voice', { boardId: voiceRoomId, username: user?.username || 'Unknown' });
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณาอนุญาตสิทธิ์ Microphone ในการตั้งค่าเบราว์เซอร์");
        setIsVoiceEnabled(false);
      }
    };

    startVoice();

    // 1. Existing voice users in room (sent by server to new joiner)
    const handleExistingUsers = async (existingUsers) => {
      for (const u of existingUsers) {
        setPeers(prev => ({
          ...prev,
          [u.socketId]: { ...prev[u.socketId], username: u.username, isMuted: u.isMuted }
        }));
        
        // Initiate call to existing user
        try {
          const pc = createPeerConnection(u.socketId, u.username);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc-offer', {
            targetSocketId: u.socketId,
            offer,
            callerUsername: user?.username || 'Unknown'
          });
        } catch (e) {
          console.error("Error creating offer to existing user:", e);
        }
      }
    };

    // 2. Someone else joined the voice room (existing user receives this)
    const handleUserJoined = ({ socketId, username }) => {
      setPeers(prev => ({
        ...prev,
        [socketId]: { ...prev[socketId], username, isMuted: false }
      }));
      // New joiner will receive existing-voice-users and send offer to us
    };

    // 3. Incoming WebRTC Offer
    const handleOffer = async ({ offer, callerSocketId, callerUsername }) => {
      const pc = createPeerConnection(callerSocketId, callerUsername);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainPendingCandidates(callerSocketId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', {
          targetSocketId: callerSocketId,
          answer
        });
      } catch (err) {
        console.error("Error handling WebRTC offer:", err);
      }
    };

    // 4. Incoming WebRTC Answer
    const handleAnswer = async ({ answer, callerSocketId }) => {
      const pc = peerConnectionsRef.current[callerSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await drainPendingCandidates(callerSocketId, pc);
        } catch (err) {
          console.error("Error handling WebRTC answer:", err);
        }
      }
    };

    // 5. Incoming ICE Candidate
    const handleIceCandidate = async ({ candidate, callerSocketId }) => {
      if (!candidate) return;
      const pc = peerConnectionsRef.current[callerSocketId];
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Failed to add ICE candidate:", e);
        }
      } else {
        if (!pendingCandidatesRef.current[callerSocketId]) {
          pendingCandidatesRef.current[callerSocketId] = [];
        }
        pendingCandidatesRef.current[callerSocketId].push(candidate);
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

    socket.on('existing-voice-users', handleExistingUsers);
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
        socket.off('existing-voice-users', handleExistingUsers);
        socket.off('user-joined-voice', handleUserJoined);
        socket.off('webrtc-offer', handleOffer);
        socket.off('webrtc-answer', handleAnswer);
        socket.off('webrtc-ice-candidate', handleIceCandidate);
        socket.off('user-left-voice', handleUserLeft);
        socket.off('mic-status-changed', handleMicStatus);
        socket.off('admin-mute-user', handleAdminMute);
      }
    };
  }, [socket, isVoiceEnabled, voiceRoomId]);

  // Audio meter for real-time green sound volume bars
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
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 80) * 100));
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
    Object.values(peerConnectionsRef.current).forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    peerConnectionsRef.current = {};
    pendingCandidatesRef.current = {};
    setPeers({});
    
    if (socket) {
      socket.emit('leave-voice', { boardId: activeVoiceRoomIdRef.current });
    }
  };

  // Immediate user click handler to unlock browser audio context
  const handleToggleVoice = () => {
    if (!isVoiceEnabled) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new AudioContextClass();
          }
          if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().catch(() => {});
          }
        }
      } catch (e) {}
      setIsVoiceEnabled(true);
      setIsMuted(false);
    } else {
      setIsVoiceEnabled(false);
      setIsMuted(false);
    }
  };

  const muteStudent = (socketId) => {
    if (user?.role === 'admin' && socket) {
      socket.emit('admin-mute-user', { targetSocketId: socketId });
    }
  };

  // Dragging logic
  const handlePointerDown = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: widgetPos.x,
      origY: widgetPos.y
    };
    safeSetPointerCapture(e.currentTarget, e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setWidgetPos({
      x: Math.max(8, Math.min(window.innerWidth - 280, dragRef.current.origX + dx)),
      y: Math.max(8, Math.min(window.innerHeight - 80, dragRef.current.origY + dy))
    });
  };

  const handlePointerUp = () => {
    dragRef.current.isDragging = false;
  };

  if (!user || isReadonly) return null;

  const otherPeersCount = Object.keys(peers).length;

  return (
    <>
      {/* Hidden audio elements for remote participants (playsInline + safe positioning, avoiding display:none) */}
      <div style={{ position: 'fixed', top: -10000, left: -10000, width: 1, height: 1, opacity: 0.01, pointerEvents: 'none' }}>
        {Object.entries(peers).map(([socketId, peer]) => (
          peer.stream && (
            <audio 
              key={socketId}
              autoPlay 
              playsInline
              ref={audio => {
                if (audio && audio.srcObject !== peer.stream) {
                  audio.srcObject = peer.stream;
                  const playPromise = audio.play();
                  if (playPromise !== undefined) {
                    playPromise.catch(e => console.warn('Audio playback error:', e));
                  }
                }
              }}
            />
          )
        ))}
      </div>

      {/* Admin Participants Modal */}
      {showParticipants && user?.role === 'admin' && (
        <div className="fixed top-20 right-20 w-80 bg-white rounded-2xl shadow-2xl overflow-hidden z-[9999] border border-gray-100 animate-in fade-in zoom-in duration-150">
          <div className="bg-indigo-600 text-white p-4 font-bold flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Users size={18} />
              <span>ผู้เข้าร่วมห้อง ({otherPeersCount + (isVoiceEnabled ? 1 : 0)})</span>
            </div>
            <button 
              onClick={() => setShowParticipants(false)}
              className="text-white hover:bg-white/20 p-1 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="p-3 max-h-64 overflow-y-auto divide-y divide-gray-100">
            {isVoiceEnabled && (
              <div className="py-2.5 flex items-center justify-between text-sm">
                <span className="font-semibold text-gray-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  {user.username} (คุณ / ครู)
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                  {!isMuted ? 'เปิดไมค์' : 'ปิดไมค์'}
                </span>
              </div>
            )}
            {Object.entries(peers).map(([socketId, peer]) => (
              <div key={socketId} className="py-2.5 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${peer.isMuted ? 'bg-gray-300' : 'bg-emerald-500'}`}></span>
                  {peer.username}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${peer.isMuted ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}>
                    {peer.isMuted ? 'ปิดไมค์' : 'เปิดไมค์'}
                  </span>
                  <button
                    onClick={() => muteStudent(socketId)}
                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="สั่งปิดไมค์นักเรียนคนนี้"
                  >
                    <MicOff size={15} />
                  </button>
                </div>
              </div>
            ))}
            {!isVoiceEnabled && otherPeersCount === 0 && (
              <div className="py-6 text-center text-gray-400 text-sm">
                ยังไม่มีผู้เข้าร่วมในห้องนี้
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Kid-Friendly Voice Widget */}
      <div 
        style={{ left: `${widgetPos.x}px`, top: `${widgetPos.y}px`, touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="fixed z-[9998] flex items-center bg-white/95 backdrop-blur-md px-3 py-2 rounded-2xl shadow-xl border border-gray-200 select-none cursor-move transition-shadow hover:shadow-2xl"
      >
        {/* Drag Handle */}
        <div className="text-gray-300 hover:text-gray-500 mr-2 flex items-center">
          <GripVertical size={16} />
        </div>

        {/* Room / Group Pill */}
        <div className="relative mr-2">
          {user?.role === 'admin' ? (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowGroupDropdown(!showGroupDropdown)}
              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors"
              title="สลับห้องคุยเสียงสำหรับกลุ่มนี้"
            >
              <span>ห้อง: {activeGroup}</span>
              <ChevronDown size={14} />
            </button>
          ) : (
            <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold">
              ห้อง: {activeGroup}
            </span>
          )}

          {/* Admin Group Switcher Dropdown */}
          {showGroupDropdown && user?.role === 'admin' && (
            <div 
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute left-0 top-full mt-1.5 bg-white shadow-xl rounded-xl border border-gray-200 py-1 min-w-[130px] z-50 animate-in fade-in duration-100"
            >
              <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                เลือกห้องพูดคุย
              </div>
              {availableGroups.map(grp => (
                <button
                  key={grp}
                  onClick={() => {
                    setActiveGroup(grp);
                    localStorage.setItem('ppark_active_voice_group', grp);
                    setShowGroupDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-indigo-50 transition-colors ${
                    activeGroup === grp ? 'text-indigo-600 font-bold bg-indigo-50/50' : 'text-gray-700'
                  }`}
                >
                  {grp} {activeGroup === grp && '✓'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Admin Participants Counter */}
        {user?.role === 'admin' && (
          <div className="flex items-center">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowParticipants(!showParticipants)}
              className="relative p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors flex items-center gap-1"
              title="ดูรายชื่อผู้เข้าร่วมในห้อง"
            >
              <Users size={18} />
              <span className="text-xs font-bold text-gray-700">
                {otherPeersCount + (isVoiceEnabled ? 1 : 0)}
              </span>
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2" />
          </div>
        )}

        {/* Main Mic Button & Controls */}
        {!isVoiceEnabled ? (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleToggleVoice}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 active:scale-95 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all text-xs"
            title="แตะเพื่อเปิดไมค์พูดคุย"
          >
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <Mic size={14} className="text-white" />
            </div>
            <div className="flex flex-col text-left">
              <span className="leading-tight text-xs font-bold">เปิดไมค์คุย (Join Voice)</span>
              <span className="text-[10px] font-normal text-indigo-100">
                {otherPeersCount > 0 ? `มีเพื่อนอยู่ในห้อง ${otherPeersCount} คน` : 'แตะเพื่อเริ่มคุย'}
              </span>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {/* Mic Toggle Button with dynamic reactive green glow */}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setIsMuted(!isMuted)}
              className={`relative flex items-center justify-center w-10 h-10 rounded-full font-bold shadow-md active:scale-90 transition-all ${
                isMuted
                  ? 'bg-rose-500 hover:bg-rose-600 text-white ring-4 ring-rose-100'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white ring-4 ring-emerald-100'
              }`}
              style={{
                boxShadow: !isMuted && volumeLevel > 5 
                  ? `0 0 0 ${3 + (volumeLevel / 100) * 10}px rgba(34, 197, 94, ${0.3 + (volumeLevel / 100) * 0.4}), 0 0 ${(volumeLevel / 100) * 20}px rgba(34, 197, 94, 0.7)` 
                  : undefined,
                transform: !isMuted && volumeLevel > 5 
                  ? `scale(${1 + Math.min(0.1, (volumeLevel / 100) * 0.1)})` 
                  : undefined,
                transition: 'box-shadow 0.08s ease-out, transform 0.08s ease-out, background-color 0.2s'
              }}
              title={isMuted ? "แตะเพื่อเปิดไมค์" : "แตะเพื่อปิดไมค์"}
            >
              {isMuted ? (
                <MicOff size={20} className="text-white" />
              ) : (
                <Mic size={20} className="text-white" />
              )}
            </button>

            {/* Status Text & Audio Wave */}
            <div 
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setIsMuted(!isMuted)}
              className="flex flex-col justify-center cursor-pointer min-w-[100px]"
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
                {isMuted ? 'แตะเพื่อเปิดไมค์' : (volumeLevel > 8 ? 'กำลังพูด (เสียงเข้า)' : (otherPeersCount > 0 ? `คุยอยู่กับ ${otherPeersCount} คน` : 'กำลังรอเพื่อนเข้าห้อง'))}
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
              className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              title="ออกจากห้องคุยเสียง (วางสาย)"
            >
              <PhoneOff size={16} />
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default GlobalVoiceWidget;
