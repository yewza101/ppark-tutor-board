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
import { jsPDF } from 'jspdf';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import html2canvas from 'html2canvas';

const renderMathToImage = async (latex, color, size) => {
    return new Promise((resolve) => {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.top = '-9999px';
        div.style.left = '-9999px';
        div.style.color = color;
        div.style.fontSize = `${size}px`;
        div.style.background = 'transparent';
        document.body.appendChild(div);
        
        try {
            katex.render(latex, div, { throwOnError: false, displayMode: true });
            html2canvas(div, { backgroundColor: null, scale: 2 }).then(canvas => {
                const dataUrl = canvas.toDataURL('image/png');
                document.body.removeChild(div);
                resolve({ dataUrl, width: canvas.width / 2, height: canvas.height / 2 });
            }).catch(() => {
                document.body.removeChild(div);
                resolve(null);
            });
        } catch(e) {
            document.body.removeChild(div);
            resolve(null);
        }
    });
};

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
     const canvas = document.createElement('canvas');
     const ctx = canvas.getContext('2d');
     ctx.font = `${el.size || 20}px sans-serif`;
     const metrics = ctx.measureText(el.text || '');
     minX = el.x; minY = el.y; maxX = el.x + metrics.width; maxY = el.y + (el.size || 20);
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
  const [globalMenuPos, setGlobalMenuPos] = useState(null);
  
  // Drawing state
  const isDrawing = useRef(false);
  const currentPath = useRef(null);
  const startPoint = useRef(null);
  const activePointerId = useRef(null);
  
  // For Pinch to Zoom
  const activePointers = useRef(new Map());
  const lastPinchDist = useRef(null);
  const lastPinchCenter = useRef(null);
  
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
          let parsed = res.data.canvas_data;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch(e) { parsed = []; }
          }
          // Handle double-encoded
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch(e) { parsed = []; }
          }
          if (Array.isArray(parsed)) {
            setElements(parsed);
          }
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
      setElements(prev => {
         const newEls = prev.map(el => el.id === data.element.id ? data.element : el);
         elementsRef.current = newEls;
         return newEls;
      });
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('delete-element', ({ elementId }) => {
      setElements(prev => {
         const newEls = prev.filter(el => el.id !== elementId);
         elementsRef.current = newEls;
         return newEls;
      });
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
    if (!el || !el.type) return;
    try {
      ctx.save();
      ctx.beginPath();
      
      ctx.strokeStyle = el.tool === 'eraser' ? 'rgba(0,0,0,1)' : el.color;
      ctx.globalCompositeOperation = el.tool === 'eraser' ? 'destination-out' : (el.tool === 'highlighter' ? 'multiply' : 'source-over');
      ctx.globalAlpha = el.tool === 'highlighter' ? 0.4 : 1.0;
      
      ctx.lineWidth = el.size || 5;

      if (el.tool === 'laser') {
        ctx.shadowBlur = 15;
        ctx.shadowColor = el.color || '#ff0000';
        ctx.strokeStyle = '#ffffff'; 
        ctx.lineWidth = Math.max(2, (el.size || 5) / 2);
      } else {
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }

      if (el.type === 'lasso') {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / (currentZoom || 1);
        ctx.setLineDash([5 / (currentZoom || 1), 5 / (currentZoom || 1)]);
        ctx.beginPath();
        if (el.points && el.points.length > 0) {
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            if (el.points[i]) ctx.lineTo(el.points[i].x, el.points[i].y);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        return;
      }
      
      if (el.type === 'path') {
        if (el.points && el.points.length > 0) {
          let p2dToDraw = el.path2d;
          if (!p2dToDraw || !(p2dToDraw instanceof Path2D)) {
            const p2d = new Path2D();
            let pts = [];
            const drawSmooth = (points) => {
                if (!points || points.length === 0) return;
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
              if (el.points[i] === null || el.points[i] === undefined) {
                if (pts.length > 0) drawSmooth(pts);
                pts = [];
              } else {
                pts.push(el.points[i]);
              }
            }
            if (pts.length > 0) drawSmooth(pts);
            try { el.path2d = p2d; } catch (e) {} // Ignore if object is frozen by React
            p2dToDraw = p2d;
          }
          ctx.stroke(p2dToDraw);
        }
      } else if (el.type === 'line') {
        ctx.moveTo(el.x1 || 0, el.y1 || 0);
        ctx.lineTo(el.x2 || 0, el.y2 || 0);
        ctx.stroke();
      } else if (el.type === 'rectangle') {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      } else if (el.type === 'circle') {
        const r = Math.sqrt(Math.pow(el.w || 0, 2) + Math.pow(el.h || 0, 2));
        ctx.arc(el.x || 0, el.y || 0, r, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (el.type === 'image' || el.type === 'math') {
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
          ctx.drawImage(img, el.x || 0, el.y || 0, el.w || 100, el.h || 100);
        }
      } else if (el.type === 'text') {
        ctx.font = `${el.size || 20}px sans-serif`;
        ctx.fillStyle = el.color || '#000000';
        ctx.textBaseline = 'top';
        ctx.fillText(el.text || '', el.x || 0, el.y || 0);
      }
    } catch (err) {
      console.error('Failed to draw element:', el, err);
    } finally {
      ctx.restore();
    }
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
    
    // Cleanup unused images from memory to prevent memory leaks
    const currentUrls = new Set(elements.filter(el => el.type === 'image' && el.url).map(el => el.url));
    Object.keys(imageCacheRef.current).forEach(url => {
        if (!currentUrls.has(url)) {
            delete imageCacheRef.current[url];
        }
    });
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
    if (contextMenuPos) setContextMenuPos(null);
    if (globalMenuPos) setGlobalMenuPos(null);
    setShowColorPicker(false);
    
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size === 2) {
        setIsPanning(false);
        setIsDrawing(false); // Cancel any ongoing draw
        
        const pts = Array.from(activePointers.current.values());
        lastPinchDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        lastPinchCenter.current = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2
        };
        return;
    }
    
    if (activePointers.current.size > 2) return;
    
    if (currentTool === 'text' || currentTool === 'math') {
        if (textInput) return; // Prevent overwriting active text input before onBlur fires
        const pos = getMousePos(e);
        setTextInput({ x: pos.x, y: pos.y, text: '', isMath: currentTool === 'math' });
        return;
    }
    
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
      setElements(prev => {
        elementsRef.current = [...prev];
        return elementsRef.current;
      });
      if (fullRedrawRef.current) fullRedrawRef.current();
    }
  };

  const checkObjectEraserCollision = (pos) => {
    const elIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, brushSize));
    if (elIdx !== -1) {
      const deletedEl = elementsRef.current[elIdx];
      if (deletedEl.id) {
        setElements(prev => {
          const newEls = prev.filter(e => e.id !== deletedEl.id);
          elementsRef.current = newEls;
          return newEls;
        });
        if (fullRedrawRef.current) fullRedrawRef.current();
        if (socket && socket.id) {
          socket.emit('delete-element', { boardId: studentId, elementId: deletedEl.id });
        }
      }
    }
  };

  const onPointerMove = (e) => {
    if (activePointers.current.has(e.pointerId)) {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    
    if (activePointers.current.size === 2) {
        const pts = Array.from(activePointers.current.values());
        const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const currentCenter = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2
        };
        
        if (lastPinchDist.current && lastPinchCenter.current) {
            const zoomDelta = currentDist / lastPinchDist.current;
            
            const dx = currentCenter.x - lastPinchCenter.current.x;
            const dy = currentCenter.y - lastPinchCenter.current.y;
            
            const rect = canvasRef.current.getBoundingClientRect();
            const mouseX = currentCenter.x - rect.left;
            const mouseY = currentCenter.y - rect.top;
            
            setZoom(prevZoom => {
               const calculatedZoom = Math.max(0.1, Math.min(5, prevZoom * zoomDelta));
               setPan(prevPan => {
                   const nx = mouseX - (mouseX - (prevPan.x + dx)) * (calculatedZoom / prevZoom);
                   const ny = mouseY - (mouseY - (prevPan.y + dy)) * (calculatedZoom / prevZoom);
                   return { x: nx, y: ny };
               });
               return calculatedZoom;
            });
        }
        
        lastPinchDist.current = currentDist;
        lastPinchCenter.current = currentCenter;
        return;
    }

    const pos = getMousePos(e);
    const now = Date.now();
    const shouldEmit = now - lastEmitTime.current > 50; // Throttle to 20fps to save bandwidth
    
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
        setElements(prev => {
            elementsRef.current = [...prev];
            return elementsRef.current;
        });
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
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
        lastPinchDist.current = null;
        lastPinchCenter.current = null;
    }
    
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

  const handleExport = async () => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      if (elementsRef.current.length === 0) {
          alert('ไม่มีข้อมูลให้ Export (No data to export)');
          return;
      }
      
      elementsRef.current.forEach(el => {
          const bbox = getElementBoundingBox(el);
          if (bbox.minX !== undefined) {
              minX = Math.min(minX, bbox.minX);
              minY = Math.min(minY, bbox.minY);
              maxX = Math.max(maxX, bbox.maxX);
              maxY = Math.max(maxY, bbox.maxY);
          }
      });
      
      const padding = 50;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;
      
      const width = maxX - minX;
      const height = maxY - minY;
      
      if (width <= 0 || height <= 0) return;
      
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = 'wait';
      
      try {
          const exportCanvas = document.createElement('canvas');
          exportCanvas.width = width;
          exportCanvas.height = height;
          const ctx = exportCanvas.getContext('2d');
          
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          
          ctx.save();
          ctx.translate(-minX, -minY);
          
          elementsRef.current.forEach(el => drawElement(ctx, el, 1));
          ctx.restore();
          
          const pdf = new jsPDF('p', 'pt', 'a4');
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = pdf.internal.pageSize.getHeight();
          
          const a4Ratio = pdfWidth / pdfHeight;
          const canvasPageHeight = width / a4Ratio;
          
          let y = 0;
          let pageNum = 1;
          
          while (y < height) {
              if (pageNum > 1) pdf.addPage();
              
              const sliceCanvas = document.createElement('canvas');
              sliceCanvas.width = width;
              sliceCanvas.height = Math.min(canvasPageHeight, height - y);
              const sliceCtx = sliceCanvas.getContext('2d');
              
              sliceCtx.fillStyle = '#ffffff';
              sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
              
              sliceCtx.drawImage(
                  exportCanvas, 
                  0, y, width, sliceCanvas.height, 
                  0, 0, width, sliceCanvas.height
              );
              
              const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
              const renderHeight = (sliceCanvas.height / width) * pdfWidth;
              pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, renderHeight);
              
              y += canvasPageHeight;
              pageNum++;
          }
          
          pdf.save('ppark_board.pdf');
      } catch (err) {
          console.error('Export failed', err);
          alert('Export failed');
      } finally {
          document.body.style.cursor = prevCursor;
      }
  };

  // Toolbar Actions
  const handleUpload = async (file) => {
    try {
      if (file.type === 'application/pdf') {
        // Show simple loading feedback
        const prevCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            let currentY = 50;
            if (elementsRef.current.length > 0) {
                let maxY = -Infinity;
                elementsRef.current.forEach(el => {
                    const bbox = getElementBoundingBox(el);
                    if (bbox.maxY !== undefined && bbox.maxY > maxY) maxY = bbox.maxY;
                });
                if (maxY !== -Infinity) currentY = maxY + 50;
            } else {
                currentY = -pan.y / zoom + 50;
            }

            const newElements = [];
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.5 }); // High resolution
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const uploadFile = new File([blob], `${file.name}_page${i}.png`, { type: 'image/png' });
                
                const formData = new FormData();
                formData.append('file', uploadFile);
                const res = await axios.post(`${API_URL}/api/upload`, formData);
                const publicUrl = res.data.url;
                
                const imgWidth = 800; // Fixed reasonable width on canvas
                const imgHeight = (viewport.height / viewport.width) * imgWidth;
                
                const newEl = {
                    id: generateId(),
                    type: 'image',
                    url: publicUrl,
                    x: -pan.x / zoom + 50,
                    y: currentY,
                    w: imgWidth,
                    h: imgHeight
                };
                
                newElements.push(newEl);
                if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
                
                currentY += imgHeight + 20; // 20px gap
            }
            
            if (newElements.length > 0) {
                setElements(prev => {
                    const newEls = [...prev, ...newElements];
                    elementsRef.current = newEls;
                    return newEls;
                });
                setPastStates(p => [...p, elementsRef.current]);
                setFutureStates([]);
                if (fullRedrawRef.current) fullRedrawRef.current();
            }
        } finally {
            document.body.style.cursor = prevCursor;
        }
        return;
      }

      // Normal Image Upload
      let uploadFile = file;
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
        h: 400
      };

      const img = new Image();
      img.onload = () => {
        newEl.w = Math.min(img.width, 800);
        newEl.h = (img.height / img.width) * newEl.w;
        setElements(prev => {
          const newEls = [...prev, newEl];
          elementsRef.current = newEls;
          return newEls;
        });
        setPastStates(p => [...p, elementsRef.current]);
        setFutureStates([]);
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

  const pasteElements = (els, pos) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      els.forEach(el => {
         const bbox = getElementBoundingBox(el);
         if (bbox.minX !== undefined) {
             minX = Math.min(minX, bbox.minX);
             minY = Math.min(minY, bbox.minY);
             maxX = Math.max(maxX, bbox.maxX);
             maxY = Math.max(maxY, bbox.maxY);
         }
      });
      
      if (minX === Infinity) return;
      
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      
      const targetX = (pos.x - pan.x) / zoom;
      const targetY = (pos.y - pan.y) / zoom;
      
      const dx = targetX - centerX;
      const dy = targetY - centerY;
      
      const newIds = [];
      const clonedElements = [];
      
      els.forEach(el => {
          const clone = JSON.parse(JSON.stringify(el));
          clone.id = generateId();
          
          if (clone.type === 'path') {
              clone.points = clone.points.map(p => p ? { x: p.x + dx, y: p.y + dy } : null);
              clone.path2d = null;
          } else {
              clone.x += dx;
              clone.y += dy;
              if (clone.type === 'line') {
                  clone.x1 += dx;
                  clone.y1 += dy;
              }
          }
          
          clonedElements.push(clone);
          newIds.push(clone.id);
          if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: clone, socketId: socket.id });
      });
      
      if (clonedElements.length > 0) {
          setElements(prev => {
              const newEls = [...prev, ...clonedElements];
              elementsRef.current = newEls;
              return newEls;
          });
          
          setSelectedElementIds(newIds);
          setCurrentTool('select');
          activeLassoPathRef.current = null;
          if (fullRedrawRef.current) fullRedrawRef.current();
      }
  };

  const handlePasteFromClipboard = async (pos) => {
    try {
      setGlobalMenuPos(null);
      
      try {
          const text = await navigator.clipboard.readText();
          if (text) {
              try {
                  const parsed = JSON.parse(text);
                  if (parsed && parsed.type === 'ppark_clipboard' && Array.isArray(parsed.elements)) {
                      pasteElements(parsed.elements, pos);
                      return;
                  }
              } catch (e) {}
          }
      } catch (e) {}

      const localStr = localStorage.getItem('ppark_clipboard');
      if (localStr) {
         try {
            const parsed = JSON.parse(localStr);
            if (parsed && parsed.type === 'ppark_clipboard' && Array.isArray(parsed.elements)) {
                pasteElements(parsed.elements, pos);
                return;
            }
         } catch(e) {}
      }

      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find(t => t.includes('image/')));
          const file = new File([blob], 'pasted-image.png', { type: blob.type });
          const filename = `${Date.now()}_${file.name}`;
          const { data, error } = await supabase.storage.from('board-assests').upload(filename, file);
          if (error) throw error;
          const { data: publicUrlData } = supabase.storage.from('board-assests').getPublicUrl(filename);
          const publicUrl = publicUrlData.publicUrl;
          
          const newEl = {
            id: generateId(),
            type: 'image',
            x: (pos.x - pan.x) / zoom,
            y: (pos.y - pan.y) / zoom,
            url: publicUrl,
            w: 400,
            h: 400
          };
          const img = new Image();
          img.onload = () => {
            newEl.w = Math.min(img.width, 800);
            newEl.h = (img.height / img.width) * newEl.w;
            setElements(prev => {
                const newEls = [...prev, newEl];
                elementsRef.current = newEls;
                return newEls;
            });
            if (fullRedrawRef.current) fullRedrawRef.current();
            if (socket && socket.id) {
              socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
            }
          };
          img.src = publicUrl;
          return;
        } else if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          const newEl = {
              id: generateId(),
              type: 'text',
              tool: 'text',
              x: (pos.x - pan.x) / zoom,
              y: (pos.y - pan.y) / zoom,
              text: text,
              color: brushColor,
              size: brushSize * 3,
              w: 150
          };
          setElements(prev => {
              const newEls = [...prev, newEl];
              elementsRef.current = newEls;
              return newEls;
          });
          if (fullRedrawRef.current) fullRedrawRef.current();
          if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
          return;
        }
      }
    } catch (err) {
      console.error('Failed to paste:', err);
      const localStr = localStorage.getItem('ppark_clipboard');
      if (localStr) {
         try {
            const parsed = JSON.parse(localStr);
            if (parsed && parsed.type === 'ppark_clipboard' && Array.isArray(parsed.elements)) {
                pasteElements(parsed.elements, pos);
                return;
            }
         } catch(e) {}
      }

      try {
        const text = await navigator.clipboard.readText();
        if (text) {
           const newEl = {
               id: generateId(),
               type: 'text',
               tool: 'text',
               x: (pos.x - pan.x) / zoom,
               y: (pos.y - pan.y) / zoom,
               text: text,
               color: brushColor,
               size: brushSize * 3,
               w: 150
           };
           setElements(prev => {
               const newEls = [...prev, newEl];
               elementsRef.current = newEls;
               return newEls;
           });
           if (fullRedrawRef.current) fullRedrawRef.current();
           if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
        }
      } catch(e) {
          alert('ไม่สามารถอ่านข้อมูลจาก Clipboard ได้ โปรดอนุญาตสิทธิ์ (Permission) หรือคัดลอกข้อความ/รูปภาพก่อนครับ');
      }
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
          setElements(prev => {
              elementsRef.current = newElements;
              return newElements;
          });
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
      setElements(prev => {
          elementsRef.current = remainingElements;
          return remainingElements;
      });
      setSelectedElementIds([]);
      activeLassoPathRef.current = null;
      if (fullRedrawRef.current) fullRedrawRef.current();
  };

  const handleCopySelection = async () => {
      const selectedEls = elementsRef.current.filter(el => selectedElementIds.includes(el.id));
      if (selectedEls.length > 0) {
          const clipboardData = { type: 'ppark_clipboard', elements: selectedEls };
          const jsonStr = JSON.stringify(clipboardData);
          try {
              await navigator.clipboard.writeText(jsonStr);
          } catch (err) {
              console.warn('Failed to write to OS clipboard', err);
          }
          localStorage.setItem('ppark_clipboard', jsonStr);
          setContextMenuPos(null);
      }
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
                  clone.path2d = null;
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
          setElements(prev => {
              const newEls = [...prev, ...clonedElements];
              elementsRef.current = newEls;
              return newEls;
          });
          
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
        handleExport={handleExport}
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
             const rect = canvasRef.current.getBoundingClientRect();
             const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
             
             if (selectedElementIds.length > 0) {
                 // Check if clicking inside lasso bounds
                 if (dragContext.current && dragContext.current.gMinX !== undefined) {
                     if (pos.x >= dragContext.current.gMinX && pos.x <= dragContext.current.gMaxX && pos.y >= dragContext.current.gMinY && pos.y <= dragContext.current.gMaxY) {
                         setContextMenuPos(pos);
                         setGlobalMenuPos(null);
                         return;
                     }
                 }
                 setContextMenuPos(pos);
                 setGlobalMenuPos(null);
             } else {
                 setGlobalMenuPos(pos);
                 setContextMenuPos(null);
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
               <button onClick={handleCopySelection} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 transition-colors" title="Copy">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
               </button>
               <button onClick={handleDuplicateSelection} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 transition-colors" title="Duplicate">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"></path></svg>
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

        {globalMenuPos && (
          <div 
            className="absolute z-30 flex flex-col items-center pointer-events-auto animate-in fade-in duration-100"
            style={{ 
                left: `${globalMenuPos.x}px`, 
                top: `${globalMenuPos.y}px`,
                transform: 'translate(-50%, 15px)'
            }}
          >
            <div className="bg-white shadow-xl rounded-xl flex flex-col min-w-[160px] py-1 border border-gray-100 relative">
               <button 
                  onClick={() => handlePasteFromClipboard(globalMenuPos)} 
                  className="flex items-center gap-3 px-4 py-2 hover:bg-blue-50 hover:text-blue-600 text-gray-700 transition-colors text-sm font-medium"
               >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  Paste
               </button>
               <button 
                  onClick={() => {
                      setCurrentTool('text');
                      setTextInput({ x: (globalMenuPos.x - pan.x)/zoom, y: (globalMenuPos.y - pan.y)/zoom, text: '' });
                      setGlobalMenuPos(null);
                  }} 
                  className="flex items-center gap-3 px-4 py-2 hover:bg-blue-50 hover:text-blue-600 text-gray-700 transition-colors text-sm font-medium"
               >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
                  Add Text
               </button>
               <div className="h-px bg-gray-100 my-1 mx-2"></div>
               <button 
                  onClick={() => {
                      setSelectedElementIds(elementsRef.current.map(el => el.id));
                      setGlobalMenuPos(null);
                      setCurrentTool('select');
                      if (fullRedrawRef.current) fullRedrawRef.current();
                  }} 
                  className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-gray-700 transition-colors text-sm font-medium"
               >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"></path></svg>
                  Select All
               </button>
               <button 
                  onClick={() => {
                      handleClear();
                      setGlobalMenuPos(null);
                  }} 
                  className="flex items-center gap-3 px-4 py-2 hover:bg-red-50 text-red-500 transition-colors text-sm font-medium"
               >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                  Clear Board
               </button>

               <div className="absolute -top-2 left-1/2 -translate-x-1/2 border-8 border-transparent border-b-white border-b-8 drop-shadow-sm"></div>
            </div>
          </div>
        )}

        {textInput && (
            <input 
                ref={(input) => {
                    if (input && !input.dataset.focused) {
                        input.dataset.focused = "true";
                        // Use a short timeout to ensure DOM is ready and iOS keyboard triggers
                        setTimeout(() => input.focus(), 10);
                    }
                }}
                type="text"
                value={textInput.text}
                onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
                onBlur={async () => {
                    if (textInput.text.trim()) {
                        if (textInput.isMath) {
                            const result = await renderMathToImage(textInput.text, brushColor, brushSize * 4);
                            if (result) {
                                const newEl = {
                                    id: generateId(),
                                    type: 'math',
                                    tool: 'math',
                                    x: textInput.x,
                                    y: textInput.y,
                                    text: textInput.text,
                                    url: result.dataUrl,
                                    color: brushColor,
                                    size: brushSize * 4,
                                    w: result.width,
                                    h: result.height
                                };
                                setElements(prev => {
                                    const newEls = [...prev, newEl];
                                    elementsRef.current = newEls;
                                    return newEls;
                                });
                                if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
                                if (fullRedrawRef.current) fullRedrawRef.current();
                            }
                        } else {
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
                            setElements(prev => {
                                const newEls = [...prev, newEl];
                                elementsRef.current = newEls;
                                return newEls;
                            });
                            if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
                            if (fullRedrawRef.current) fullRedrawRef.current();
                        }
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
