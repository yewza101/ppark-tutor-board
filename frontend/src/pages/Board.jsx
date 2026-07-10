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
  } else if (el.type === 'text') {
      const box = getElementBoundingBox(el);
      return pt.x >= box.minX && pt.x <= box.maxX && pt.y >= box.minY && pt.y <= box.maxY;
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
  } else if (el.type === 'text') {
     minX = el.x; minY = el.y; maxX = el.x + (el.w || el.size * el.text.length * 0.6); maxY = el.y + el.size;
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
  const draftCanvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const fullRedrawRef = useRef(null);
  const redrawBaseRef = useRef(null);
  const redrawDraftRef = useRef(null);
  
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
  const [bgTemplate, setBgTemplate] = useState('blank');
  const [textInput, setTextInput] = useState(null);
  
  // Collaborative state
  const [cursors, setCursors] = useState({});
  const imageCacheRef = useRef({});
  const [selectedElementIds, setSelectedElementIds] = useState([]);
  const activeLassoPathRef = useRef(null);
  const dragContext = useRef(null);
  
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [dragEndTick, setDragEndTick] = useState(0);
  const [contextMenuPos, setContextMenuPos] = useState(null);
  
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
      if (!isRedrawPending && fullRedrawRef.current) {
        isRedrawPending = true;
        requestAnimationFrame(() => {
          if (fullRedrawRef.current) fullRedrawRef.current();
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
      if (fullRedrawRef.current) fullRedrawRef.current();
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
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('delete-element', ({ elementId }) => {
      elementsRef.current = elementsRef.current.filter(el => el.id !== elementId);
      setElements([...elementsRef.current]);
      if (fullRedrawRef.current) fullRedrawRef.current();
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

  const drawElement = useCallback((ctx, el, currentZoom) => {
    ctx.beginPath();
    const oldAlpha = ctx.globalAlpha;
    const oldComposite = ctx.globalCompositeOperation;
    
    ctx.strokeStyle = el.tool === 'eraser' ? 'rgba(0,0,0,1)' : el.color;
    ctx.globalCompositeOperation = el.tool === 'eraser' ? 'destination-out' : (el.tool === 'highlighter' ? 'multiply' : 'source-over');
    ctx.globalAlpha = el.tool === 'highlighter' ? 0.4 : 1.0;
    
    // Width can be dynamic based on pressure if available in points, but here we just use el.size
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
      ctx.lineWidth = 1 / currentZoom;
      ctx.setLineDash([5 / currentZoom, 5 / currentZoom]);
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
        if (!el.path2d) {
          const p2d = new Path2D();
          let pts = [];
          const drawSmooth = (points) => {
              if (points.length === 1) {
                  p2d.moveTo(points[0].x, points[0].y);
                  p2d.lineTo(points[0].x + 0.1, points[0].y + 0.1);
              } else if (points.length === 2) {
                  p2d.moveTo(points[0].x, points[0].y);
                  p2d.lineTo(points[1].x, points[1].y);
              } else {
                  p2d.moveTo(points[0].x, points[0].y);
                  for (let i = 1; i < points.length - 1; i++) {
                      const xc = (points[i].x + points[i + 1].x) / 2;
                      const yc = (points[i].y + points[i + 1].y) / 2;
                      p2d.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
                  }
                  p2d.lineTo(points[points.length - 1].x, points[points.length - 1].y);
              }
          };

          for (let i = 0; i < el.points.length; i++) {
            if (el.points[i] === null) {
              if (pts.length > 0) drawSmooth(pts);
              pts = [];
            } else {
              pts.push(el.points[i]);
            }
          }
          if (pts.length > 0) drawSmooth(pts);
          el.path2d = p2d;
        }
        ctx.stroke(el.path2d);
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
          if (fullRedrawRef.current) fullRedrawRef.current();
        };
        imageCacheRef.current[el.url] = 'loading';
      } else if (imageCacheRef.current[el.url] !== 'loading') {
        const img = imageCacheRef.current[el.url];
        ctx.drawImage(img, el.x, el.y, el.w, el.h);
      }
    } else if (el.type === 'text') {
      ctx.font = `${el.size}px sans-serif`;
      ctx.fillStyle = el.color;
      ctx.textBaseline = 'top';
      ctx.fillText(el.text, el.x, el.y);
    }
    
    ctx.globalAlpha = oldAlpha;
    ctx.globalCompositeOperation = oldComposite;
  }, []);

  const redrawBase = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    
    if (bgTemplate !== 'blank') {
       ctx.strokeStyle = '#e5e7eb';
       ctx.lineWidth = 1 / zoom;
       const startX = -pan.x / zoom;
       const startY = -pan.y / zoom;
       const endX = (canvas.width - pan.x) / zoom;
       const endY = (canvas.height - pan.y) / zoom;
       
       ctx.beginPath();
       if (bgTemplate === 'lined' || bgTemplate === 'grid') {
           const spacing = 40;
           const firstLineY = Math.floor(startY / spacing) * spacing;
           for (let y = firstLineY; y < endY; y += spacing) {
               ctx.moveTo(startX, y);
               ctx.lineTo(endX, y);
           }
           if (bgTemplate === 'grid') {
               const firstLineX = Math.floor(startX / spacing) * spacing;
               for (let x = firstLineX; x < endX; x += spacing) {
                   ctx.moveTo(x, startY);
                   ctx.lineTo(x, endY);
               }
           }
           ctx.stroke();
       } else if (bgTemplate === 'dot') {
           const spacing = 40;
           ctx.fillStyle = '#d1d5db';
           const firstLineY = Math.floor(startY / spacing) * spacing;
           const firstLineX = Math.floor(startX / spacing) * spacing;
           for (let y = firstLineY; y < endY; y += spacing) {
               for (let x = firstLineX; x < endX; x += spacing) {
                   ctx.beginPath();
                   ctx.arc(x, y, 2 / zoom, 0, Math.PI * 2);
                   ctx.fill();
               }
           }
       }
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    elementsRef.current.forEach(el => drawElement(ctx, el, zoom));
  }, [zoom, pan, bgTemplate, drawElement]);

  const redrawDraft = useCallback(() => {
    const canvas = draftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Transparent!
    
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (currentPath.current) drawElement(ctx, currentPath.current, zoom);
    Object.values(remotePaths.current).forEach(el => drawElement(ctx, el, zoom));

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
  }, [zoom, pan, selectedElementIds, drawElement]);

  const fullRedraw = useCallback(() => {
    redrawBase();
    redrawDraft();
  }, [redrawBase, redrawDraft]);

  useEffect(() => {
    elementsRef.current = elements;
    redrawBaseRef.current = redrawBase;
    redrawDraftRef.current = redrawDraft;
    fullRedrawRef.current = fullRedraw;
    fullRedraw();
  }, [elements, fullRedraw, redrawBase, redrawDraft]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        if (draftCanvasRef.current) {
          draftCanvasRef.current.width = containerRef.current.clientWidth;
          draftCanvasRef.current.height = containerRef.current.clientHeight;
        }
        if (fullRedrawRef.current) fullRedrawRef.current();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    setContextMenuPos(null);
    setShowColorPicker(false);
    
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
            isMoved: false,
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
            isMoved: false,
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

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser' || currentTool === 'highlighter') {
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
    
    for (let j = 0; j < elementsRef.current.length; j++) {
      const el = elementsRef.current[j];
      
      if (el.type === 'path' && el.tool !== 'eraser') {
        const box = getElementBoundingBox(el);
        if (box.minX !== undefined) {
            const pad = brushSize;
            if (pos.x < box.minX - pad || pos.x > box.maxX + pad || pos.y < box.minY - pad || pos.y > box.maxY + pad) {
                continue;
            }
        }
        
        let pathMutated = false;
        const eraserRadius = brushSize / 2;
        
        for (let i = 0; i < el.points.length; i++) {
           if (el.points[i] === null) continue;
           
           let isPointErased = Math.hypot(el.points[i].x - pos.x, el.points[i].y - pos.y) < eraserRadius;
           let isSegmentErased = false;
           
           if (!isPointErased && i > 0 && el.points[i-1] !== null) {
               if (distancePointToSegment(pos, el.points[i-1], el.points[i]) < eraserRadius) {
                   isSegmentErased = true;
               }
           }
           
           if (isPointErased || isSegmentErased) {
               el.points[i] = null;
               el.path2d = null; // Invalidate cached path
               pathMutated = true;
           }
        }
        
        if (pathMutated) {
            changed = true;
            if (socket && socket.id) socket.emit('update-element', { boardId: studentId, element: el });
        }
      }
    }
    
    if (changed) {
      setElements([...elementsRef.current]);
      if (fullRedrawRef.current) fullRedrawRef.current();
    }
  };

  const checkObjectEraserCollision = (pos) => {
    const elIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, brushSize));
    if (elIdx !== -1) {
      const deletedEl = elementsRef.current[elIdx];
      if (deletedEl.id) {
        elementsRef.current.splice(elIdx, 1);
        setElements([...elementsRef.current]);
        if (fullRedrawRef.current) fullRedrawRef.current();
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
        requestAnimationFrame(() => { if (redrawDraftRef.current) redrawDraftRef.current(); });
        return;
      }
      if (dragContext.current) {
        if (!dragContext.current.isMoved) {
            if (Math.hypot(e.clientX - startPoint.current.x, e.clientY - startPoint.current.y) > 5) {
                dragContext.current.isMoved = true;
            } else {
                return; // Ignore jitter
            }
        }
        
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
               el.path2d = null;
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
               el.path2d = null;
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
        requestAnimationFrame(() => { if (fullRedrawRef.current) fullRedrawRef.current(); });
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

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser' || currentTool === 'highlighter') {
      currentPath.current.points.push(pos);
      currentPath.current.path2d = null; // Invalidate cached path
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
    requestAnimationFrame(() => { if (redrawDraftRef.current) redrawDraftRef.current(); });
    
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

    if (currentTool === 'text') {
        const pos = getMousePos(e);
        setTextInput({ x: pos.x, y: pos.y, text: '' });
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
      if (fullRedrawRef.current) fullRedrawRef.current();
      return;
    }

    if (dragContext.current) {
      if (!dragContext.current.isMoved) {
          const rect = canvasRef.current.getBoundingClientRect();
          setContextMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
          if (socket && socket.id) {
            dragContext.current.origElements.forEach(origEl => {
                if (!origEl) return;
                const el = elementsRef.current.find(e => e.id === origEl.id);
                if (el) socket.emit('update-element', { boardId: studentId, element: el });
            });
          }
      }
      dragContext.current = null;
      isDrawing.current = false;
      setDragEndTick(t => t + 1);
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
    
    if (fullRedrawRef.current) fullRedrawRef.current();
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
        if (fullRedrawRef.current) fullRedrawRef.current();
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

  const handleChangeSelectionColor = (newColor) => {
      let changed = false;
      const newElements = elementsRef.current.map(el => {
          if (selectedElementIds.includes(el.id)) {
              changed = true;
              const updatedEl = { ...el, color: newColor };
              if (socket && socket.id) socket.emit('update-element', { boardId: studentId, element: updatedEl });
              return updatedEl;
          }
          return el;
      });
      if (changed) {
          elementsRef.current = newElements;
          setElements(newElements);
          if (fullRedrawRef.current) fullRedrawRef.current();
      }
      setShowColorPicker(false);
  };

  const handleDeleteSelection = () => {
      const remainingElements = elementsRef.current.filter(el => {
          if (selectedElementIds.includes(el.id)) {
              if (socket && socket.id) socket.emit('delete-element', { boardId: studentId, elementId: el.id });
              return false;
          }
          return true;
      });
      elementsRef.current = remainingElements;
      setElements(remainingElements);
      setSelectedElementIds([]);
      activeLassoPathRef.current = null;
      if (fullRedrawRef.current) fullRedrawRef.current();
  };

  const handleDuplicateSelection = () => {
      const newIds = [];
      const clonedElements = [];
      
      elementsRef.current.forEach(el => {
          if (selectedElementIds.includes(el.id)) {
              const clone = JSON.parse(JSON.stringify(el));
              clone.id = generateId();
              
              const offset = 20 / zoom;
              if (clone.type === 'path') {
                  clone.points = clone.points.map(p => p ? { x: p.x + offset, y: p.y + offset } : null);
              } else {
                  clone.x += offset;
                  clone.y += offset;
                  if (clone.type === 'line') {
                      clone.x1 += offset;
                      clone.y1 += offset;
                  }
              }
              
              clonedElements.push(clone);
              newIds.push(clone.id);
              if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: clone, socketId: socket.id });
          }
      });
      
      if (clonedElements.length > 0) {
          elementsRef.current = [...elementsRef.current, ...clonedElements];
          setElements([...elementsRef.current]);
          
          if (activeLassoPathRef.current) {
              const offset = 20 / zoom;
              activeLassoPathRef.current = activeLassoPathRef.current.map(p => ({ x: p.x + offset, y: p.y + offset }));
          }
          
          setSelectedElementIds(newIds);
          if (fullRedrawRef.current) fullRedrawRef.current();
      }
      setContextMenuPos(null);
  };

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
        bgTemplate={bgTemplate} setBgTemplate={setBgTemplate}
      />

      <div 
        ref={containerRef} 
        className={`relative flex-1 w-full h-full touch-none ${
          isPanning ? 'cursor-grabbing' : (currentTool === 'pan' ? 'cursor-grab' : (currentTool === 'pencil' || currentTool === 'eraser' ? 'cursor-crosshair' : 'cursor-default'))
        }`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full bg-white touch-none"
        />
        <canvas
          ref={draftCanvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onContextMenu={(e) => {
             e.preventDefault();
             if (selectedElementIds.length > 0) {
                 const rect = canvasRef.current.getBoundingClientRect();
                 setContextMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
             }
          }}
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
              <svg 
                width="24" height="24" viewBox="0 0 24 24" fill={cursor.color} 
                xmlns="http://www.w3.org/2000/svg"
                className="drop-shadow-md -ml-2 -mt-2"
                style={{ transform: 'rotate(-20deg)' }}
              >
                <path d="M4 2L20 12L12 14L9 22L4 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
              <span 
                className="mt-1 px-2 py-0.5 text-xs font-semibold text-white rounded shadow-sm whitespace-nowrap ml-6"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.username}
              </span>
            </div>
          );
        })}

        {contextMenuPos && (
          <div 
            className="absolute z-30 flex flex-col items-center pointer-events-auto"
            style={{ 
                left: `${contextMenuPos.x}px`, 
                top: `${contextMenuPos.y - 15}px`,
                transform: 'translate(-50%, -100%)'
            }}
          >
            <div className="bg-white/90 backdrop-blur-md shadow-lg rounded-xl flex items-center px-2 py-1.5 gap-1 border border-gray-100 relative">
               <button onClick={() => setShowColorPicker(!showColorPicker)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 transition-colors" title="Change Color">
                  <div className="w-5 h-5 rounded-full border border-gray-300 shadow-inner flex items-center justify-center">
                    <span className="block w-3 h-3 rounded-full bg-blue-500"></span>
                  </div>
               </button>
               <div className="w-px h-5 bg-gray-200 mx-1"></div>
               <button onClick={handleDuplicateSelection} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 transition-colors" title="Duplicate">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
               </button>
               <button onClick={handleDeleteSelection} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors" title="Delete">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
               </button>

               {showColorPicker && (
                   <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-white shadow-xl rounded-xl border border-gray-200 p-2 grid grid-cols-4 gap-2 w-max animate-in fade-in zoom-in duration-200">
                       {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#000000', '#64748b', '#ffffff'].map(c => (
                           <button 
                               key={c}
                               onClick={() => handleChangeSelectionColor(c)}
                               className="w-6 h-6 rounded-full border border-gray-200 shadow-sm hover:scale-110 transition-transform"
                               style={{ backgroundColor: c }}
                           />
                       ))}
                       <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 border-8 border-transparent border-t-white border-t-8 drop-shadow-sm"></div>
                   </div>
               )}
            </div>
          </div>
        )}

        {textInput && (
            <input 
                ref={(input) => input && input.focus()}
                type="text"
                value={textInput.text}
                onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
                onBlur={() => {
                    if (textInput.text.trim()) {
                        const dummyCanvas = document.createElement('canvas');
                        const ctx = dummyCanvas.getContext('2d');
                        ctx.font = `${brushSize * 3}px sans-serif`;
                        const metrics = ctx.measureText(textInput.text);
                        
                        const newEl = {
                            id: generateId(),
                            type: 'text',
                            tool: 'text',
                            x: textInput.x,
                            y: textInput.y,
                            text: textInput.text,
                            color: brushColor,
                            size: brushSize * 3,
                            w: metrics.width
                        };
                        elementsRef.current = [...elementsRef.current, newEl];
                        setElements(elementsRef.current);
                        if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
                        if (fullRedrawRef.current) fullRedrawRef.current();
                    }
                    setTextInput(null);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.target.blur();
                }}
                style={{
                    position: 'absolute',
                    left: `${textInput.x * zoom + pan.x}px`,
                    top: `${textInput.y * zoom + pan.y}px`,
                    color: brushColor,
                    fontSize: `${brushSize * 3 * zoom}px`,
                    background: 'transparent',
                    border: '1px dashed #ccc',
                    outline: 'none',
                    minWidth: '150px',
                    pointerEvents: 'auto',
                    zIndex: 50,
                    padding: '4px 8px',
                    borderRadius: '4px'
                }}
            />
        )}
      </div>
    </div>
  );
};

export default Board;
