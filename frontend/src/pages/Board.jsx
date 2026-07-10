import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import { ArrowLeft } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import Toolbar from '../components/Toolbar';
import { API_URL } from '../config';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const distancePointToSegment = (p, v, w) => {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
};

const isPointInElement = (pt, el, radius) => {
  if (el.tool === 'eraser') return false;
  const hitRadius = radius + (el.size ? el.size / 2 : 5);
  
  if (el.type === 'path') {
    if (!el.points || el.points.length === 0) return false;
    for (let i = 0; i < el.points.length - 1; i++) {
      if (el.points[i] !== null && el.points[i+1] !== null) {
        if (distancePointToSegment(pt, el.points[i], el.points[i+1]) < hitRadius) return true;
      } else if (el.points[i] !== null && el.points[i+1] === null) {
        if (Math.hypot(pt.x - el.points[i].x, pt.y - el.points[i].y) < hitRadius) return true;
      }
    }
    if (el.points.length > 0 && el.points[el.points.length - 1] !== null) {
      if (Math.hypot(pt.x - el.points[el.points.length - 1].x, pt.y - el.points[el.points.length - 1].y) < hitRadius) return true;
    }
    return false;
  } else if (el.type === 'line') {
    return distancePointToSegment(pt, {x: el.x, y: el.y}, {x: el.x1, y: el.y1}) < hitRadius;
  } else if (el.type === 'rectangle') {
    const v1 = {x: el.x, y: el.y};
    const v2 = {x: el.x + el.w, y: el.y};
    const v3 = {x: el.x + el.w, y: el.y + el.h};
    const v4 = {x: el.x, y: el.y + el.h};
    return distancePointToSegment(pt, v1, v2) < hitRadius ||
           distancePointToSegment(pt, v2, v3) < hitRadius ||
           distancePointToSegment(pt, v3, v4) < hitRadius ||
           distancePointToSegment(pt, v4, v1) < hitRadius;
  } else if (el.type === 'image') {
      return pt.x >= el.x && pt.x <= el.x + el.w && pt.y >= el.y && pt.y <= el.y + el.h;
    } else if (el.type === 'circle') {
    const elRadius = Math.hypot(el.w, el.h);
    const dist = Math.hypot(pt.x - el.x, pt.y - el.y);
    return Math.abs(dist - elRadius) < hitRadius;
  }
  return false;
};


const isPointInPolygon = (point, vs) => {
  let x = point.x, y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i].x, yi = vs[i].y;
    let xj = vs[j].x, yj = vs[j].y;
    let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const getElementBoundingBox = (el) => {
  let minX, minY, maxX, maxY;
  if (el.type === 'path') {
     const validPoints = el.points ? el.points.filter(p => p !== null) : [];
     if (validPoints.length === 0) return {};
     minX = Math.min(...validPoints.map(p => p.x));
     minY = Math.min(...validPoints.map(p => p.y));
     maxX = Math.max(...validPoints.map(p => p.x));
     maxY = Math.max(...validPoints.map(p => p.y));
  } else if (el.type === 'line') {
     minX = Math.min(el.x, el.x1);
     minY = Math.min(el.y, el.y1);
     maxX = Math.max(el.x, el.x1);
     maxY = Math.max(el.y, el.y1);
  } else if (el.type === 'circle') {
     const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));
     minX = el.x - r; minY = el.y - r; maxX = el.x + r; maxY = el.y + r;
  } else if (el.type === 'rectangle' || el.type === 'image') {
     minX = el.x; minY = el.y; maxX = el.x + el.w; maxY = el.y + el.h;
  }
  return { minX, minY, maxX, maxY };
};

