import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import { ArrowLeft, Trash2 } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import Toolbar from '../components/Toolbar';
import { API_URL } from '../config';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
import { jsPDF } from 'jspdf';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import html2canvas from 'html2canvas';
import { getStroke } from 'perfect-freehand';

const getSvgPathFromStroke = (stroke) => {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
};

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
  
  let checkPt = pt;
  if (el.rotation && (el.type === 'image' || el.type === 'math' || el.type === 'rectangle')) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    checkPt = rotatePoint(pt.x, pt.y, cx, cy, -el.rotation);
  }
  
  
      if (el.type === 'polygon' || el.type === 'polyline' || el.isSnapped || el.isSnappedAngle) {
          ctx.beginPath();
          if (el.points && el.points.length > 0) {
              ctx.moveTo(el.points[0].x, el.points[0].y);
              for (let i = 1; i < el.points.length; i++) {
                  if (el.points[i]) ctx.lineTo(el.points[i].x, el.points[i].y);
              }
              if (el.type === 'polygon') ctx.closePath();
              ctx.stroke();
          }
          
          if (el.type === 'polygon' || el.isSnappedAngle) {
             ctx.fillStyle = '#ef4444';
             ctx.font = '16px sans-serif';
             const pts = el.points.filter(p => p);
             const len = pts.length;
             for (let i = 0; i < len; i++) {
                 let prev = pts[(i - 1 + len) % len];
                 let curr = pts[i];
                 let next = pts[(i + 1) % len];
                 if (el.type !== 'polygon' && (i === 0 || i === len - 1)) continue;
                 const angle = getAngle(prev, curr, next);
                 if (!isNaN(angle)) {
                     const deg = Math.round(angle * (180 / Math.PI));
                     ctx.fillText(deg + '°', curr.x + 10, curr.y + 10);
                 }
             }
          }
          ctx.restore();
          return;
      }
      
      if (el.type === 'triangle') {
        ctx.beginPath();
        const p1 = {x: el.x + el.w / 2, y: el.y};
        const p2 = {x: el.x + el.w, y: el.y + el.h};
        const p3 = {x: el.x, y: el.y + el.h};
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.stroke();
        
        ctx.fillStyle = '#ef4444'; ctx.font = '16px sans-serif';
        const a1 = getAngle(p3, p1, p2) * (180/Math.PI);
        const a2 = getAngle(p1, p2, p3) * (180/Math.PI);
        const a3 = getAngle(p2, p3, p1) * (180/Math.PI);
        if (!isNaN(a1)) ctx.fillText(Math.round(a1) + '°', p1.x - 10, p1.y + 25);
        if (!isNaN(a2)) ctx.fillText(Math.round(a2) + '°', p2.x - 30, p2.y - 10);
        if (!isNaN(a3)) ctx.fillText(Math.round(a3) + '°', p3.x + 10, p3.y - 10);
      }
      
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
    return distancePointToSegment(pt, {x: el.x1, y: el.y1}, {x: el.x2, y: el.y2}) < hitRadius;
  } else if (el.type === 'rectangle') {
    const v1 = {x: el.x, y: el.y};
    const v2 = {x: el.x + el.w, y: el.y};
    const v3 = {x: el.x + el.w, y: el.y + el.h};
    const v4 = {x: el.x, y: el.y + el.h};
    return distancePointToSegment(pt, v1, v2) < hitRadius ||
           distancePointToSegment(pt, v2, v3) < hitRadius ||
           distancePointToSegment(pt, v3, v4) < hitRadius ||
           distancePointToSegment(pt, v4, v1) < hitRadius;
  } else if (el.type === 'image' || el.type === 'math' || el.type === 'postit') {
      return pt.x >= el.x && pt.x <= (el.x + (el.w || 100)) && pt.y >= el.y && pt.y <= (el.y + (el.h || 100));
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


const rotatePoint = (px, py, cx, cy, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const nx = (cos * (px - cx)) - (sin * (py - cy)) + cx;
  const ny = (sin * (px - cx)) + (cos * (py - cy)) + cy;
  return { x: nx, y: ny };
};


// --- Shape Recognition Helpers ---
const distancePointToLine = (p, l1, l2) => {
    const num = Math.abs((l2.y - l1.y)*p.x - (l2.x - l1.x)*p.y + l2.x*l1.y - l2.y*l1.x);
    const den = Math.hypot(l2.y - l1.y, l2.x - l1.x);
    return den === 0 ? Math.hypot(p.x - l1.x, p.y - l1.y) : num / den;
};

const getAngle = (p1, p2, p3) => {
    const a = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const b = Math.hypot(p2.x - p3.x, p2.y - p3.y);
    const c = Math.hypot(p3.x - p1.x, p3.y - p1.y);
    return Math.acos((a*a + b*b - c*c) / (2 * a * b));
};

const simplifyPath = (points, tolerance = 5) => {
    if (points.length <= 2) return points;
    let maxDist = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
        const d = distancePointToLine(points[i], points[0], points[end]);
        if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > tolerance) {
        const left = simplifyPath(points.slice(0, index + 1), tolerance);
        const right = simplifyPath(points.slice(index), tolerance);
        return left.slice(0, left.length - 1).concat(right);
    }
    return [points[0], points[end]];
};

