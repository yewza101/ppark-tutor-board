import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import Toolbar from '../components/Toolbar';
import { API_URL } from '../config';

const Board = () => {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const [socket, setSocket] = useState(null);
  
  // Tools state
  const [currentTool, setCurrentTool] = useState('pencil');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  
  // Canvas data state
  const [elements, setElements] = useState([]);
  const elementsRef = useRef([]); // For zero-latency canvas rendering
  const [pastStates, setPastStates] = useState([]);
  const [futureStates, setFutureStates] = useState([]);
  
  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  
  // Collaborative state
  const [cursors, setCursors] = useState({});
  
  // Drawing state
  const isDrawing = useRef(false);
  const currentPath = useRef(null);
  const startPoint = useRef(null);
  const activePointerId = useRef(null);
  const remotePaths = useRef({});
  const lastEmitTime = useRef(0);

  // Initialize Socket and Fetch initial data
  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }

    const loadBoard = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/boards/${studentId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data.canvas_data) {
          const parsed = JSON.parse(res.data.canvas_data);
          setElements(parsed);
        }
      } catch (err) {
        console.error('Failed to load board', err);
        if (err.response?.status === 403 || err.response?.status === 401) {
          navigate(user.role === 'admin' ? '/admin' : '/login');
        }
      }
    };
    loadBoard();

    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.emit('join-board', studentId);

    // We use a ref for redraw to avoid stale closures in socket listeners
    let isRedrawPending = false;
    const triggerRedraw = () => {
      if (!isRedrawPending && redrawRef.current) {
        isRedrawPending = true;
        requestAnimationFrame(() => {
          if (redrawRef.current) redrawRef.current();
          isRedrawPending = false;
        });
      }
    };

    newSocket.on('canvas-update', (updatedElements) => {
      setElements(prev => {
        setPastStates(p => [...p, prev]);
        setFutureStates([]);
        return updatedElements;
      });
    });

    newSocket.on('draw-progress', (data) => {
      if (data.path === null) {
        delete remotePaths.current[data.socketId];
      } else {
        remotePaths.current[data.socketId] = data.path;
      }
      triggerRedraw();
    });

    newSocket.on('draw-stroke', (data) => {
      setElements(prev => {
        const newElements = [...prev, data.stroke];
        setPastStates(p => [...p, prev]);
        setFutureStates([]);
        return newElements;
      });
      if (data.socketId && remotePaths.current[data.socketId]) {
        delete remotePaths.current[data.socketId];
      }
    });

    newSocket.on('undo', () => {
      setElements(prev => {
        if (prev.length === 0) return prev;
        const newElements = prev.slice(0, -1);
        setPastStates(p => {
          const newPast = [...p];
          newPast.pop(); // Remove the last state which corresponds to the element just undone
          return newPast;
        });
        return newElements;
      });
    });

    newSocket.on('clear-canvas', () => {
      setElements(prev => {
        setPastStates(p => [...p, prev]);
        return [];
      });
    });

    newSocket.on('cursor-move', (data) => {
      setCursors(prev => ({
        ...prev,
        [data.socketId]: { x: data.x, y: data.y, username: data.username, color: data.color }
      }));
    });

    newSocket.on('cursor-leave', (socketId) => {
      setCursors(prev => {
        const newCursors = { ...prev };
        delete newCursors[socketId];
        return newCursors;
      });
    });

    return () => newSocket.disconnect();
  }, [studentId, user, token, navigate]);

  // We need to keep a ref to the latest redraw to avoid stale closures in socket events
  const redrawRef = useRef(null);

  // Redraw canvas whenever elements, zoom, or pan changes
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom and pan
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw elements
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawElement = (el) => {
      ctx.beginPath();
      ctx.strokeStyle = el.tool === 'eraser' ? '#ffffff' : el.color;
      ctx.lineWidth = el.size;

      if (el.tool === 'laser') {
        ctx.shadowBlur = 15;
        ctx.shadowColor = el.color;
        ctx.strokeStyle = '#ffffff'; 
        ctx.lineWidth = Math.max(2, el.size / 2);
      } else {
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }

      if (el.type === 'path') {
        if (el.points.length > 0) {
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            ctx.lineTo(el.points[i].x, el.points[i].y);
          }
          ctx.stroke();
        }
      } else if (el.type === 'line') {
        ctx.moveTo(el.x1, el.y1);
        ctx.lineTo(el.x2, el.y2);
        ctx.stroke();
      } else if (el.type === 'rectangle') {
        ctx.rect(el.x, el.y, el.w, el.h);
        ctx.stroke();
      } else if (el.type === 'circle') {
        const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));
        ctx.arc(el.x, el.y, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
    };

    elementsRef.current.forEach(drawElement);

    // Draw current shape being drawn (if any)
    if (currentPath.current) {
      drawElement(currentPath.current);
    }
    
    // Draw remote paths
    Object.values(remotePaths.current).forEach(drawElement);
  }, [zoom, pan]); // Removed elements from deps since we use elementsRef

  useEffect(() => {
    elementsRef.current = elements;
    redrawRef.current = redraw;
    redraw();
  }, [elements, redraw]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        redraw();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [redraw]);

  const emitCanvasUpdate = (newElements) => {
    if (socket) {
      socket.emit('canvas-update', { boardId: studentId, canvasState: newElements });
    }
  };

  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom
    };
  };

  const onPointerDown = (e) => {
    if (activePointerId.current !== null) return; // Ignore multitouch secondary fingers
    activePointerId.current = e.pointerId;

    // Middle click or Space + Click for panning
    if (e.button === 1 || e.altKey || currentTool === 'pan') {
      setIsPanning(true);
      startPoint.current = { x: e.clientX, y: e.clientY };
      e.target.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return; // Only left click for drawing

    isDrawing.current = true;
    const pos = getMousePos(e);
    startPoint.current = pos;
    e.target.setPointerCapture(e.pointerId);

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser') {
      currentPath.current = {
        type: 'path',
        tool: currentTool,
        points: [pos],
        color: brushColor,
        size: brushSize
      };
    } else {
      // Shape
      currentPath.current = {
        type: currentTool,
        tool: currentTool,
        x: pos.x,
        y: pos.y,
        x1: pos.x,
        y1: pos.y,
        w: 0,
        h: 0,
        color: brushColor,
        size: brushSize
      };
    }
  };

  const onPointerMove = (e) => {
    const pos = getMousePos(e);
    const now = Date.now();
    const shouldEmit = now - lastEmitTime.current > 30;
    
    if (socket && socket.id && shouldEmit) {
      // Throttle cursor emit slightly in a real app, but raw is fine for local
      socket.emit('cursor-move', {
        boardId: studentId,
        username: user.username,
        x: pos.x,
        y: pos.y,
        color: user.role === 'admin' ? '#ef4444' : '#3b82f6'
      });
    }

    if (activePointerId.current !== e.pointerId) return; // Ignore other pointers

    if (isPanning) {
      const dx = e.clientX - startPoint.current.x;
      const dy = e.clientY - startPoint.current.y;
      setPan({ x: pan.x + dx, y: pan.y + dy });
      startPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isDrawing.current || !currentPath.current) return;

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser') {
      currentPath.current.points.push(pos);
      // Laser trailing effect
      if (currentTool === 'laser' && currentPath.current.points.length > 30) {
        currentPath.current.points.shift();
      }
    } else if (currentTool === 'line') {
      currentPath.current.x2 = pos.x;
      currentPath.current.y2 = pos.y;
    } else {
      currentPath.current.w = pos.x - startPoint.current.x;
      currentPath.current.h = pos.y - startPoint.current.y;
    }
    
    // Request animation frame for smooth redraw
    requestAnimationFrame(redraw);
    
    if (socket && socket.id && shouldEmit) {
      socket.emit('draw-progress', { 
        boardId: studentId, 
        path: currentPath.current, 
        socketId: socket.id 
      });
      lastEmitTime.current = now;
    }
  };

  const onPointerUp = (e) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    
    e.target.releasePointerCapture(e.pointerId);
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing.current && currentPath.current) {
      const stroke = currentPath.current;
      
      // Don't save laser strokes to the permanent board elements
      if (stroke.tool !== 'laser') {
        // Optimistic update for zero-flicker rendering
        elementsRef.current = [...elementsRef.current, stroke];
        
        setElements(prev => {
          setPastStates(p => [...p, prev]);
          setFutureStates([]);
          return [...prev, stroke];
        });
        if (socket && socket.id) {
          socket.emit('draw-stroke', { boardId: studentId, stroke, socketId: socket.id });
        }
      }
    }
    
    // Clear current path
    isDrawing.current = false;
    currentPath.current = null;
    
    // Clear the progress on other clients
    if (socket && socket.id) {
      socket.emit('draw-progress', { 
        boardId: studentId, 
        path: null, 
        socketId: socket.id 
      });
    }
    
    redraw();
  };

  const onWheel = (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      // Zoom
      const zoomFactor = 0.1;
      const direction = e.deltaY > 0 ? -1 : 1;
      const newZoom = Math.max(0.1, Math.min(5, zoom + direction * zoomFactor));
      
      // Zoom towards mouse position
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);
      
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    } else {
      // Pan
      setPan({
        x: pan.x - e.deltaX,
        y: pan.y - e.deltaY
      });
    }
  };

  // Toolbar Actions
  const handleUndo = () => {
    if (pastStates.length === 0) return;
    const previous = pastStates[pastStates.length - 1];
    const newPast = pastStates.slice(0, -1);
    setPastStates(newPast);
    setFutureStates([elements, ...futureStates]);
    setElements(previous);
    if (socket) socket.emit('undo', studentId);
  };

  const handleRedo = () => {
    if (futureStates.length === 0) return;
    const next = futureStates[0];
    const newFuture = futureStates.slice(1);
    setFutureStates(newFuture);
    setPastStates([...pastStates, elements]);
    setElements(next);
    emitCanvasUpdate(next); // Fallback to full sync for redo
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear the canvas?')) {
      setPastStates([...pastStates, elements]);
      setFutureStates([]);
      setElements([]);
      if (socket) socket.emit('clear-canvas', studentId);
    }
  };

  const handleZoomIn = () => setZoom(z => Math.min(5, z + 0.2));
  const handleZoomOut = () => setZoom(z => Math.max(0.1, z - 0.2));
  const handleResetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-100 overflow-hidden touch-none">
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        {user?.role === 'admin' && (
          <button 
            onClick={() => navigate('/admin')}
            className="flex items-center gap-2 px-4 py-2 bg-white shadow-md rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
          >
            <ArrowLeft size={20} /> Back to Dashboard
          </button>
        )}
      </div>

      <Toolbar 
        currentTool={currentTool} setCurrentTool={setCurrentTool}
        brushColor={brushColor} setBrushColor={setBrushColor}
        brushSize={brushSize} setBrushSize={setBrushSize}
        handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} handleResetZoom={handleResetZoom}
        handleClear={handleClear} handleUndo={handleUndo} handleRedo={handleRedo}
        canUndo={pastStates.length > 0} canRedo={futureStates.length > 0}
      />

      <div 
        ref={containerRef} 
        className={`flex-1 w-full h-full touch-none ${
          isPanning ? 'cursor-grabbing' : (currentTool === 'pan' ? 'cursor-grab' : (currentTool === 'pencil' || currentTool === 'eraser' ? 'cursor-crosshair' : 'cursor-default'))
        }`}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full bg-white touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Render Live Cursors */}
        {Object.entries(cursors).map(([socketId, cursor]) => {
          const left = cursor.x * zoom + pan.x;
          const top = cursor.y * zoom + pan.y;
          return (
            <div 
              key={socketId}
              className="absolute pointer-events-none z-20 flex flex-col items-center"
              style={{ left: `${left}px`, top: `${top}px` }}
            >
              {/* Cursor Arrow/Dot */}
              <svg 
                width="24" height="24" viewBox="0 0 24 24" fill={cursor.color} 
                xmlns="http://www.w3.org/2000/svg"
                className="drop-shadow-md -ml-2 -mt-2"
                style={{ transform: 'rotate(-20deg)' }}
              >
                <path d="M4 2L20 12L12 14L9 22L4 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
              {/* Username Tag */}
              <span 
                className="mt-1 px-2 py-0.5 text-xs font-semibold text-white rounded shadow-sm whitespace-nowrap ml-6"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.username}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Board;