const isElementInLasso = (el, lassoPoints) => {
  if (el.type === 'path' && el.points) {
    return el.points.some(p => p !== null && isPointInPolygon(p, lassoPoints));
  } else {
    const box = getElementBoundingBox(el);
    if (box.minX === undefined) return false;
    const corners = [
      {x: box.minX, y: box.minY}, {x: box.maxX, y: box.minY},
      {x: box.minX, y: box.maxY}, {x: box.maxX, y: box.maxY}
    ];
    return corners.some(c => isPointInPolygon(c, lassoPoints));
  }
};

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

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
  const imageCacheRef = useRef({});
  const [selectedElementIds, setSelectedElementIds] = useState([]);
  const activeLassoPathRef = useRef(null);
  const dragContext = useRef(null);
  
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
      if (redrawRef.current) redrawRef.current();
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

    newSocket.on('update-element', (data) => {
      elementsRef.current = elementsRef.current.map(el => el.id === data.element.id ? data.element : el);
      setElements([...elementsRef.current]);
      if (redrawRef.current) redrawRef.current();
    });

    newSocket.on('delete-element', ({ elementId }) => {
      elementsRef.current = elementsRef.current.filter(el => el.id !== elementId);
      setElements([...elementsRef.current]);
      if (redrawRef.current) redrawRef.current();
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
      ctx.strokeStyle = el.tool === 'eraser' ? 'rgba(0,0,0,1)' : el.color;
        ctx.globalCompositeOperation = el.tool === 'eraser' ? 'destination-out' : 'source-over';
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

      if (el.type === 'lasso') {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([5 / zoom, 5 / zoom]);
        ctx.beginPath();
        if (el.points.length > 0) {
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            ctx.lineTo(el.points[i].x, el.points[i].y);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        return;
      }
      if (el.type === 'path') {
        if (el.points.length > 0) {
          let isStarting = true;
          for (let i = 0; i < el.points.length; i++) {
            if (el.points[i] === null) {
              isStarting = true;
            } else {
              if (isStarting) {
                ctx.moveTo(el.points[i].x, el.points[i].y);
                isStarting = false;
              } else {
                ctx.lineTo(el.points[i].x, el.points[i].y);
              }
            }
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
      } else if (el.type === 'image') {
        if (!imageCacheRef.current[el.url]) {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.src = el.url;
          img.onload = () => {
            imageCacheRef.current[el.url] = img;
            redraw();
          };
          imageCacheRef.current[el.url] = 'loading';
        } else if (imageCacheRef.current[el.url] !== 'loading') {
          const img = imageCacheRef.current[el.url];
          ctx.drawImage(img, el.x, el.y, el.w, el.h);
        }
      }

    };

    elementsRef.current.forEach(drawElement);

    // Draw current shape being drawn (if any)
    if (currentPath.current) {
      drawElement(currentPath.current);
    }
    
    // Draw remote paths
    Object.values(remotePaths.current).forEach(drawElement);

    if (selectedElementIds.length > 0) {
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
      selectedElementIds.forEach(id => {
        const el = elementsRef.current.find(e => e.id === id);
        if (el && el.tool !== 'eraser') {
          const box = getElementBoundingBox(el);
          if (box.minX !== undefined) {
            if (box.minX < gMinX) gMinX = box.minX;
            if (box.minY < gMinY) gMinY = box.minY;
            if (box.maxX > gMaxX) gMaxX = box.maxX;
            if (box.maxY > gMaxY) gMaxY = box.maxY;
          }
        }
      });
      if (gMinX !== Infinity) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([5 / zoom, 5 / zoom]);
        const pad = 5 / zoom;
        
        if (activeLassoPathRef.current && activeLassoPathRef.current.length > 0) {
            ctx.beginPath();
            ctx.moveTo(activeLassoPathRef.current[0].x, activeLassoPathRef.current[0].y);
            for (let i = 1; i < activeLassoPathRef.current.length; i++) {
                ctx.lineTo(activeLassoPathRef.current[i].x, activeLassoPathRef.current[i].y);
            }
            ctx.lineTo(activeLassoPathRef.current[0].x, activeLassoPathRef.current[0].y);
            ctx.stroke();
        } else {
            ctx.strokeRect(gMinX - pad, gMinY - pad, gMaxX - gMinX + pad*2, gMaxY - gMinY + pad*2);
        }
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#ffffff';
        const hs = 12 / zoom;
        ctx.fillRect(gMaxX + pad - hs/2, gMaxY + pad - hs/2, hs, hs);
        ctx.strokeRect(gMaxX + pad - hs/2, gMaxY + pad - hs/2, hs, hs);
      }
    }
  }, [zoom, pan, selectedElementIds]);
 // Removed elements from deps since we use elementsRef

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

    if (currentTool === 'select') {
      const pos = getMousePos(e);
      if (selectedElementIds.length > 0) {
        let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
        selectedElementIds.forEach(id => {
          const el = elementsRef.current.find(e => e.id === id);
          if (el && el.tool !== 'eraser') {
            const box = getElementBoundingBox(el);
            if (box.minX !== undefined) {
              if (box.minX < gMinX) gMinX = box.minX;
              if (box.minY < gMinY) gMinY = box.minY;
              if (box.maxX > gMaxX) gMaxX = box.maxX;
              if (box.maxY > gMaxY) gMaxY = box.maxY;
            }
          }
        });
        const pad = 5 / zoom;
        const hs = 25 / zoom;
        
        if (pos.x >= gMaxX + pad - hs && pos.x <= gMaxX + pad + hs && pos.y >= gMaxY + pad - hs && pos.y <= gMaxY + pad + hs) {
          dragContext.current = { 
            type: 'scale', startX: pos.x, startY: pos.y, 
            gMinX, gMinY, gMaxX, gMaxY,
            origElements: selectedElementIds.map(id => JSON.parse(JSON.stringify(elementsRef.current.find(e => e.id === id)))),
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
          return;
        }
        
        if (pos.x >= gMinX - pad && pos.x <= gMaxX + pad && pos.y >= gMinY - pad && pos.y <= gMaxY + pad) {
          dragContext.current = { 
            type: 'move', startX: pos.x, startY: pos.y, 
            origElements: selectedElementIds.map(id => JSON.parse(JSON.stringify(elementsRef.current.find(e => e.id === id)))),
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
          return;
        }
      }
      
      // Removed single-click hitIdx logic to allow pure lasso drawing
      
      setSelectedElementIds([]);
      activeLassoPathRef.current = null;
      currentPath.current = { id: generateId(), type: 'lasso', tool: 'select', points: [pos] };
      isDrawing.current = true;
      e.target.setPointerCapture(e.pointerId);
      return;
    }

    if (currentTool === 'eraser-object') {
      const pos = getMousePos(e);
      checkObjectEraserCollision(pos);
      isDrawing.current = true;
      e.target.setPointerCapture(e.pointerId);
      return;
    }
    if (currentTool === 'eraser') {
      const pos = getMousePos(e);
      erasePixel(pos);
      isDrawing.current = true;
      e.target.setPointerCapture(e.pointerId);
      return;
    }

    isDrawing.current = true;
    const pos = getMousePos(e);
    startPoint.current = pos;
    e.target.setPointerCapture(e.pointerId);

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser') {
      currentPath.current = {
        id: generateId(),
        type: 'path',
        tool: currentTool,
        points: [pos],
        color: brushColor,
        size: brushSize
      };
    } else {
      // Shape
      currentPath.current = {
        id: generateId(),
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

  const erasePixel = (pos) => {
    let changed = false;
    const newElements = [];
    
    for (let j = 0; j < elementsRef.current.length; j++) {
      const el = elementsRef.current[j];
      
      if (el.type === 'path') {
        let pathCut = false;
        const newPaths = [];
        let currentSubPath = [];
        
        const eraserRadius = brushSize / 2;
        
        for (let i = 0; i < el.points.length; i++) {
           let isPointErased = Math.hypot(el.points[i].x - pos.x, el.points[i].y - pos.y) < eraserRadius;
           let isSegmentErased = false;
           
           if (!isPointErased && i > 0 && currentSubPath.length > 0) {
               const prevPoint = el.points[i-1];
               if (distancePointToSegment(pos, prevPoint, el.points[i]) < eraserRadius) {
                   isSegmentErased = true;
               }
           }
           
           if (isPointErased || isSegmentErased) {
               pathCut = true;
               if (currentSubPath.length > 0) {
                   newPaths.push(currentSubPath);
                   currentSubPath = [];
               }
               if (!isPointErased && isSegmentErased) {
                   currentSubPath.push(el.points[i]);
               }
           } else {
               currentSubPath.push(el.points[i]);
           }
        }
        if (currentSubPath.length > 0) {
            newPaths.push(currentSubPath);
        }
        
        if (pathCut) {
            changed = true;
            if (socket && socket.id) socket.emit('delete-element', { boardId: studentId, elementId: el.id });
            
            for (let subPath of newPaths) {
                const newEl = { ...el, id: generateId(), points: subPath };
                newElements.push(newEl);
                if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
            }
        } else {
            newElements.push(el);
        }
      } else {
        newElements.push(el);
      }
    }
    
    if (changed) {
      elementsRef.current = newElements;
      setElements([...elementsRef.current]);
      if (redrawRef.current) redrawRef.current();
    }
  };

  const checkObjectEraserCollision = (pos) => {
    const elIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, brushSize));
    if (elIdx !== -1) {
      const deletedEl = elementsRef.current[elIdx];
      if (deletedEl.id) {
        elementsRef.current.splice(elIdx, 1);
        setElements([...elementsRef.current]);
        if (redrawRef.current) redrawRef.current();
        if (socket && socket.id) {
          socket.emit('delete-element', { boardId: studentId, elementId: deletedEl.id });
        }
      }
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

    if (currentTool === 'select') {
      if (currentPath.current && currentPath.current.type === 'lasso') {
        currentPath.current.points.push(pos);
        requestAnimationFrame(redraw);
        return;
      }
      if (dragContext.current) {
        const dx = pos.x - dragContext.current.startX;
        const dy = pos.y - dragContext.current.startY;
        
        dragContext.current.origElements.forEach(origEl => {
          if (!origEl) return;
          const elIdx = elementsRef.current.findIndex(e => e.id === origEl.id);
          if (elIdx === -1) return;
          const el = elementsRef.current[elIdx];
          
          if (dragContext.current.type === 'move') {
            if (el.type === 'path') {
               el.points = el.points.map((p, i) => (origEl.points[i] === null ? null : { x: origEl.points[i].x + dx, y: origEl.points[i].y + dy }));
            } else {
               el.x = origEl.x + dx;
               el.y = origEl.y + dy;
               if (el.type === 'line') {
                 el.x1 = origEl.x1 + dx;
                 el.y1 = origEl.y1 + dy;
               }
            }
          } else if (dragContext.current.type === 'scale') {
             const origW = dragContext.current.gMaxX - dragContext.current.gMinX;
             const newW = Math.max(20, origW + dx);
             const scale = origW === 0 ? 1 : newW / origW;
             
             if (el.type === 'path') {
               el.points = el.points.map((p, i) => (origEl.points[i] === null ? null : { 
                 x: dragContext.current.gMinX + (origEl.points[i].x - dragContext.current.gMinX) * scale, 
                 y: dragContext.current.gMinY + (origEl.points[i].y - dragContext.current.gMinY) * scale 
               }));
               el.size = origEl.size * scale;
             } else {
               el.x = dragContext.current.gMinX + (origEl.x - dragContext.current.gMinX) * scale;
               el.y = dragContext.current.gMinY + (origEl.y - dragContext.current.gMinY) * scale;
               if (el.type === 'line') {
                 el.x1 = dragContext.current.gMinX + (origEl.x1 - dragContext.current.gMinX) * scale;
                 el.y1 = dragContext.current.gMinY + (origEl.y1 - dragContext.current.gMinY) * scale;
               }
               if (el.w !== undefined) el.w = origEl.w * scale;
               if (el.h !== undefined) el.h = origEl.h * scale;
               if (el.size !== undefined) el.size = origEl.size * scale;
             }
          }
          if (socket && socket.id && shouldEmit) {
            socket.emit('update-element', { boardId: studentId, element: el });
          }
        });
        
        if (dragContext.current.origLassoPath) {
            if (dragContext.current.type === 'move') {
                activeLassoPathRef.current = dragContext.current.origLassoPath.map(p => ({
                    x: p.x + dx, y: p.y + dy
                }));
            } else if (dragContext.current.type === 'scale') {
                const origW = dragContext.current.gMaxX - dragContext.current.gMinX;
                const newW = Math.max(20, origW + dx);
                const scale = origW === 0 ? 1 : newW / origW;
                activeLassoPathRef.current = dragContext.current.origLassoPath.map(p => ({
                    x: dragContext.current.gMinX + (p.x - dragContext.current.gMinX) * scale,
                    y: dragContext.current.gMinY + (p.y - dragContext.current.gMinY) * scale
                }));
            }
        }
        
        if (shouldEmit) lastEmitTime.current = now;
        setElements([...elementsRef.current]);
        requestAnimationFrame(redraw);
        return;
      }
    }

    if (!isDrawing.current) return;

    if (currentTool === 'eraser-object') {
      checkObjectEraserCollision(pos);
      return;
    }
    if (currentTool === 'eraser') {
      erasePixel(pos);
      return;
    }

    if (!currentPath.current) return;

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

    if (currentTool === 'select' && currentPath.current && currentPath.current.type === 'lasso') {
      const lassoPoints = currentPath.current.points;
      if (lassoPoints.length > 2) {
        const selectedIds = [];
        elementsRef.current.forEach(el => {
          if (isElementInLasso(el, lassoPoints)) {
            selectedIds.push(el.id);
          }
        });
        setSelectedElementIds(selectedIds);
        if (selectedIds.length > 0) {
            activeLassoPathRef.current = lassoPoints;
        } else {
            activeLassoPathRef.current = null;
        }
      } else {
        setSelectedElementIds([]);
        activeLassoPathRef.current = null;
      }
      currentPath.current = null;
      isDrawing.current = false;
      redraw();
      return;
    }

    if (dragContext.current) {
      if (socket && socket.id) {
        dragContext.current.origElements.forEach(origEl => {
            if (!origEl) return;
            const el = elementsRef.current.find(e => e.id === origEl.id);
            if (el) socket.emit('update-element', { boardId: studentId, element: el });
        });
      }
      dragContext.current = null;
      isDrawing.current = false;
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
  const handleUpload = async (file) => {
    try {
      let uploadFile = file;
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        uploadFile = new File([blob], file.name.replace('.pdf', '.png'), { type: 'image/png' });
      }

      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await axios.post(`${API_URL}/api/upload`, formData);
      const publicUrl = res.data.url;

      const newEl = {
        id: generateId(),
        type: 'image',
        url: publicUrl,
        x: -pan.x / zoom + 50,
        y: -pan.y / zoom + 50,
        w: 400,
        h: uploadFile.type === 'image/png' && file.type === 'application/pdf' ? 565 : 400
      };

      const img = new Image();
      img.onload = () => {
        newEl.w = Math.min(img.width, 800);
        newEl.h = (img.height / img.width) * newEl.w;
        elementsRef.current = [...elementsRef.current, newEl];
        setElements([...elementsRef.current]);
        redraw();
        if (socket && socket.id) {
          socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
        }
      };
      img.src = publicUrl;
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed: ' + err.message);
    }
  };

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
        handleUpload={handleUpload}
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