const recognizeShape = (pts) => {
    if (pts.length < 10) return null;
    
    // Check if closed
    const start = pts[0];
    const end = pts[pts.length - 1];
    const isClosed = Math.hypot(start.x - end.x, start.y - end.y) < 50;
    
    const simplified = simplifyPath(pts, 15);
    
    if (isClosed) {
        // Circle vs Poly
        if (simplified.length < 4) return null; 
        if (simplified.length === 4) return { type: 'triangle', points: simplified.slice(0, 3) };
        if (simplified.length === 5) {
            // Check if it's rectangle-like (angles ~90)
            return { type: 'rectangle', points: simplified.slice(0, 4) };
        }
        // If many points, probably circle
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(p => {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
        const w = maxX - minX, h = maxY - minY;
        const cx = minX + w/2, cy = minY + h/2;
        const r = (w + h) / 4;
        return { type: 'circle', x: cx, y: cy, r };
    } else {
        // Line vs Angle
        if (simplified.length === 2) return { type: 'line', points: simplified };
        if (simplified.length === 3) return { type: 'angle', points: simplified };
        return null;
    }
};
// --------------------------------

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
  if (el.type === 'path' || el.type === 'polygon' || el.type === 'polyline' || el.isSnapped || el.isSnappedAngle) {
     if (el.bbox && el.type === 'path') {
         minX = el.bbox.minX; minY = el.bbox.minY; maxX = el.bbox.maxX; maxY = el.bbox.maxY;
     } else {
         const validPoints = el.points ? el.points.filter(p => p !== null) : [];
         if (validPoints.length === 0) return {};
         minX = Math.min(...validPoints.map(p => p.x));
         minY = Math.min(...validPoints.map(p => p.y));
         maxX = Math.max(...validPoints.map(p => p.x));
         maxY = Math.max(...validPoints.map(p => p.y));
         if (el.type === 'path') el.bbox = { minX, minY, maxX, maxY };
     }
  } else if (el.type === 'line') {
     minX = Math.min(el.x1, el.x2);
     minY = Math.min(el.y1, el.y2);
     maxX = Math.max(el.x1, el.x2);
     maxY = Math.max(el.y1, el.y2);
  } else if (el.type === 'circle') {
     const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));
     minX = el.x - r; minY = el.y - r; maxX = el.x + r; maxY = el.y + r;
  } else if (el.type === 'rectangle' || el.type === 'image' || el.type === 'math' || el.type === 'postit') {
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
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const queryGroup = searchParams.get('group');
  const isReadonly = searchParams.get('readonly') === 'true';
  const returnGroup = location.state?.returnToGroup || queryGroup;
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
  const [penMode, setPenMode] = useState(false);
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
  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [isPresentationMode, setIsPresentationMode] = useState(false);

  const clampPan = useCallback((nx, ny, currentZoom = zoom) => {
    const docPages = elementsRef.current.filter(el => el.isPage);
    if (docPages.length === 0) return { x: nx, y: ny };
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    docPages.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.w > maxX) maxX = p.x + p.w;
      if (p.y + p.h > maxY) maxY = p.y + p.h;
    });
    
    const padding = 100;
    const maxYPan = -(minY - padding) * currentZoom;
    const minYPan = viewportSize.h - (maxY + padding) * currentZoom;
    const maxXPan = -(minX - padding) * currentZoom;
    const minXPan = viewportSize.w - (maxX + padding) * currentZoom;
    
    let resX = nx;
    let resY = ny;
    
    if (minXPan > maxXPan) {
        resX = (viewportSize.w - (maxX - minX) * currentZoom) / 2 - minX * currentZoom;
    } else {
        resX = Math.max(minXPan, Math.min(maxXPan, resX));
    }
    
    if (minYPan > maxYPan) {
        resY = (viewportSize.h - (maxY - minY) * currentZoom) / 2 - minY * currentZoom;
    } else {
        resY = Math.max(minYPan, Math.min(maxYPan, resY));
    }
    return { x: resX, y: resY };
  }, [zoom, viewportSize]);

  // Keep track of window size
  useEffect(() => {
    const handleResize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Broadcast viewport changes with throttle/debounce to prevent network flooding
  const lastViewportEmitRef = useRef(0);
  useEffect(() => {
    if (socket && socket.connected) {
      const emitViewport = () => {
        lastViewportEmitRef.current = Date.now();
        socket.emit('viewport-update', {
          boardId: studentId,
          pan,
          zoom,
          width: viewportSize.w,
          height: viewportSize.h,
          socketId: socket.id,
          isPresentationMode
        });
      };

      const now = Date.now();
      if (now - lastViewportEmitRef.current > 50) {
        emitViewport();
      } else {
        const handler = setTimeout(emitViewport, 50);
        return () => clearTimeout(handler);
      }
    }
  }, [socket, pan, zoom, viewportSize, studentId, isPresentationMode]);

  // Heartbeat to sync viewport for newly joined admins
  useEffect(() => {
    if (!socket) return;
    const interval = setInterval(() => {
      if (socket.connected) {
        socket.emit('viewport-update', {
          boardId: studentId,
          pan,
          zoom,
          width: viewportSize.w,
          height: viewportSize.h,
          socketId: socket.id,
          isPresentationMode
        });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [socket, pan, zoom, viewportSize, studentId, isPresentationMode]);

  // Emit force-presentation when admin toggles it on the teacher_board
  useEffect(() => {
    if (socket && user?.role === 'admin' && studentId === 'teacher_board') {
      socket.emit('force-presentation', isPresentationMode);
    }
  }, [socket, user, studentId, isPresentationMode]);

  // Listen for global force-presentation to show PIP
  const [showPIP, setShowPIP] = useState(false);
  useEffect(() => {
    if (!socket || !user) return;
    const handleForcePresentation = (isActive) => {
      // Only students show the PIP (and admins who are not on the teacher_board maybe? Let's just do it for students)
      if (user.role !== 'admin' && !isReadonly) {
        setShowPIP(isActive);
      }
    };
    socket.on('force-presentation', handleForcePresentation);
    return () => socket.off('force-presentation', handleForcePresentation);
  }, [socket, user, isReadonly]);

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

  const snapShapeTimeoutRef = useRef(null);

  const performSmartSnap = () => {
    if (!isDrawing.current || !currentPath.current) return;
    if (currentPath.current.tool !== 'pencil' && currentPath.current.tool !== 'highlighter') return;
    const pts = currentPath.current.points.filter(p => p !== null);
    
    const shape = recognizeShape(pts);
    if (!shape) return;
    
    if (shape.type === 'line' || shape.type === 'angle') {
       currentPath.current.points = shape.points;
       currentPath.current.isSnappedAngle = (shape.type === 'angle');
       currentPath.current.isSnapped = (shape.type === 'line');
    } else if (shape.type === 'triangle' || shape.type === 'rectangle') {
       currentPath.current.type = 'polygon';
       currentPath.current.points = shape.points;
    } else if (shape.type === 'circle') {
       currentPath.current.type = 'circle';
       currentPath.current.x = shape.x;
       currentPath.current.y = shape.y;
       currentPath.current.w = shape.r;
       currentPath.current.h = 0; // r is used in my updated draw logic
    }
    currentPath.current.path2d = null;
    if (redrawDraftRef.current) redrawDraftRef.current();
  };

  const currentPath = useRef(null);
  const startPoint = useRef(null);
  const activePointerId = useRef(null);
  
  // For Pinch to Zoom
  const activePointers = useRef(new Map());
  const fadingLasersRef = useRef([]);
  const animationFrameRef = useRef(null);
  const lastPinchDist = useRef(null);
  const lastPinchCenter = useRef(null);
  
  const remotePaths = useRef({});
  const lastEmitTime = useRef(0);
  const lastEraserPos = useRef(null);

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

    newSocket.emit('join-board', { boardId: studentId, role: 'student' });
    newSocket.emit('viewport-update', {
      boardId: studentId,
      pan: { x: 0, y: 0 },
      zoom: 1,
      width: window.innerWidth,
      height: window.innerHeight,
      socketId: newSocket.id
    });

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

    newSocket.on('laser-fade', (data) => {
        if (data.stroke) {
            fadingLasersRef.current.push({ ...data.stroke, fadeStartTime: Date.now() });
            startLaserFadeAnimation();
        }
        if (data.socketId && remotePaths.current[data.socketId]) {
            delete remotePaths.current[data.socketId];
        }
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
        elementsRef.current = [];
        return [];
      });
      if (fullRedrawRef.current) fullRedrawRef.current();
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

    newSocket.on('viewport-update', (data) => {
      // If the admin is presenting, force students to follow their viewport
      if (data.isPresentationMode && user?.role !== 'admin') {
        const adminCenterX = -data.pan.x / data.zoom + data.width / (2 * data.zoom);
        const adminCenterY = -data.pan.y / data.zoom + data.height / (2 * data.zoom);
        
        const newPanX = -(adminCenterX * data.zoom) + window.innerWidth / 2;
        const newPanY = -(adminCenterY * data.zoom) + window.innerHeight / 2;
        
        setZoom(data.zoom);
        setPan(clampPan(newPanX, newPanY, data.zoom));
      }
    });

    return () => newSocket.disconnect();
  }, [studentId, user, token, navigate]);

  // We need to keep a ref to the latest redraw to avoid stale closures in socket events
  const redrawRef = useRef(null);

  const drawElement = useCallback((ctx, el, currentZoom) => {
    if (!el || !el.type) return;
    try {
      ctx.save();
      if (el.rotation) {
          const cx = (el.x || 0) + (el.w || 0) / 2;
          const cy = (el.y || 0) + (el.h || 0) / 2;
          ctx.translate(cx, cy);
          ctx.rotate(el.rotation);
          ctx.translate(-cx, -cy);
      }
      ctx.beginPath();
      
      ctx.strokeStyle = el.tool === 'eraser' ? 'rgba(0,0,0,1)' : el.color;
      ctx.fillStyle = ctx.strokeStyle;
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
            
            const drawFreehand = (points) => {
                if (!points || points.length === 0) return;
                
                // Get stroke outline polygon
                const strokePoints = getStroke(points, {
                    size: el.size || 5,
                    thinning: 0.5,
                    smoothing: 0.5,
                    streamline: 0.5,
                    simulatePressure: true
                });
                
                const pathData = getSvgPathFromStroke(strokePoints);
                if (pathData) {
                    const segmentP2d = new Path2D(pathData);
                    p2d.addPath(segmentP2d);
                }
            };

            for (let i = 0; i < el.points.length; i++) {
              if (el.points[i] === null || el.points[i] === undefined) {
                if (pts.length > 0) drawFreehand(pts);
                pts = [];
              } else {
                pts.push(el.points[i]);
              }
            }
            if (pts.length > 0) drawFreehand(pts);
            
            try { el.path2d = p2d; } catch (e) {} // Ignore if object is frozen by React
            p2dToDraw = p2d;
          }
          
          ctx.fill(p2dToDraw);
        }
      } else 
      if (el.type === 'line') {
        ctx.moveTo(el.x1 || 0, el.y1 || 0);
        ctx.lineTo(el.x2 || 0, el.y2 || 0);
        ctx.stroke();
        
        const a = Math.atan2((el.y2||0) - (el.y1||0), (el.x2||0) - (el.x1||0)) * (180/Math.PI);
        ctx.fillStyle = '#ef4444'; ctx.font = '16px sans-serif';
        ctx.fillText(Math.round(Math.abs(a)) + '°', (el.x2||0) + 10, (el.y2||0) + 10);
      } else if (el.type === 'rectangle') {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
        
        ctx.fillStyle = '#ef4444'; ctx.font = '16px sans-serif';
        ctx.fillText('90°', el.x + 10, el.y + 20);
        ctx.fillText('90°', el.x + el.w - 30, el.y + 20);
        ctx.fillText('90°', el.x + 10, el.y + el.h - 10);
        ctx.fillText('90°', el.x + el.w - 30, el.y + el.h - 10);
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
            img.onerror = () => {
              imageCacheRef.current[el.url] = 'error';
            };
            imageCacheRef.current[el.url] = 'loading';
          } else if (imageCacheRef.current[el.url] !== 'loading') {
            const img = imageCacheRef.current[el.url];
            if (el.type === 'image') {
              ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
              ctx.shadowBlur = 15;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 4;
            }
            ctx.drawImage(img, el.x || 0, el.y || 0, el.w || 100, el.h || 100);
            if (el.type === 'image') {
              ctx.shadowColor = 'transparent';
              ctx.shadowBlur = 0;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
            }
          }
      } else if (el.type === 'text') {
        ctx.font = `${el.size || 20}px sans-serif`;
        ctx.fillStyle = el.color || '#000000';
        ctx.textBaseline = 'top';
        ctx.fillText(el.text || '', el.x || 0, el.y || 0);
      } else if (el.type === 'postit') {
        const padding = 12;
        const fontSize = el.size || 20;
        ctx.font = `${fontSize}px "Comic Sans MS", "Caveat", cursive, sans-serif`;
        ctx.textBaseline = 'top';
        
        const lines = (el.text || '').split('\n');
        let maxTextW = 50;
        for(let line of lines) {
           const w = ctx.measureText(line).width;
           if (w > maxTextW) maxTextW = w;
        }
        
        const w = maxTextW + (padding * 2);
        const h = (lines.length * (fontSize * 1.5)) + (padding * 2);
        
        // Save bounds back for hit testing
        el.w = w;
        el.h = h;
        
        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        // Post-it body
        ctx.fillStyle = el.color || '#fef08a';
        ctx.fillRect(el.x || 0, el.y || 0, w, h);
        
        // Reset shadow
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowColor = 'transparent';
        
        // Text
        ctx.fillStyle = '#000000';
        lines.forEach((line, i) => {
            ctx.fillText(line, (el.x || 0) + padding, (el.y || 0) + padding + (i * fontSize * 1.5));
        });
      }
      
      // Draw lock indicator for locked elements
      if (el.locked) {
        const box = getElementBoundingBox(el);
        if (box.minX !== undefined) {
          const iconSize = 16 / (zoomLevel || 1);
          const ix = box.minX - iconSize * 0.5;
          const iy = box.minY - iconSize * 1.2;
          ctx.save();
          ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
          ctx.beginPath();
          // Lock body
          const bx = ix, by = iy + iconSize * 0.4;
          const bw = iconSize, bh = iconSize * 0.6;
          ctx.roundRect(bx, by, bw, bh, iconSize * 0.1);
          ctx.fill();
          // Lock shackle
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.7)';
          ctx.lineWidth = iconSize * 0.15;
          ctx.beginPath();
          ctx.arc(ix + iconSize * 0.5, iy + iconSize * 0.4, iconSize * 0.3, Math.PI, 0);
          ctx.stroke();
          ctx.restore();
        }
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
    
    const docPages = elementsRef.current.filter(el => el.isPage);
    const isDocumentMode = docPages.length > 0;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = isDocumentMode ? '#d1d5db' : '#ffffff'; // Grey background if in document mode
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    
    // Calculate visible bounds for culling
    const vMinX = -pan.x / zoom;
    const vMinY = -pan.y / zoom;
    const vMaxX = (canvas.width - pan.x) / zoom;
    const vMaxY = (canvas.height - pan.y) / zoom;

    const isVisible = (el) => {
        const box = getElementBoundingBox(el);
        if (box.minX === undefined) return true; // Draw if bounds unknown
        return !(box.maxX < vMinX || box.minX > vMaxX || box.maxY < vMinY || box.minY > vMaxY);
    };
    
    if (!isDocumentMode && bgTemplate !== 'blank') {
       ctx.strokeStyle = '#e5e7eb';
       ctx.lineWidth = 1 / zoom;
       
       ctx.beginPath();
       if (bgTemplate === 'lined' || bgTemplate === 'grid') {
           const spacing = 40;
           const firstLineY = Math.floor(vMinY / spacing) * spacing;
           for (let y = firstLineY; y < vMaxY; y += spacing) {
               ctx.moveTo(vMinX, y);
               ctx.lineTo(vMaxX, y);
           }
           if (bgTemplate === 'grid') {
               const firstLineX = Math.floor(vMinX / spacing) * spacing;
               for (let x = firstLineX; x < vMaxX; x += spacing) {
                   ctx.moveTo(x, vMinY);
                   ctx.lineTo(x, vMaxY);
               }
           }
           ctx.stroke();
       } else if (bgTemplate === 'dot') {
           const spacing = 40;
           ctx.fillStyle = '#d1d5db';
           const firstLineY = Math.floor(vMinY / spacing) * spacing;
           const firstLineX = Math.floor(vMinX / spacing) * spacing;
           for (let y = firstLineY; y < vMaxY; y += spacing) {
               for (let x = firstLineX; x < vMaxX; x += spacing) {
                   ctx.beginPath();
                   ctx.arc(x, y, 2 / zoom, 0, Math.PI * 2);
                   ctx.fill();
               }
           }
       }
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw images first (including Document Pages), cull invisible ones
    elementsRef.current.filter(el => el.type === 'image' && isVisible(el)).forEach(el => drawElement(ctx, el, zoom));

    // If in Document Mode, clip drawing to the pages ONLY
    if (isDocumentMode) {
        ctx.beginPath();
        docPages.forEach(el => {
            // Include a tiny bit of padding to prevent edge cutting issues
            ctx.rect(el.x - 1, el.y - 1, el.w + 2, el.h + 2);
        });
        ctx.clip();
    }

    // Draw other elements, cull invisible ones
    elementsRef.current.filter(el => el.type !== 'image' && isVisible(el)).forEach(el => drawElement(ctx, el, zoom));
    ctx.restore();
  }, [zoom, pan, bgTemplate, drawElement]);

  const redrawDraft = useCallback(() => {
    const canvas = draftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Transparent!
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const docPages = elementsRef.current.filter(el => el.isPage);
    const isDocumentMode = docPages.length > 0;
    
    if (isDocumentMode) {
        ctx.beginPath();
        docPages.forEach(el => {
            ctx.rect(el.x, el.y, el.w, el.h);
        });
        ctx.clip();
    }

    if (currentPath.current) drawElement(ctx, currentPath.current, zoom);
    Object.values(remotePaths.current).forEach(el => drawElement(ctx, el, zoom));

    // Draw fading lasers
    const now = Date.now();
    fadingLasersRef.current.forEach(laser => {
        const elapsed = now - laser.fadeStartTime;
        let alpha = 1.0;
        if (elapsed > 2000) {
            alpha = 1.0 - (elapsed - 2000) / 1000;
        }
        if (alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            drawElement(ctx, laser, zoom);
            ctx.restore();
        }
    });

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
            ctx.setLineDash([]);
        }
        
        let isSpecialSingle = false;
                if (selectedElementIds.length === 1) {
            ctx.setLineDash([]);
            const el = elementsRef.current.find(e => e.id === selectedElementIds[0]);
            
            
            if (el && el.type === 'circle') {
                isSpecialSingle = true;
                ctx.save();
                ctx.fillStyle = '#ffffff';
                const hs = 8 / zoom;
                
                // Center point
                ctx.beginPath();
                ctx.arc(el.x, el.y, hs, 0, Math.PI*2);
                ctx.fill(); ctx.stroke();
                
                // Radius point
                const r = Math.sqrt(Math.pow(el.w || 0, 2) + Math.pow(el.h || 0, 2));
                ctx.beginPath();
                ctx.arc(el.x + r, el.y, hs, 0, Math.PI*2);
                ctx.fill(); ctx.stroke();
                
                ctx.restore();
            }
            if (el && el.type === 'polygon') {
                isSpecialSingle = true;
                ctx.save();
                ctx.fillStyle = '#ffffff';
                const hs = 8 / zoom;
                el.points.forEach(pt => {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, hs, 0, Math.PI*2);
                    ctx.fill();
                    ctx.stroke();
                });
                ctx.restore();
            }
            
            if (el && (el.type === 'image' || el.type === 'math' || el.type === 'rectangle')) {
                isSpecialSingle = true;
                const cx = el.x + el.w / 2;
                const cy = el.y + el.h / 2;
                ctx.save();
                if (el.rotation) {
                    ctx.translate(cx, cy);
                    ctx.rotate(el.rotation);
                    ctx.translate(-cx, -cy);
                }
                ctx.strokeRect(el.x - pad, el.y - pad, el.w + pad*2, el.h + pad*2);
                
                ctx.fillStyle = '#ffffff';
                const hs = 12 / zoom;
                // Scale handle
                ctx.fillRect(el.x + el.w + pad - hs/2, el.y + el.h + pad - hs/2, hs, hs);
                ctx.strokeRect(el.x + el.w + pad - hs/2, el.y + el.h + pad - hs/2, hs, hs);
                
                // Rotate handle
                ctx.beginPath();
                ctx.arc(el.x + el.w / 2, el.y - pad - 20/zoom, hs/2, 0, Math.PI*2);
                ctx.fill();
                ctx.stroke();
                
                // Line connecting rotate handle to box
                ctx.beginPath();
                ctx.moveTo(el.x + el.w / 2, el.y - pad);
                ctx.lineTo(el.x + el.w / 2, el.y - pad - 20/zoom + hs/2);
                ctx.stroke();
                
                ctx.restore();
            }
        }
        
        if (!isSpecialSingle && selectedElementIds.length > 0) {
            ctx.strokeRect(gMinX - pad, gMinY - pad, gMaxX - gMinX + pad*2, gMaxY - gMinY + pad*2);
            ctx.setLineDash([]);
            ctx.fillStyle = '#ffffff';
            const hs = 12 / zoom;
            
            // Scale handle
            ctx.fillRect(gMaxX + pad - hs/2, gMaxY + pad - hs/2, hs, hs);
            ctx.strokeRect(gMaxX + pad - hs/2, gMaxY + pad - hs/2, hs, hs);
            
            // Rotate handle
            ctx.beginPath();
            ctx.arc((gMinX + gMaxX) / 2, gMinY - pad - 20/zoom, hs/2, 0, Math.PI*2);
            ctx.fill();
            ctx.stroke();
            
            // Line connecting rotate handle to box
            ctx.beginPath();
            ctx.moveTo((gMinX + gMaxX) / 2, gMinY - pad);
            ctx.lineTo((gMinX + gMaxX) / 2, gMinY - pad - 20/zoom + hs/2);
            ctx.stroke();
        }
      }
    }
    ctx.restore();
  }, [zoom, pan, selectedElementIds, drawElement]);

  const startLaserFadeAnimation = useCallback(() => {
    if (!animationFrameRef.current) {
        const animate = () => {
            const now = Date.now();
            let hasFading = false;
            
            fadingLasersRef.current = fadingLasersRef.current.filter(laser => {
                const isAnyLaserDrawing = 
                    (isDrawing.current && currentTool === 'laser') || 
                    Object.values(remotePaths.current).some(path => path && path.tool === 'laser');
                
                if (isAnyLaserDrawing) {
                    laser.fadeStartTime = now;
                }
                
                const elapsed = now - laser.fadeStartTime;
                if (elapsed < 3000) {
                    hasFading = true;
                    return true;
                }
                return false;
            });
            
            if (hasFading) {
                if (redrawDraftRef.current) redrawDraftRef.current();
                animationFrameRef.current = requestAnimationFrame(animate);
            } else {
                if (redrawDraftRef.current) redrawDraftRef.current();
                animationFrameRef.current = null;
            }
        };
        animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [redrawDraft]);

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
    const currentUrls = new Set(elements.filter(el => (el.type === 'image' || el.type === 'math') && el.url).map(el => el.url));
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
      y: (e.clientY - rect.top - pan.y) / zoom,
      pressure: e.pressure !== undefined ? e.pressure : 0.5
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
    
    if (currentTool === 'text' || currentTool === 'math' || currentTool === 'postit') {
        if (textInput) return; // Prevent overwriting active text input before onBlur fires
        const pos = getMousePos(e);
        setTextInput({ x: pos.x, y: pos.y, text: '', isMath: currentTool === 'math', isPostit: currentTool === 'postit', color: brushColor });
        return;
    }
    
    if (activePointerId.current !== null) return; // Ignore multitouch secondary fingers
    activePointerId.current = e.pointerId;

    // Middle click or Space + Click for panning, or Pen Mode with touch
    if (e.button === 1 || e.altKey || currentTool === 'pan' || (penMode && e.pointerType === 'touch')) {
      setIsPanning(true);
      startPoint.current = { x: e.clientX, y: e.clientY };
      e.target.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return; // Only left click for drawing

    if (currentTool === 'select' || currentTool === 'image') {
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
        
        if (selectedElementIds.length === 1) {
            const el = elementsRef.current.find(e => e.id === selectedElementIds[0]);
            if (el && el.type === 'polygon') {
                const hs = 25 / zoom;
                let clickedVertex = -1;
                let localPos = pos;
                for (let i = 0; i < el.points.length; i++) {
                    if (Math.hypot(localPos.x - el.points[i].x, localPos.y - el.points[i].y) <= hs) {
                        clickedVertex = i;
                        break;
                    }
                }
                if (clickedVertex !== -1) {
                    dragContext.current = {
                        type: 'vertex', vertexIndex: clickedVertex, startX: pos.x, startY: pos.y,
                        origElements: [JSON.parse(JSON.stringify(el))]
                    };
                    startPoint.current = { x: e.clientX, y: e.clientY };
                    isDrawing.current = true;
                    e.target.setPointerCapture(e.pointerId);
                    return;
                }
            }
            if (el && (el.type === 'image' || el.type === 'math' || el.type === 'rectangle')) {
                let localPos = pos;
                if (el.rotation) {
                    localPos = rotatePoint(pos.x, pos.y, el.x + el.w/2, el.y + el.h/2, -el.rotation);
                }
                const cx = el.x + el.w / 2;
                const cy = el.y - pad - 20/zoom;
                
                if (Math.hypot(localPos.x - cx, localPos.y - cy) <= hs) {
                    dragContext.current = {
                        type: 'rotate', startX: pos.x, startY: pos.y,
                        origAngle: el.rotation || 0,
                        cx: el.x + el.w/2, cy: el.y + el.h/2,
                        origElements: [JSON.parse(JSON.stringify(el))]
                    };
                    startPoint.current = { x: e.clientX, y: e.clientY };
                    isDrawing.current = true;
                    e.target.setPointerCapture(e.pointerId);
                    return;
                }
                
                if (localPos.x >= el.x + el.w + pad - hs && localPos.x <= el.x + el.w + pad + hs &&
                    localPos.y >= el.y + el.h + pad - hs && localPos.y <= el.y + el.h + pad + hs) {
                    dragContext.current = {
                        type: 'scale', startX: pos.x, startY: pos.y,
                        isMoved: false,
                        gMinX: el.x, gMinY: el.y, gMaxX: el.x + el.w, gMaxY: el.y + el.h,
                        origElements: [JSON.parse(JSON.stringify(el))],
                        origLassoPath: null
                    };
                    startPoint.current = { x: e.clientX, y: e.clientY };
                    isDrawing.current = true;
                    e.target.setPointerCapture(e.pointerId);
                    return;
                }
                
                if (!el.locked) {
                    if (localPos.x >= el.x - pad && localPos.x <= el.x + el.w + pad && localPos.y >= el.y - pad && localPos.y <= el.y + el.h + pad) {
                        dragContext.current = {
                            type: 'move', startX: pos.x, startY: pos.y,
                            isMoved: false,
                            origElements: [JSON.parse(JSON.stringify(el))],
                            origLassoPath: null
                        };
                        startPoint.current = { x: e.clientX, y: e.clientY };
                        isDrawing.current = true;
                        e.target.setPointerCapture(e.pointerId);
                        return;
                    }
                }
            }
        }
        
        // Fallback for group rotate (or single path/line)
        const hsRotate = 25 / zoom;
        const groupRotCX = (gMinX + gMaxX) / 2;
        const groupRotCY = gMinY - pad - 20/zoom;
        if (Math.hypot(pos.x - groupRotCX, pos.y - groupRotCY) <= hsRotate) {
            const groupCX = (gMinX + gMaxX) / 2;
            const groupCY = (gMinY + gMaxY) / 2;
            dragContext.current = {
                type: 'rotateGroup', startX: pos.x, startY: pos.y,
                cx: groupCX, cy: groupCY,
                startAngle: Math.atan2(pos.y - groupCY, pos.x - groupCX),
                origElements: elementsRef.current.filter(e => selectedElementIds.includes(e.id)).map(e => JSON.parse(JSON.stringify(e))),
                gMinX, gMinY, gMaxX, gMaxY,
                origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
            };
            startPoint.current = { x: e.clientX, y: e.clientY };
            isDrawing.current = true;
            e.target.setPointerCapture(e.pointerId);
            return;
        }

        if (pos.x >= gMaxX + pad - hs && pos.x <= gMaxX + pad + hs && pos.y >= gMaxY + pad - hs && pos.y <= gMaxY + pad + hs) {
          dragContext.current = { 
            type: 'scale', startX: pos.x, startY: pos.y, 
            isMoved: false,
            gMinX, gMinY, gMaxX, gMaxY,
            origElements: selectedElementIds.map(id => JSON.parse(JSON.stringify(elementsRef.current.find(e => e.id === id)))),
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          startPoint.current = { x: e.clientX, y: e.clientY };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
          return;
        }
        // Check if any selected elements are locked - if ALL are locked, don't allow move
        const anyUnlocked = selectedElementIds.some(id => !elementsRef.current.find(e => e.id === id)?.locked);
        
        if (anyUnlocked && pos.x >= gMinX - pad && pos.x <= gMaxX + pad && pos.y >= gMinY - pad && pos.y <= gMaxY + pad) {
          dragContext.current = { 
            type: 'move', startX: pos.x, startY: pos.y, 
            isMoved: false,
            origElements: selectedElementIds.map(id => JSON.parse(JSON.stringify(elementsRef.current.find(e => e.id === id)))),
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          startPoint.current = { x: e.clientX, y: e.clientY };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
          return;
        }
      }
      
      // Try click-to-select: check if there's an element under the click
      const hitIdx = elementsRef.current.findLastIndex(el => {
        if (el.tool === 'eraser') return false;
        if (currentTool === 'image' && el.type !== 'image') return false;
        if (currentTool === 'select' && el.type === 'image') return false;
        return isPointInElement(pos, el, 5);
      });
      if (hitIdx !== -1) {
        const hitEl = elementsRef.current[hitIdx];
        setSelectedElementIds([hitEl.id]);
        activeLassoPathRef.current = null;
        // Start move drag immediately (unless element is locked)
        if (!hitEl.locked) {
          startPoint.current = { x: e.clientX, y: e.clientY };
          dragContext.current = { 
            type: 'move', startX: pos.x, startY: pos.y, 
            isMoved: false,
            origElements: [JSON.parse(JSON.stringify(hitEl))],
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
        }
        return;
      }
      
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
      lastEraserPos.current = pos;
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
        const eraserRadius = (brushSize / 2) + (el.size ? el.size / 2 : 2.5);
        
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
    const elIdx = elementsRef.current.findLastIndex(el => !el.locked && el.type !== 'image' && el.type !== 'path' && isPointInElement(pos, el, brushSize));
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
        
        if (isReadonly) return;
        
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
                   return clampPan(nx, ny, calculatedZoom);
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
        username: user?.username || 'Unknown',
        x: pos.x,
        y: pos.y,
        color: user?.role === 'admin' ? '#ef4444' : '#3b82f6'
      });
      lastEmitTime.current = now;
    }

    if (activePointerId.current !== e.pointerId) return; // Ignore other pointers

    if (isPanning) {
      const dx = e.clientX - startPoint.current.x;
      const dy = e.clientY - startPoint.current.y;
      setPan(prevPan => clampPan(prevPan.x + dx, prevPan.y + dy, zoom));
      startPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (currentTool === 'select' || currentTool === 'image') {
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
        
        const isGroupOperation = dragContext.current.type === 'rotateGroup' || dragContext.current.type === 'scaleGroup';
        
        if (dragContext.current.type === 'rotateGroup') {
            dragContext.current.isMoved = true;
            const currentAngle = Math.atan2(pos.y - dragContext.current.cy, pos.x - dragContext.current.cx);
            let angleDelta = currentAngle - dragContext.current.startAngle;
            
            if (e.shiftKey) {
                const snapAngle = Math.PI / 12; // 15 degrees
                angleDelta = Math.round(angleDelta / snapAngle) * snapAngle;
            }
            
            elementsRef.current.forEach(el => {
                if (selectedElementIds.includes(el.id)) {
                    const origEl = dragContext.current.origElements.find(e => e.id === el.id);
                    if (!origEl) return;
                    
                    if (el.type === 'path') {
                        el.points = origEl.points.map(p => {
                            if (p === null) return null;
                            return rotatePoint(p.x, p.y, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        });
                        el.bbox = null;
                        el.path2d = null;
                    } else if (el.type === 'line') {
                        const p1 = rotatePoint(origEl.x1, origEl.y1, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        const p2 = rotatePoint(origEl.x2, origEl.y2, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        el.x1 = p1.x; el.y1 = p1.y;
                        el.x2 = p2.x; el.y2 = p2.y;
                    } else if (el.type === 'circle') {
                        const newCenter = rotatePoint(origEl.x, origEl.y, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        el.x = newCenter.x;
                        el.y = newCenter.y;
                    } else {
                        const origCX = origEl.x + (origEl.w || 0)/2;
                        const origCY = origEl.y + (origEl.h || 0)/2;
                        const newCenter = rotatePoint(origCX, origCY, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        el.x = newCenter.x - (origEl.w || 0)/2;
                        el.y = newCenter.y - (origEl.h || 0)/2;
                        el.rotation = (origEl.rotation || 0) + angleDelta;
                    }
                }
            });
            if (socket && socket.id && shouldEmit) {
              elementsRef.current.forEach(el => {
                  if (selectedElementIds.includes(el.id)) {
                      socket.emit('update-element', { boardId: studentId, element: el });
                  }
              });
            }
        } else {
          dragContext.current.origElements.forEach(origEl => {
            if (!origEl) return;
            const elIdx = elementsRef.current.findIndex(e => e.id === origEl.id);
            if (elIdx === -1) return;
            const el = elementsRef.current[elIdx];
            
            if (dragContext.current.type === 'rotate') {
              const dx = pos.x - dragContext.current.cx;
              const dy = pos.y - dragContext.current.cy;
              // Calculate angle, adjust by Math.PI/2 because rotate handle is at the top (which is -y)
              // Math.atan2(dy, dx) returns angle from positive x-axis. Top is -PI/2.
              let angle = Math.atan2(dy, dx) + Math.PI/2;
              
              // Apply snapping to common angles if Shift is held
              if (e.shiftKey) {
                  const snapAngle = Math.PI / 12; // 15 degrees
                  angle = Math.round(angle / snapAngle) * snapAngle;
              }
              
              elementsRef.current.forEach(el => {
                  if (selectedElementIds.includes(el.id)) {
                      el.rotation = angle;
                  }
              });
            } else if (dragContext.current.type === 'move') {
              if (el.type === 'path') {
                 el.points = el.points.map((p, i) => (origEl.points[i] === null ? null : { x: origEl.points[i].x + dx, y: origEl.points[i].y + dy }));
                 el.bbox = null;
                 el.path2d = null;
              } else {
                 el.x = origEl.x + dx;
                 el.y = origEl.y + dy;
                 if (el.type === 'line') {
                   el.x1 = origEl.x1 + dx;
                   el.y1 = origEl.y1 + dy;
                 }
              }
                                    } else if (dragContext.current.type === 'circle_center') {
              if (el.type === 'circle') {
                 el.x = origEl.x + dx;
                 el.y = origEl.y + dy;
              }
            } else if (dragContext.current.type === 'circle_radius') {
              if (el.type === 'circle') {
                 const newR = Math.max(5, Math.hypot((pos.x - el.x), (pos.y - el.y)));
                 el.w = newR;
                 el.h = 0;
              }
            } else if (dragContext.current.type === 'vertex') {
              const dx = (pos.x - dragContext.current.startX);
              const dy = (pos.y - dragContext.current.startY);
              if (el.type === 'polygon') {
                 el.points[dragContext.current.vertexIndex] = { 
                     x: dragContext.current.origElements[0].points[dragContext.current.vertexIndex].x + dx, 
                     y: dragContext.current.origElements[0].points[dragContext.current.vertexIndex].y + dy 
                 };
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
                 el.bbox = null;
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
        }
        
        if (dragContext.current.origLassoPath) {
            if (dragContext.current.type === 'rotateGroup') {
                const currentAngle = Math.atan2(pos.y - dragContext.current.cy, pos.x - dragContext.current.cx);
                let angleDelta = currentAngle - dragContext.current.startAngle;
                if (e.shiftKey) {
                    const snapAngle = Math.PI / 12; // 15 degrees
                    angleDelta = Math.round(angleDelta / snapAngle) * snapAngle;
                }
                activeLassoPathRef.current = dragContext.current.origLassoPath.map(p => {
                    return rotatePoint(p.x, p.y, dragContext.current.cx, dragContext.current.cy, angleDelta);
                });
            } else if (dragContext.current.type === 'rotate') {
            const dx = pos.x - dragContext.current.cx;
            const dy = pos.y - dragContext.current.cy;
            // Calculate angle, adjust by Math.PI/2 because rotate handle is at the top (which is -y)
            // Math.atan2(dy, dx) returns angle from positive x-axis. Top is -PI/2.
            let angle = Math.atan2(dy, dx) + Math.PI/2;
            
            // Apply snapping to common angles if Shift is held
            if (e.shiftKey) {
                const snapAngle = Math.PI / 12; // 15 degrees
                angle = Math.round(angle / snapAngle) * snapAngle;
            }
            
            elementsRef.current.forEach(el => {
                if (selectedElementIds.includes(el.id)) {
                    el.rotation = angle;
                }
            });
          } else if (dragContext.current.type === 'move') {
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
      if (lastEraserPos.current) {
          const dist = Math.hypot(pos.x - lastEraserPos.current.x, pos.y - lastEraserPos.current.y);
          const steps = Math.max(1, Math.ceil(dist / (brushSize / 4)));
          for (let i = 1; i <= steps; i++) {
             const interpPos = {
                 x: lastEraserPos.current.x + (pos.x - lastEraserPos.current.x) * (i / steps),
                 y: lastEraserPos.current.y + (pos.y - lastEraserPos.current.y) * (i / steps)
             };
             erasePixel(interpPos);
             checkObjectEraserCollision(interpPos);
          }
      } else {
          erasePixel(pos);
          checkObjectEraserCollision(pos);
      }
      lastEraserPos.current = pos;
      return;
    }

    if (!currentPath.current) return;

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser' || currentTool === 'highlighter') {
      if (currentPath.current && currentPath.current.isSnapped) {
          currentPath.current.points[currentPath.current.points.length - 1] = pos;
      } else if (currentPath.current && currentPath.current.isSnappedAngle) {
          currentPath.current.points[currentPath.current.points.length - 1] = pos;
      } else {
          currentPath.current.points.push(pos);
      }
      currentPath.current.path2d = null; 
      
      if (currentTool === 'pencil' || currentTool === 'highlighter') {
          if (snapShapeTimeoutRef.current) clearTimeout(snapShapeTimeoutRef.current);
          snapShapeTimeoutRef.current = setTimeout(() => performSmartSnap(), 800);
      }
    } else if (currentTool === 'line') {
      currentPath.current.x2 = pos.x;
      currentPath.current.y2 = pos.y;
    } else {
      currentPath.current.w = pos.x - startPoint.current.x;
      currentPath.current.h = pos.y - startPoint.current.y;
    }
    
    // Request animation frame for smooth redraw
    requestAnimationFrame(() => { 
        if (dragContext.current && (dragContext.current.type === 'move' || dragContext.current.type === 'rotate' || dragContext.current.type === 'rotateGroup' || dragContext.current.type === 'scale')) {
            if (fullRedrawRef.current) fullRedrawRef.current();
        } else {
            if (redrawDraftRef.current) redrawDraftRef.current(); 
        }
    });
    
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
    lastEraserPos.current = null;
    
    e.target.releasePointerCapture(e.pointerId);
    if (isPanning) {
      setIsPanning(false);
      return;
    }


    if ((currentTool === 'select' || currentTool === 'image') && currentPath.current && currentPath.current.type === 'lasso') {
      const lassoPoints = currentPath.current.points;
      if (lassoPoints.length > 2) {
        const selectedIds = [];
        elementsRef.current.forEach(el => {
          if (currentTool === 'image' && el.type !== 'image') return;
          if (currentTool === 'select' && el.type === 'image') return;
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
        // Tap-to-select: if the lasso was just a tap/click, try to select the element under it
        const tapPos = lassoPoints[0];
        const hitIdx = elementsRef.current.findLastIndex(el => {
          if (el.tool === 'eraser') return false;
          if (currentTool === 'image' && el.type !== 'image') return false;
          if (currentTool === 'select' && el.type === 'image') return false;
          return isPointInElement(tapPos, el, 5);
        });
        if (hitIdx !== -1) {
          const hitEl = elementsRef.current[hitIdx];
          setSelectedElementIds([hitEl.id]);
          activeLassoPathRef.current = null;
        } else {
          setSelectedElementIds([]);
          activeLassoPathRef.current = null;
        }
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
      } else {
        const fadingLaser = { ...stroke, fadeStartTime: Date.now() };
        fadingLasersRef.current.push(fadingLaser);
        startLaserFadeAnimation();
        if (socket && socket.id) {
          socket.emit('laser-fade', { boardId: studentId, stroke: fadingLaser, socketId: socket.id });
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
      setPan(clampPan(newPanX, newPanY, newZoom));
    } else {
      // Pan
      setPan(prevPan => clampPan(
        prevPan.x - e.deltaX,
        prevPan.y - e.deltaY,
        zoom
      ));
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
          
          elementsRef.current.filter(el => el.type === 'image').forEach(el => drawElement(ctx, el, 1));
          elementsRef.current.filter(el => el.type !== 'image').forEach(el => drawElement(ctx, el, 1));
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
            const existingPages = elementsRef.current.filter(el => el.isPage);
            let currentY = existingPages.length > 0 
                ? Math.max(...existingPages.map(el => el.y + el.h)) + 40 
                : 0;
            const newElements = [];
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 }); // Good quality, memory-efficient
                const renderCanvas = document.createElement('canvas');
                renderCanvas.width = viewport.width;
                renderCanvas.height = viewport.height;
                const renderCtx = renderCanvas.getContext('2d');
                await page.render({ canvasContext: renderCtx, viewport }).promise;
                
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(renderCanvas, 0, 0);
                
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
                    isPage: true,
                    locked: true,
                    url: publicUrl,
                    x: -(imgWidth / 2),
                    y: currentY,
                    w: imgWidth,
                    h: imgHeight
                };
                
                newElements.push(newEl);
                if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
                
                currentY += imgHeight + 40; // 40px gap between pages
            }
            
            if (newElements.length > 0) {
                setElements(prev => {
                    const newEls = [...prev, ...newElements];
                    elementsRef.current = newEls;
                    setPastStates(p => [...p, prev]);
                    setFutureStates([]);
                    if (typeof emitCanvasUpdate === 'function') emitCanvasUpdate(newEls);
                    return newEls;
                });
                // Reset pan and zoom to center the document
                setZoom(1);
                setPan(clampPan((window.innerWidth / 2) - 400, 50, 1));
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
    if (isReadonly) return;
    if (pastStates.length === 0) return;
    const previous = pastStates[pastStates.length - 1];
    const newPast = pastStates.slice(0, -1);
    setPastStates(newPast);
    setFutureStates([elements, ...futureStates]);
    setElements(previous);
    if (socket) socket.emit('undo', studentId);
  };

  const handleRedo = () => {
    if (isReadonly) return;
    if (futureStates.length === 0) return;
    const next = futureStates[0];
    const newFuture = futureStates.slice(1);
    setFutureStates(newFuture);
    setPastStates([...pastStates, elements]);
    setElements(next);
    emitCanvasUpdate(next); // Fallback to full sync for redo
  };

  const handleClear = () => {
    if (isReadonly) return;
    if (confirm('Are you sure you want to clear the canvas?')) {
      setPastStates([...pastStates, elements]);
      setFutureStates([]);
      setElements([]);
      elementsRef.current = [];
      if (fullRedrawRef.current) fullRedrawRef.current();
      if (socket) socket.emit('clear-canvas', studentId);
    }
  };

  const handleZoomIn = () => setZoom(z => Math.min(5, z + 0.2));
  const handleZoomOut = () => setZoom(z => Math.max(0.1, z - 0.2));
  const handleResetZoom = () => { setZoom(1); setPan(clampPan(0, 0, 1)); };

  const trackStudentCursor = () => {
    // Find the cursor belonging to the student whose board this is
    const targetUsername = decodeURIComponent(studentId);
    
    // 1. Try exact or case-insensitive match
    let studentCursor = Object.values(cursors).find(c => c.username && c.username.toLowerCase() === targetUsername.toLowerCase());
    
    // 2. Fallback: Find the first cursor that is a student (blue color)
    if (!studentCursor) {
        studentCursor = Object.values(cursors).find(c => c.color === '#3b82f6');
    }
    
    // 3. Fallback: Try to find an active remote path from a student
    if (!studentCursor) {
        const pathIds = Object.keys(remotePaths.current);
        if (pathIds.length > 0) {
            const path = remotePaths.current[pathIds[0]];
            if (path && path.points && path.points.length > 0) {
                const lastPoint = path.points[path.points.length - 1];
                if (lastPoint) {
                    studentCursor = { x: lastPoint.x, y: lastPoint.y };
                }
            }
        }
    }
    
    // 4. Fallback: Find the most recent element on the board
    if (!studentCursor && elementsRef.current.length > 0) {
        const lastEl = elementsRef.current[elementsRef.current.length - 1];
        const box = getElementBoundingBox(lastEl);
        if (box && box.minX !== undefined) {
            studentCursor = { x: (box.minX + box.maxX)/2, y: (box.minY + box.maxY)/2 };
        }
    }
    
    // 5. Last resort: Find any remote cursor available
    if (!studentCursor && Object.values(cursors).length > 0) {
        studentCursor = Object.values(cursors)[0];
    }

    if (studentCursor && containerRef.current) {
        const viewportWidth = containerRef.current.clientWidth;
        const viewportHeight = containerRef.current.clientHeight;
        
        setPan(clampPan(
            viewportWidth / 2 - studentCursor.x * zoom,
            viewportHeight / 2 - studentCursor.y * zoom,
            zoom
        ));
    } else {
        alert('ยังหาเมาส์ของนักเรียนไม่เจอครับ (นักเรียนอาจจะยังไม่ได้ขยับเมาส์ในตอนนี้)');
    }
  };

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
          if (selectedElementIds.includes(el.id) && !el.locked) {
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

  const handleToggleLock = () => {
      const newElements = elementsRef.current.map(el => {
          if (selectedElementIds.includes(el.id)) {
              const updatedEl = { ...el, locked: !el.locked };
              if (socket && socket.id) socket.emit('update-element', { boardId: studentId, element: updatedEl });
              return updatedEl;
          }
          return el;
      });
      setElements(() => {
          elementsRef.current = newElements;
          return newElements;
      });
      setSelectedElementIds([]);
      activeLassoPathRef.current = null;
      setContextMenuPos(null);
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
      {!isReadonly && (
        <div 
          className="absolute top-4 left-4 z-50 flex flex-col md:flex-row gap-2 items-start"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {user?.role === 'admin' ? (
            <div className="flex items-center gap-2">
              <button 
                onClick={(e) => { e.stopPropagation(); navigate('/admin'); }}
                className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur shadow-lg border border-gray-100 rounded-2xl text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                title="Back to Dashboard"
              >
                <ArrowLeft size={20} /> <span className="hidden xl:inline">Back to Dashboard</span>
              </button>
              {returnGroup && (
                <button 
                  onClick={(e) => { e.stopPropagation(); navigate(`/monitor/${encodeURIComponent(returnGroup)}`); }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-50/90 backdrop-blur shadow-lg border border-blue-100 rounded-2xl text-blue-700 hover:bg-blue-100 font-medium transition-colors"
                  title={`Back to Monitor (${returnGroup})`}
                >
                  <ArrowLeft size={20} /> <span className="hidden xl:inline">Back to Monitor ({returnGroup})</span>
                </button>
              )}
              <button
                onClick={trackStudentCursor}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50/90 backdrop-blur shadow-lg border border-indigo-100 rounded-2xl text-indigo-700 hover:bg-indigo-100 font-medium transition-colors"
                title="Track Student"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
                <span className="hidden md:inline">Track Student</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (studentId === 'teacher_board') {
                    navigate(`/board/${user.username}`);
                  } else {
                    navigate('/board/teacher_board');
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2 backdrop-blur shadow-lg border rounded-2xl font-medium transition-colors ${
                  studentId === 'teacher_board' 
                    ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' 
                    : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                }`}
                title={studentId === 'teacher_board' ? 'กลับไปบอร์ดของฉัน' : 'ไปที่บอร์ดของครู'}
              >
                <ArrowLeft size={20} className={studentId === 'teacher_board' ? '' : 'rotate-180'} />
                <span className="hidden md:inline">
                  {studentId === 'teacher_board' ? 'กลับกระดานส่วนตัว' : 'ไปที่บอร์ดของครู (Teacher Board)'}
                </span>
              </button>
              {user?.username === studentId && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50/90 backdrop-blur shadow-lg border border-red-100 rounded-2xl text-red-700 hover:bg-red-100 font-medium transition-colors"
                  title="Clear Board"
                >
                  <Trash2 size={20} />
                  <span className="hidden md:inline">Clear Board</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}


      {/* PIP Window for Presentation Mode */}
      {showPIP && (
        <div 
          className="fixed bottom-6 right-6 w-96 h-64 bg-white rounded-xl shadow-2xl border-4 border-indigo-500 overflow-hidden z-[9999]"
          style={{ resize: 'both' }}
        >
          <div className="bg-indigo-600 text-white font-bold px-3 py-2 flex justify-between items-center text-sm shadow-md">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              Live: Teacher's Screen
            </span>
            <button onClick={() => setShowPIP(false)} className="hover:text-red-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <iframe 
            src="/board/teacher_board?readonly=true" 
            className="w-full h-full border-none pointer-events-none" 
            title="Teacher Board PIP"
          />
        </div>
      )}

      {!isReadonly && (
        <Toolbar 
          currentTool={currentTool} setCurrentTool={setCurrentTool}
          penMode={penMode} setPenMode={setPenMode}
          brushColor={brushColor} setBrushColor={setBrushColor}
          brushSize={brushSize} setBrushSize={setBrushSize}
          handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} handleResetZoom={handleResetZoom}
          handleClear={handleClear} handleUndo={handleUndo} handleRedo={handleRedo}
          canUndo={pastStates.length > 0} canRedo={futureStates.length > 0}
          handleUpload={handleUpload}
          bgTemplate={bgTemplate} setBgTemplate={setBgTemplate}
          handleExport={handleExport}
          isPresentationMode={isPresentationMode} setIsPresentationMode={setIsPresentationMode}
          isAdmin={user?.role === 'admin'}
        />
      )}

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
               <div className="w-px h-5 bg-gray-200 mx-1"></div>
               <button onClick={handleToggleLock} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 transition-colors" title={selectedElementIds.some(id => elementsRef.current.find(e => e.id === id)?.locked) ? 'Unlock' : 'Lock'}>
                  {selectedElementIds.some(id => elementsRef.current.find(e => e.id === id)?.locked) ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  )}
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
                      setSelectedElementIds(elementsRef.current.filter(el => currentTool === 'image' ? el.type === 'image' : el.type !== 'image').map(el => el.id));
                      setGlobalMenuPos(null);
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

        {textInput && !textInput.isPostit && (
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
        
        {textInput && textInput.isPostit && (
            <textarea
                ref={(input) => {
                    if (input && !input.dataset.focused) {
                        input.dataset.focused = "true";
                        setTimeout(() => input.focus(), 10);
                    }
                }}
                value={textInput.text}
                onChange={(e) => {
                    setTextInput({ ...textInput, text: e.target.value });
                    // Auto-resize textarea height
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onBlur={() => {
                    if (textInput.text.trim()) {
                        const newEl = {
                            id: generateId(),
                            type: 'postit',
                            tool: 'postit',
                            x: textInput.x,
                            y: textInput.y,
                            text: textInput.text,
                            color: textInput.color || '#fef08a',
                            size: 20,
                            w: 100,
                            h: 100
                        };
                        setElements(prev => {
                            const newEls = [...prev, newEl];
                            elementsRef.current = newEls;
                            return newEls;
                        });
                        if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
                        if (fullRedrawRef.current) fullRedrawRef.current();
                    }
                    setTextInput(null);
                }}
                className="absolute z-50 p-3 shadow-xl resize-none outline-none overflow-hidden"
                style={{
                    left: `${textInput.x * zoom + pan.x}px`,
                    top: `${textInput.y * zoom + pan.y}px`,
                    backgroundColor: textInput.color || '#fef08a',
                    color: '#000000',
                    fontFamily: '"Comic Sans MS", "Caveat", cursive, sans-serif',
                    fontSize: `${20 * zoom}px`,
                    minWidth: `${100 * zoom}px`,
                    minHeight: `${100 * zoom}px`,
                    whiteSpace: 'pre', // Allows it to stretch horizontally until enter is pressed
                    transform: 'scale(1)',
                    pointerEvents: 'auto'
                }}
            />
        )}
      </div>
    </div>
  );
};

export default Board;
