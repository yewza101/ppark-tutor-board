import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Trash2 } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import Toolbar from '../components/Toolbar';
import TeacherShortcutBar from '../components/TeacherShortcutBar';
import { API_URL } from '../config';
import { createSocket } from '../socket';
import * as pdfjsLib from 'pdfjs-dist';
// Bundled worker: the previous cdnjs URL meant PDF import died on any network that
// blocks the CDN, and silently broke whenever the pinned version moved.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
import { jsPDF } from 'jspdf';
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

const getPt = (p) => (!p ? null : Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });

const distancePointToSegment = (p, v, w) => {
  const pPt = getPt(p);
  const vPt = getPt(v);
  const wPt = getPt(w);
  if (!pPt || !vPt || !wPt) return Infinity;
  const l2 = (vPt.x - wPt.x) ** 2 + (vPt.y - wPt.y) ** 2;
  if (l2 === 0) return Math.hypot(pPt.x - vPt.x, pPt.y - vPt.y);
  let t = ((pPt.x - vPt.x) * (wPt.x - vPt.x) + (pPt.y - vPt.y) * (wPt.y - vPt.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pPt.x - (vPt.x + t * (wPt.x - vPt.x)), pPt.y - (vPt.y + t * (wPt.y - vPt.y)));
};


const drawAngleGuides = (ctx, el) => {
    if (!el) return;
    ctx.save();
    ctx.fillStyle = '#ef4444';
    ctx.font = '16px sans-serif';

    if (el.type === 'polygon' || el.isSnappedAngle) {
         const pts = (el.points || []).map(getPt).filter(Boolean);
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
    } else if (el.type === 'line') {
        const a = Math.atan2((el.y2||0) - (el.y1||0), (el.x2||0) - (el.x1||0)) * (180/Math.PI);
        ctx.fillText(Math.round(Math.abs(a)) + '°', (el.x2||0) + 10, (el.y2||0) + 10);
    } else if (el.type === 'rectangle') {
        ctx.fillText('90°', el.x + 10, el.y + 20);
        ctx.fillText('90°', el.x + el.w - 30, el.y + 20);
        ctx.fillText('90°', el.x + 10, el.y + el.h - 10);
        ctx.fillText('90°', el.x + el.w - 30, el.y + el.h - 10);
    } else if (el.type === 'triangle') {
        const p1 = {x: el.x + el.w / 2, y: el.y};
        const p2 = {x: el.x + el.w, y: el.y + el.h};
        const p3 = {x: el.x, y: el.y + el.h};
        const a1 = getAngle(p3, p1, p2) * (180/Math.PI);
        const a2 = getAngle(p1, p2, p3) * (180/Math.PI);
        const a3 = getAngle(p2, p3, p1) * (180/Math.PI);
        if (!isNaN(a1)) ctx.fillText(Math.round(a1) + '°', p1.x - 10, p1.y + 25);
        if (!isNaN(a2)) ctx.fillText(Math.round(a2) + '°', p2.x - 30, p2.y - 10);
        if (!isNaN(a3)) ctx.fillText(Math.round(a3) + '°', p3.x + 10, p3.y - 10);
    }
    ctx.restore();
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

  if (el.points && Array.isArray(el.points) && el.points.length > 0) {
    const pts = el.points.map(getPt);
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i] !== null && pts[i+1] !== null) {
        if (distancePointToSegment(checkPt, pts[i], pts[i+1]) < hitRadius) return true;
      } else if (pts[i] !== null && pts[i+1] === null) {
        if (Math.hypot(checkPt.x - pts[i].x, checkPt.y - pts[i].y) < hitRadius) return true;
      }
    }
    if (pts.length > 0 && pts[pts.length - 1] !== null) {
      if (Math.hypot(checkPt.x - pts[pts.length - 1].x, checkPt.y - pts[pts.length - 1].y) < hitRadius) return true;
    }
    if ((el.type === 'polygon' || el.type === 'triangle') && pts.length >= 3 && pts[0] && pts[pts.length - 1]) {
      if (distancePointToSegment(checkPt, pts[pts.length - 1], pts[0]) < hitRadius) return true;
    }
    return false;
  } else if (el.type === 'triangle') {
    const p1 = { x: el.x + el.w / 2, y: el.y };
    const p2 = { x: el.x + el.w, y: el.y + el.h };
    const p3 = { x: el.x, y: el.y + el.h };
    return distancePointToSegment(checkPt, p1, p2) < hitRadius ||
           distancePointToSegment(checkPt, p2, p3) < hitRadius ||
           distancePointToSegment(checkPt, p3, p1) < hitRadius;
  } else if (el.type === 'line') {
    return distancePointToSegment(checkPt, {x: el.x1, y: el.y1}, {x: el.x2, y: el.y2}) < hitRadius;
  } else if (el.type === 'rectangle') {
    const v1 = {x: el.x, y: el.y};
    const v2 = {x: el.x + el.w, y: el.y};
    const v3 = {x: el.x + el.w, y: el.y + el.h};
    const v4 = {x: el.x, y: el.y + el.h};
    return distancePointToSegment(checkPt, v1, v2) < hitRadius ||
           distancePointToSegment(checkPt, v2, v3) < hitRadius ||
           distancePointToSegment(checkPt, v3, v4) < hitRadius ||
           distancePointToSegment(checkPt, v4, v1) < hitRadius;
  } else if (el.type === 'image' || el.type === 'math' || el.type === 'postit') {
      const minX = Math.min(el.x, el.x + (el.w || 100));
      const maxX = Math.max(el.x, el.x + (el.w || 100));
      const minY = Math.min(el.y, el.y + (el.h || 100));
      const maxY = Math.max(el.y, el.y + (el.h || 100));
      return checkPt.x >= minX && checkPt.x <= maxX && checkPt.y >= minY && checkPt.y <= maxY;
  } else if (el.type === 'text') {
      const box = getElementBoundingBox(el);
      return checkPt.x >= box.minX && checkPt.x <= box.maxX && checkPt.y >= box.minY && checkPt.y <= box.maxY;
  } else if (el.type === 'circle') {
    const elRadius = Math.hypot(el.w, el.h);
    const dist = Math.hypot(checkPt.x - el.x, checkPt.y - el.y);
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

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    const w = maxX - minX, h = maxY - minY;
    const cx = minX + w/2, cy = minY + h/2;

    if (isClosed) {
        if (simplified.length < 4) return null;
        if (simplified.length === 4) return { type: 'triangle', points: [{x: cx, y: minY}, {x: maxX, y: maxY}, {x: minX, y: maxY}] };
        if (simplified.length === 5) {
            return { type: 'rectangle', points: [{x: minX, y: minY}, {x: maxX, y: minY}, {x: maxX, y: maxY}, {x: minX, y: maxY}] };
        }
        const r = (w + h) / 4;
        return { type: 'circle', x: cx, y: cy, r };
    } else {
        if (simplified.length === 2) return { type: 'line', points: [pts[0], pts[pts.length-1]] };
        if (simplified.length === 3) {
            let maxDist = 0; let corner = pts[1];
            for (let i = 1; i < pts.length - 1; i++) {
                const d = distancePointToLine(pts[i], pts[0], pts[pts.length-1]);
                if (d > maxDist) { maxDist = d; corner = pts[i]; }
            }
            return { type: 'angle', points: [pts[0], corner, pts[pts.length-1]] };
        }
        return null;
    }
};
// --------------------------------

const isPointInPolygon = (point, vs) => {
  const pt = getPt(point);
  if (!pt) return false;
  let x = pt.x, y = pt.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const vi = getPt(vs[i]);
    const vj = getPt(vs[j]);
    if (!vi || !vj) continue;
    let xi = vi.x, yi = vi.y;
    let xj = vj.x, yj = vj.y;
    let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// One reusable measuring context instead of a new canvas per call.
let measureCtx = null;
const getMeasureCtx = () => {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
};

const getElementBoundingBox = (el) => {
  let minX, minY, maxX, maxY;
  if (el.type === 'path' || el.type === 'polygon' || el.type === 'polyline' || el.isSnapped || el.isSnappedAngle) {
     if (el.bbox && el.type === 'path' && isFinite(el.bbox.minX) && isFinite(el.bbox.minY)) {
         minX = el.bbox.minX; minY = el.bbox.minY; maxX = el.bbox.maxX; maxY = el.bbox.maxY;
     } else {
         const validPoints = el.points ? el.points.map(getPt).filter(Boolean) : [];
         if (validPoints.length === 0) return {};
         minX = Math.min(...validPoints.map(p => p.x));
         minY = Math.min(...validPoints.map(p => p.y));
         maxX = Math.max(...validPoints.map(p => p.x));
         maxY = Math.max(...validPoints.map(p => p.y));
         if (el.type === 'path') {
           try { el.bbox = { minX, minY, maxX, maxY }; } catch {}
         }
     }
  } else if (el.type === 'triangle') {
     const p1 = { x: el.x + el.w / 2, y: el.y };
     const p2 = { x: el.x + el.w, y: el.y + el.h };
     const p3 = { x: el.x, y: el.y + el.h };
     minX = Math.min(p1.x, p2.x, p3.x);
     minY = Math.min(p1.y, p2.y, p3.y);
     maxX = Math.max(p1.x, p2.x, p3.x);
     maxY = Math.max(p1.y, p2.y, p3.y);
  } else if (el.type === 'line') {
     minX = Math.min(el.x1, el.x2);
     minY = Math.min(el.y1, el.y2);
     maxX = Math.max(el.x1, el.x2);
     maxY = Math.max(el.y1, el.y2);
  } else if (el.type === 'circle') {
     const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));
     minX = el.x - r; minY = el.y - r; maxX = el.x + r; maxY = el.y + r;
  } else if (el.type === 'rectangle' || el.type === 'image' || el.type === 'math' || el.type === 'postit') {
     minX = Math.min(el.x, el.x + el.w);
     minY = Math.min(el.y, el.y + el.h);
     maxX = Math.max(el.x, el.x + el.w);
     maxY = Math.max(el.y, el.y + el.h);
  } else if (el.type === 'text') {
     const ctx = getMeasureCtx();
     ctx.font = `${el.size || 20}px sans-serif`;
     const metrics = ctx.measureText(el.text || '');
     minX = el.x; minY = el.y; maxX = el.x + metrics.width; maxY = el.y + (el.size || 20);
  }
  return { minX, minY, maxX, maxY };
};

const isElementInLasso = (el, lassoPoints) => {
  if (!el || !lassoPoints || lassoPoints.length < 3) return false;

  // Never lasso locked elements (e.g. background worksheet pages)
  if (el.locked) return false;

  // 1. If element has points (paths, freehand strokes, polygons, polylines, snapped shapes):
  if (el.points && Array.isArray(el.points) && el.points.length > 0) {
    const anyPtInside = el.points.some(p => {
      if (!p) return false;
      const pt = getPt(p);
      return pt && isPointInPolygon(pt, lassoPoints);
    });
    if (anyPtInside) return true;
  }

  // 2. Lines with x1, y1, x2, y2:
  if (el.type === 'line' && el.x1 !== undefined && el.y1 !== undefined) {
    if (isPointInPolygon({ x: el.x1, y: el.y1 }, lassoPoints)) return true;
    if (isPointInPolygon({ x: el.x2, y: el.y2 }, lassoPoints)) return true;
    if (isPointInPolygon({ x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 }, lassoPoints)) return true;
  }

  // 3. Check bounding box center and corners
  const box = getElementBoundingBox(el);
  if (box.minX === undefined || isNaN(box.minX)) return false;

  // Check center
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  if (isPointInPolygon(center, lassoPoints)) return true;

  // Check 4 corners
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY }
  ];
  if (corners.some(c => isPointInPolygon(c, lassoPoints))) return true;

  // 4. Also check if any lasso point is inside element box (e.g. lasso drawn inside large shape/text)
  const anyLassoPtInside = lassoPoints.some(lp => {
    const pt = getPt(lp);
    return pt && pt.x >= box.minX && pt.x <= box.maxX && pt.y >= box.minY && pt.y <= box.maxY;
  });
  if (anyLassoPtInside) return true;

  return false;
};

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

const safeSetPointerCapture = (target, pointerId) => {
  try {
    if (target && target.setPointerCapture) {
      target.setPointerCapture(pointerId);
    }
  } catch {}
};

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
  const dprRef = useRef(1);

  const fullRedrawRef = useRef(null);
  const redrawBaseRef = useRef(null);
  const redrawDraftRef = useRef(null);

  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  socketRef.current = socket;

  // Tools state
  const [currentTool, setCurrentTool] = useState('pencil');
  const [penMode, setPenMode] = useState(false);
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);

  // Canvas data state
  const [elements, setElements] = useState([]);
  const elementsRef = useRef([]); // For zero-latency canvas rendering
  const [myRedoStack, setMyRedoStack] = useState([]);
  const handleUndoRef = useRef(null);
  const handleRedoRef = useRef(null);
  const lastTeacherViewportRef = useRef(null);
  const hasAutoTrackedRef = useRef(false);
  const [teacherTrackPing, setTeacherTrackPing] = useState(null);

  // Viewport state
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  panRef.current = pan;
  const [isPanning, setIsPanning] = useState(false);
  const [bgTemplate, setBgTemplate] = useState('blank');
  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [isPresentationMode, setIsPresentationMode] = useState(false);

  const myRole = user?.role === 'admin' ? 'admin' : 'student';

  const clampPanRef = useRef(null);
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
  clampPanRef.current = clampPan;

  // Keep track of window size and prevent unwanted iOS/iPad text selection on canvas
  useEffect(() => {
    const handleResize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    };
    // Only suppress selection that starts on the canvas itself. Binding this to
    // document blocked selecting or copying any text anywhere in the app.
    const preventSelection = (e) => {
      if (e.cancelable) e.preventDefault();
    };

    window.addEventListener('resize', handleResize);
    const container = containerRef.current;
    container?.addEventListener('selectstart', preventSelection);
    return () => {
      window.removeEventListener('resize', handleResize);
      container?.removeEventListener('selectstart', preventSelection);
    };
  }, []);

  // Intercept native touchstart on canvas to block iOS rapid multi-tap zoom and select-all heuristics
  useEffect(() => {
    const draftCanvas = draftCanvasRef.current;
    if (!draftCanvas) return;

    let lastTapTime = 0;
    const handleTouchStart = (e) => {
      const now = Date.now();
      const tapInterval = now - lastTapTime;
      lastTapTime = now;

      // Prevent multi-tap zoom and multi-tap select-all on iOS
      if (tapInterval < 350 && e.cancelable) {
        e.preventDefault();
      }

      // If single touch/pen, stop default iOS callout and text selection
      if (e.touches && e.touches.length <= 1 && e.cancelable) {
        e.preventDefault();
      }
    };

    draftCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    return () => draftCanvas.removeEventListener('touchstart', handleTouchStart);
  }, []);

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (handleRedoRef.current) handleRedoRef.current();
        } else {
          if (handleUndoRef.current) handleUndoRef.current();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (handleRedoRef.current) handleRedoRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
          isPresentationMode,
          role: myRole
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
  }, [socket, pan, zoom, viewportSize, studentId, isPresentationMode, myRole]);

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
          isPresentationMode,
          role: myRole
        });
      }
    }, 25000);
    return () => clearInterval(interval);
  }, [socket, pan, zoom, viewportSize, studentId, isPresentationMode, myRole]);

  // Emit force-presentation when admin toggles it on the teacher_board
  useEffect(() => {
    if (socket && user?.role === 'admin' && studentId.startsWith('teacher_board')) {
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
  const [toastMsg, setToastMsg] = useState('');
  const toastTimeout = useRef(null);

  useEffect(() => () => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
  }, []);

  const showToast = (msg) => {
      setToastMsg(msg);
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      toastTimeout.current = setTimeout(() => setToastMsg(''), 1500);
  };
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
  const activePointerType = useRef(null);

  // For Pinch to Zoom
  const activePointers = useRef(new Map());
  const fadingLasersRef = useRef([]);
  const animationFrameRef = useRef(null);
  const twoFingerRef = useRef({ downTime: 0, moved: false });
  const lastPinchDist = useRef(null);
  const lastPinchCenter = useRef(null);

  // Coalesce redraws: one per animation frame no matter how many pointer events land.
  const redrawQueuedRef = useRef(false);
  const queueRedraw = useCallback((full) => {
    if (redrawQueuedRef.current) {
      if (full) redrawQueuedRef.current = 'full';
      return;
    }
    redrawQueuedRef.current = full ? 'full' : true;
    requestAnimationFrame(() => {
      const wantsFull = redrawQueuedRef.current === 'full';
      redrawQueuedRef.current = false;
      if (wantsFull) {
        if (fullRedrawRef.current) fullRedrawRef.current();
      } else if (redrawDraftRef.current) {
        redrawDraftRef.current();
      }
    });
  }, []);

  const remotePaths = useRef({});
  const lastEmitTime = useRef(0);
  // How much of the in-progress stroke the other clients already have.
  const sentStrokeIdRef = useRef(null);
  const sentPointCountRef = useRef(0);
  const lastCursorEmitTime = useRef(0);
  const lastCursorPosRef = useRef({ x: 0, y: 0 });
  const lastEraserPos = useRef(null);

  // Initialize Socket and Fetch initial data
  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }

    const syncBoardFromServer = async () => {
      // If student or teacher is actively in the middle of drawing a stroke, don't overwrite local elements
      if (isDrawing.current) {
        return;
      }
      try {
        const res = await axios.get(`${API_URL}/api/boards/${studentId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data?.canvas_data) {
          let parsed = res.data.canvas_data;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = []; }
          }
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = []; }
          }
          if (Array.isArray(parsed) && !isDrawing.current) {
            setElements(parsed);
            elementsRef.current = parsed;
            if (fullRedrawRef.current) fullRedrawRef.current();
          }
        }
      } catch (err) {
        console.error('Failed to sync board state:', err);
        if (err.response?.status === 403 || err.response?.status === 401) {
          navigate(user.role === 'admin' ? '/admin' : '/login');
        }
      }
    };
    syncBoardFromServer();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncBoardFromServer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const newSocket = createSocket(token);
    setSocket(newSocket);

    newSocket.emit('join-board', { boardId: studentId, role: user?.role || 'student' });

    // Announce our viewport only once the server confirms we are in the room,
    // otherwise the very first update is dropped and the teacher's monitor tile
    // shows nothing until the student happens to pan.
    newSocket.on('board-joined', () => {
      newSocket.emit('viewport-update', {
        boardId: studentId,
        pan: panRef.current,
        zoom: zoomRef.current,
        width: window.innerWidth,
        height: window.innerHeight,
        socketId: newSocket.id,
        role: user?.role || 'student'
      });
    });

    newSocket.on('canvas-update', (updatedElements) => {
      if (!Array.isArray(updatedElements)) return;
      elementsRef.current = updatedElements;
      setElements(updatedElements);
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('connect', () => {
      console.log('Socket connected/reconnected');
      newSocket.emit('join-board', { boardId: studentId, role: user?.role || 'student' });
      syncBoardFromServer();
    });

    newSocket.on('add-elements', (data) => {
        setElements(prev => {
            const newElements = [...prev, ...data.elements];
            return newElements;
        });
        if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('draw-progress', (data) => {
      if (!data) return;
      if (data.path === null) {
        delete remotePaths.current[data.socketId];
      } else if (data.append && remotePaths.current[data.socketId]?.id === data.path.id) {
        // Delta chunk: extend the stroke we are already drawing for this peer.
        const existing = remotePaths.current[data.socketId];
        remotePaths.current[data.socketId] = {
          ...existing,
          points: [...(existing.points || []), ...(data.path.points || [])],
          path2d: null
        };
      } else {
        // First chunk, a shape, or we joined mid-stroke and missed the start.
        remotePaths.current[data.socketId] = data.path;
      }
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('laser-fade', (data) => {
        if (data.stroke) {
            fadingLasersRef.current.push({ ...data.stroke, fadeStartTime: Date.now() });
            // Via a ref: this const is declared further down, so naming it in the
            // effect's dependency array would be a temporal-dead-zone error.
            if (startLaserFadeRef.current) startLaserFadeRef.current();
        }
        if (data.socketId && remotePaths.current[data.socketId]) {
            delete remotePaths.current[data.socketId];
        }
    });

    newSocket.on('draw-stroke', (data) => {
      setElements(prev => {
        const newElements = [...prev, data.stroke];
        elementsRef.current = newElements;
        return newElements;
      });
      if (data.socketId && remotePaths.current[data.socketId]) {
        delete remotePaths.current[data.socketId];
      }
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('clear-canvas', () => {
      elementsRef.current = [];
      setElements([]);
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('update-element', (data) => {
      setElements(prev => prev.map(el => (el.id === data.element.id ? data.element : el)));
      elementsRef.current = elementsRef.current.map(el => (el.id === data.element.id ? data.element : el));
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('update-elements', (data) => {
      if (!data || !Array.isArray(data.elements)) return;
      const byId = new Map(data.elements.filter(Boolean).map(el => [el.id, el]));
      const apply = (list) => list.map(el => byId.get(el.id) || el);
      setElements(prev => apply(prev));
      elementsRef.current = apply(elementsRef.current);
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('join-board-denied', () => {
      // The server refused this room (not our board, or not our student).
      navigate(user?.role === 'admin' ? '/admin' : `/board/${user?.id}`);
    });

    newSocket.on('connect_error', (err) => {
      // An expired or missing token now fails the socket handshake outright.
      if (String(err?.message).includes('unauthorized')) {
        navigate('/login');
      }
    });

    newSocket.on('delete-element', ({ elementId }) => {
      setElements(prev => prev.filter(el => el.id !== elementId));
      elementsRef.current = elementsRef.current.filter(el => el.id !== elementId);
      if (fullRedrawRef.current) fullRedrawRef.current();
    });

    newSocket.on('cursor-move', (data) => {
      setCursors(prev => ({
        ...prev,
        [data.socketId]: {
          x: data.x,
          y: data.y,
          username: data.username,
          color: data.color,
          role: data.role,
          isTeacher: data.isTeacher || data.role === 'admin' || data.color === '#ef4444'
        }
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
      if (data.role === 'admin' || data.isPresentationMode) {
        lastTeacherViewportRef.current = data;
      }
      // If the admin is presenting, force students to follow their viewport
      if (data.isPresentationMode && user?.role !== 'admin') {
        const adminCenterX = -data.pan.x / data.zoom + data.width / (2 * data.zoom);
        const adminCenterY = -data.pan.y / data.zoom + data.height / (2 * data.zoom);

        const newPanX = -(adminCenterX * data.zoom) + window.innerWidth / 2;
        const newPanY = -(adminCenterY * data.zoom) + window.innerHeight / 2;

        setZoom(data.zoom);
        // Via the ref: this handler is registered once, so a captured clampPan
        // would keep clamping against the very first zoom/viewport values.
        setPan(clampPanRef.current(newPanX, newPanY, data.zoom));
      }
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      newSocket.disconnect();
    };
  }, [studentId, user, token, navigate]);

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
      ctx.globalCompositeOperation = el.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.globalAlpha = el.tool === 'highlighter' ? 0.35 : 1.0;

      ctx.lineWidth = el.tool === 'highlighter' ? Math.max(14, (el.size || 5) * 2.5) : (el.size || 5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

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


      if (el.type === 'polygon' || el.type === 'polyline' || el.isSnapped || el.isSnappedAngle) {
          if (el.isSnapped && el.type === 'path' && el.points && el.points.length === 2) {
              ctx.beginPath();
              ctx.moveTo(el.points[0].x, el.points[0].y);
              ctx.lineTo(el.points[1].x, el.points[1].y);
              ctx.stroke();
              return;
          }
          ctx.beginPath();
          if (el.points && el.points.length > 0) {
              ctx.moveTo(el.points[0].x, el.points[0].y);
              for (let i = 1; i < el.points.length; i++) {
                  if (el.points[i]) ctx.lineTo(el.points[i].x, el.points[i].y);
              }
              if (el.type === 'polygon') ctx.closePath();
              ctx.stroke();
          }
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

            try { el.path2d = p2d; } catch {} // Ignore if object is frozen by React
            p2dToDraw = p2d;
          }

          ctx.fill(p2dToDraw);
        }
      } else
      if (el.type === 'line') {
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
            // Mark as loading before src is assigned: the handlers can fire first.
            imageCacheRef.current[el.url] = 'loading';
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
              imageCacheRef.current[el.url] = img;
              if (fullRedrawRef.current) fullRedrawRef.current();
            };
            img.onerror = () => {
              imageCacheRef.current[el.url] = 'error';
            };
            img.src = el.url;
          } else if (imageCacheRef.current[el.url] instanceof HTMLImageElement) {
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
      if (el.locked && !ctx.isExporting) {
        const box = getElementBoundingBox(el);
        if (box.minX !== undefined) {
          const iconSize = 16 / (currentZoom || 1);
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

    const dpr = dprRef.current;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = isDocumentMode ? '#d1d5db' : '#ffffff'; // Grey background if in document mode
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Calculate visible bounds for culling
    const vMinX = -pan.x / zoom;
    const vMinY = -pan.y / zoom;
    const vMaxX = (cssW - pan.x) / zoom;
    const vMaxY = (cssH - pan.y) / zoom;

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
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
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
            drawAngleGuides(ctx, el);



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
            if (el && (el.type === 'polygon' || el.isSnappedAngle || el.isSnapped)) {
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


            if (el && el.type === 'line') {
                isSpecialSingle = true;
                ctx.save();
                ctx.fillStyle = '#ffffff';
                const hs = 8 / zoom;
                ctx.beginPath(); ctx.arc(el.x1, el.y1, hs, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.arc(el.x2, el.y2, hs, 0, Math.PI*2); ctx.fill(); ctx.stroke();
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

  const currentToolRef = useRef(currentTool);
  currentToolRef.current = currentTool;

  const startLaserFadeAnimation = useCallback(() => {
    if (!animationFrameRef.current) {
        const animate = () => {
            const now = Date.now();
            let hasFading = false;

            fadingLasersRef.current = fadingLasersRef.current.filter(laser => {
                const isAnyLaserDrawing =
                    (isDrawing.current && currentToolRef.current === 'laser') ||
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
  }, []);

  const startLaserFadeRef = useRef(null);
  startLaserFadeRef.current = startLaserFadeAnimation;

  const fullRedraw = useCallback(() => {
    redrawBase();
    redrawDraft();
  }, [redrawBase, redrawDraft]);

  useEffect(() => () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (snapShapeTimeoutRef.current) clearTimeout(snapShapeTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!dragContext.current) {
      elementsRef.current = elements;
    }
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

  // Handle window resize. Both canvases are backed by real device pixels and the
  // drawing code keeps working in CSS pixels via the dpr base transform.
  useEffect(() => {
    const applySize = () => {
      const container = containerRef.current;
      if (!container || !canvasRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      // Cap at 2: a 3x iPad canvas costs 2.25x the fill rate for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;

      for (const canvas of [canvasRef.current, draftCanvasRef.current]) {
        if (!canvas) continue;
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
      }
      if (fullRedrawRef.current) fullRedrawRef.current();
    };

    applySize();
    window.addEventListener('resize', applySize);
    // A ResizeObserver also catches container changes that fire no window resize
    // (orientation settling, toolbar reflow, the iPad on-screen keyboard).
    const ro = new ResizeObserver(applySize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', applySize);
      ro.disconnect();
    };
  }, []);

  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left - pan.x) / zoom;
    const rawY = (e.clientY - rect.top - pan.y) / zoom;
    return {
      x: Math.round(rawX * 10) / 10,
      y: Math.round(rawY * 10) / 10,
      pressure: e.pressure !== undefined ? Math.round(e.pressure * 100) / 100 : 0.5
    };
  };

  const onPointerDown = (e) => {
    if (e.cancelable) {
      e.preventDefault();
    }
    if (contextMenuPos) setContextMenuPos(null);
    if (globalMenuPos) setGlobalMenuPos(null);
    setShowColorPicker(false);

    // Palm rejection: If pen is actively drawing, ignore secondary touch (palm/wrist contact)
    if (activePointerType.current === 'pen' && e.pointerType === 'touch') {
      return;
    }

    // Always prioritize Apple Pencil / Pen
    if (e.pointerType === 'pen') {
      activePointerType.current = 'pen';
      activePointerId.current = e.pointerId;
      // Clear touch pointers so palm doesn't trigger two-finger gesture
      activePointers.current.clear();
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: 'pen' });
    } else {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

      // Two-finger gestures (pinch zoom / two-finger undo) - ONLY for touches when no pen is drawing
      const touchPointers = Array.from(activePointers.current.values()).filter(p => p.type === 'touch');
      if (touchPointers.length === 2 && activePointerType.current !== 'pen') {
        setIsPanning(false);
        isDrawing.current = false;
        currentPath.current = null;
        if (dragContext.current) {
          if (dragContext.current.origElementsState) {
            elementsRef.current = dragContext.current.origElementsState;
          }
          dragContext.current = null;
        }
        if (draftCanvasRef.current) {
          const dctx = draftCanvasRef.current.getContext('2d');
          if (dctx) {
            dctx.setTransform(1, 0, 0, 1, 0, 0);
            dctx.clearRect(0, 0, draftCanvasRef.current.width, draftCanvasRef.current.height);
          }
        }

        lastPinchDist.current = Math.hypot(touchPointers[0].x - touchPointers[1].x, touchPointers[0].y - touchPointers[1].y);
        lastPinchCenter.current = {
          x: (touchPointers[0].x + touchPointers[1].x) / 2,
          y: (touchPointers[0].y + touchPointers[1].y) / 2
        };

        twoFingerRef.current.downTime = Date.now();
        twoFingerRef.current.moved = false;
        return;
      }

      if (touchPointers.length > 2) return;

      if (activePointerId.current !== null && activePointerId.current !== e.pointerId) {
        return; // Ignore multitouch secondary fingers
      }
      activePointerId.current = e.pointerId;
      activePointerType.current = e.pointerType;
    }

    // Middle click or Space + Click for panning, or Pen Mode with touch
    if (e.button === 1 || e.altKey || currentTool === 'pan' || (penMode && e.pointerType === 'touch')) {
      setIsPanning(true);
      startPoint.current = { x: e.clientX, y: e.clientY };
      safeSetPointerCapture(e.target, e.pointerId);
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

        if (selectedElementIds.length === 1) {
            const el = elementsRef.current.find(e => e.id === selectedElementIds[0]);
            if (el && (el.type === 'polygon' || el.isSnappedAngle || el.isSnapped || el.type === 'polyline')) {
                const vertexRadius = 12 / zoom;
                let clickedVertex = -1;
                let localPos = pos;
                for (let i = 0; i < el.points.length; i++) {
                    if (Math.hypot(localPos.x - el.points[i].x, localPos.y - el.points[i].y) <= vertexRadius) {
                        clickedVertex = i;
                        break;
                    }
                }
                if (clickedVertex !== -1) {
                    dragContext.current = {
                        type: 'vertex', vertexIndex: clickedVertex, startX: pos.x, startY: pos.y,
                        origElements: [JSON.parse(JSON.stringify(el))],
                        origElementsState: elementsRef.current.slice()
                    };
                    startPoint.current = { x: e.clientX, y: e.clientY };
                    isDrawing.current = true;
                    safeSetPointerCapture(e.target, e.pointerId);
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

                // Rotate handle strictly above the box
                if (localPos.y <= el.y - pad - 4/zoom && Math.hypot(localPos.x - cx, localPos.y - cy) <= 14/zoom) {
                    dragContext.current = {
                        type: 'rotate', startX: pos.x, startY: pos.y,
                        origAngle: el.rotation || 0,
                        cx: el.x + el.w/2, cy: el.y + el.h/2,
                        origElements: [JSON.parse(JSON.stringify(el))],
                        origElementsState: elementsRef.current.slice()
                    };
                    startPoint.current = { x: e.clientX, y: e.clientY };
                    isDrawing.current = true;
                    safeSetPointerCapture(e.target, e.pointerId);
                    return;
                }

                // Scale handle at bottom right corner
                const scaleCX = el.x + el.w + pad;
                const scaleCY = el.y + el.h + pad;
                if (localPos.x >= el.x + el.w - 2/zoom && localPos.y >= el.y + el.h - 2/zoom && Math.hypot(localPos.x - scaleCX, localPos.y - scaleCY) <= 14/zoom) {
                    dragContext.current = {
                        type: 'scale', startX: pos.x, startY: pos.y,
                        isMoved: false,
                        gMinX: el.x, gMinY: el.y, gMaxX: el.x + el.w, gMaxY: el.y + el.h,
                        origElements: [JSON.parse(JSON.stringify(el))],
                        origElementsState: elementsRef.current.slice(),
                        origLassoPath: null
                    };
                    startPoint.current = { x: e.clientX, y: e.clientY };
                    isDrawing.current = true;
                    safeSetPointerCapture(e.target, e.pointerId);
                    return;
                }

                if (!el.locked) {
                    if (localPos.x >= el.x - 15/zoom && localPos.x <= el.x + el.w + 15/zoom && localPos.y >= el.y - 15/zoom && localPos.y <= el.y + el.h + 15/zoom) {
                        dragContext.current = {
                            type: 'move', startX: pos.x, startY: pos.y,
                            isMoved: false,
                            origElements: [JSON.parse(JSON.stringify(el))],
                            origElementsState: elementsRef.current.slice(),
                            origLassoPath: null
                        };
                        startPoint.current = { x: e.clientX, y: e.clientY };
                        isDrawing.current = true;
                        safeSetPointerCapture(e.target, e.pointerId);
                        return;
                    }
                }
            }
        }

        // Rotate handle for group (or single path/line/shape) - MUST be strictly above the selection box
        const groupRotCX = (gMinX + gMaxX) / 2;
        const groupRotCY = gMinY - pad - 20/zoom;
        if (pos.y <= gMinY - pad - 4/zoom && Math.hypot(pos.x - groupRotCX, pos.y - groupRotCY) <= 14 / zoom) {
            const groupCX = (gMinX + gMaxX) / 2;
            const groupCY = (gMinY + gMaxY) / 2;
            const selectedIdSet = new Set(selectedElementIds.map(String));
            const selectedEls = elementsRef.current.filter(e => selectedIdSet.has(String(e.id)));
            dragContext.current = {
                type: 'rotateGroup', startX: pos.x, startY: pos.y,
                cx: groupCX, cy: groupCY,
                startAngle: Math.atan2(pos.y - groupCY, pos.x - groupCX),
                origElements: selectedEls.map(e => JSON.parse(JSON.stringify(e))),
                origElementsState: elementsRef.current.slice(),
                gMinX, gMinY, gMaxX, gMaxY,
                origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
            };
            startPoint.current = { x: e.clientX, y: e.clientY };
            isDrawing.current = true;
            safeSetPointerCapture(e.target, e.pointerId);
            return;
        }

        // Scale handle for group - MUST be at bottom-right corner or outside, not inside selection
        const groupScaleCX = gMaxX + pad;
        const groupScaleCY = gMaxY + pad;
        if (pos.x >= gMaxX - 2/zoom && pos.y >= gMaxY - 2/zoom && Math.hypot(pos.x - groupScaleCX, pos.y - groupScaleCY) <= 14 / zoom) {
          const selectedIdSet = new Set(selectedElementIds.map(String));
          const selectedEls = elementsRef.current.filter(e => selectedIdSet.has(String(e.id)));
          dragContext.current = {
            type: 'scale', startX: pos.x, startY: pos.y,
            isMoved: false,
            gMinX, gMinY, gMaxX, gMaxY,
            origElements: selectedEls.map(el => JSON.parse(JSON.stringify(el))),
            origElementsState: elementsRef.current.slice(),
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          startPoint.current = { x: e.clientX, y: e.clientY };
          isDrawing.current = true;
          safeSetPointerCapture(e.target, e.pointerId);
          return;
        }
        // Check if any selected elements are locked - if ALL are locked, don't allow move
        const selectedIdSet = new Set(selectedElementIds.map(String));
        const anyUnlocked = elementsRef.current.some(e => selectedIdSet.has(String(e.id)) && !e.locked);
        const dragPad = 15 / zoom;

        const isInsideSelection = anyUnlocked && (
          (pos.x >= gMinX - dragPad && pos.x <= gMaxX + dragPad && pos.y >= gMinY - dragPad && pos.y <= gMaxY + dragPad) ||
          (activeLassoPathRef.current && isPointInPolygon(pos, activeLassoPathRef.current)) ||
          elementsRef.current.some(el => selectedIdSet.has(String(el.id)) && isPointInElement(pos, el, 20 / zoom))
        );

        if (isInsideSelection) {
          const selectedEls = elementsRef.current.filter(e => selectedIdSet.has(String(e.id)));
          dragContext.current = {
            type: 'move', startX: pos.x, startY: pos.y,
            isMoved: false,
            origElements: selectedEls.map(el => JSON.parse(JSON.stringify(el))),
            origElementsState: elementsRef.current.slice(),
            origLassoPath: activeLassoPathRef.current ? JSON.parse(JSON.stringify(activeLassoPathRef.current)) : null
          };
          startPoint.current = { x: e.clientX, y: e.clientY };
          isDrawing.current = true;
          safeSetPointerCapture(e.target, e.pointerId);
          return;
        }
      }

      // If no elements are selected, or user touched outside selection:
      // Start drawing a lasso selection loop!
      // (Single tap-to-select will be handled cleanly in onPointerUp if user just taps without dragging)
      setSelectedElementIds([]);
      activeLassoPathRef.current = null;
      currentPath.current = { id: generateId(), type: 'lasso', tool: 'select', points: [pos] };
      isDrawing.current = true;
      safeSetPointerCapture(e.target, e.pointerId);
      return;
    }

    if (currentTool === 'eraser-object') {
      const pos = getMousePos(e);
      checkObjectEraserCollision(pos, false);
      lastEraserPos.current = pos;
      isDrawing.current = true;
      safeSetPointerCapture(e.target, e.pointerId);
      return;
    }
    if (currentTool === 'eraser') {
      const pos = getMousePos(e);
      erasePixel(pos);
      checkObjectEraserCollision(pos, true);
      flushEraserUpdates();
      lastEraserPos.current = pos;
      isDrawing.current = true;
      safeSetPointerCapture(e.target, e.pointerId);
      return;
    }

    const pos = getMousePos(e);

    if (currentTool === 'text') {
      // Open the inline editor; committing happens on blur. Previously this fell
      // through to the shape branch and saved an invisible empty text element.
      setTextInput({ x: pos.x, y: pos.y, text: '' });
      return;
    }

    isDrawing.current = true;
    startPoint.current = pos;
    safeSetPointerCapture(e.target, e.pointerId);

    const myAuthor = user?.username || String(user?.id) || 'me';

    if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'laser' || currentTool === 'highlighter') {
      currentPath.current = {
        id: generateId(),
        type: 'path',
        tool: currentTool,
        points: [pos],
        color: brushColor,
        size: brushSize,
        author: myAuthor
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
        size: brushSize,
        author: myAuthor
      };
    }
  };

  // Eraser edits are collected here and flushed once per frame instead of firing a
  // socket message per stroke per interpolation step.
  const pendingEraserUpdates = useRef(new Map());
  const flushEraserUpdates = useCallback(() => {
    if (pendingEraserUpdates.current.size === 0) return;
    const batch = [...pendingEraserUpdates.current.values()];
    pendingEraserUpdates.current.clear();
    if (socketRef.current && socketRef.current.id) {
      socketRef.current.emit('update-elements', { boardId: studentId, elements: batch });
    }
  }, [studentId]);

  const erasePixel = (pos) => {
    let changed = false;
    const elementsToDelete = [];

    const nextElements = elementsRef.current.map(el => {
      if (el.type === 'path' && el.tool !== 'eraser') {
        const box = getElementBoundingBox(el);
        const pad = Math.max(brushSize, 20);
        if (box.minX !== undefined) {
            if (pos.x < box.minX - pad || pos.x > box.maxX + pad || pos.y < box.minY - pad || pos.y > box.maxY + pad) {
                return el;
            }
        }

        let pathMutated = false;
        const eraserRadius = Math.max(brushSize / 2, 8) + (el.size ? el.size / 2 : 2.5);
        const newPoints = [...el.points];

        for (let i = 0; i < newPoints.length; i++) {
           if (newPoints[i] === null) continue;
           const ptI = getPt(newPoints[i]);
           if (!ptI) continue;

           let isPointErased = Math.hypot(ptI.x - pos.x, ptI.y - pos.y) < eraserRadius;
           let isSegmentErased = false;

           if (!isPointErased && i > 0 && newPoints[i-1] !== null) {
               const ptPrev = getPt(newPoints[i-1]);
               if (ptPrev && distancePointToSegment(pos, ptPrev, ptI) < eraserRadius) {
                   isSegmentErased = true;
               }
           }

           if (isPointErased || isSegmentErased) {
               newPoints[i] = null;
               pathMutated = true;
           }
        }

        if (pathMutated) {
            changed = true;
            const hasVisible = newPoints.some(p => p !== null);
            if (!hasVisible) {
                elementsToDelete.push(el.id);
                return null;
            }
            const updatedEl = { ...el, points: newPoints, bbox: null, path2d: null };
            pendingEraserUpdates.current.set(updatedEl.id, updatedEl);
            return updatedEl;
        }
      }
      return el;
    }).filter(Boolean);

    if (elementsToDelete.length > 0 && socket && socket.id) {
        elementsToDelete.forEach(id => {
            socket.emit('delete-element', { boardId: studentId, elementId: id });
        });
    }

    if (changed) {
      elementsRef.current = nextElements;
      setElements(nextElements);
      if (fullRedrawRef.current) fullRedrawRef.current();
    }
  };

  const checkObjectEraserCollision = (pos, shapesOnly = false) => {
    const elIdx = elementsRef.current.findLastIndex(el => {
      if (!el || el.locked || el.type === 'image') return false;
      if (shapesOnly && el.type === 'path') return false; // Ignore pencil/path strokes in shapes-only mode
      return isPointInElement(pos, el, Math.max(brushSize || 10, 18));
    });
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
    // Palm rejection: If pen is active, ignore all touch movements completely
    if (activePointerType.current === 'pen' && e.pointerType === 'touch') {
      return;
    }

    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }

    // Pinch to zoom: ONLY for touch pointers when pen is not drawing
    const touchPointers = Array.from(activePointers.current.values()).filter(p => p.type === 'touch');
    if (touchPointers.length === 2 && activePointerType.current !== 'pen') {
        const currentDist = Math.hypot(touchPointers[0].x - touchPointers[1].x, touchPointers[0].y - touchPointers[1].y);
        const currentCenter = {
            x: (touchPointers[0].x + touchPointers[1].x) / 2,
            y: (touchPointers[0].y + touchPointers[1].y) / 2
        };

        if (isReadonly) return;

        if (lastPinchDist.current && lastPinchCenter.current) {
            if (Math.abs(currentDist - lastPinchDist.current) > 40 ||
                Math.abs(currentCenter.x - lastPinchCenter.current.x) > 40 ||
                Math.abs(currentCenter.y - lastPinchCenter.current.y) > 40) {
                twoFingerRef.current.moved = true;
            }
            const zoomDelta = currentDist / lastPinchDist.current;

            const dx = currentCenter.x - lastPinchCenter.current.x;
            const dy = currentCenter.y - lastPinchCenter.current.y;

            const rect = canvasRef.current.getBoundingClientRect();
            const mouseX = currentCenter.x - rect.left;
            const mouseY = currentCenter.y - rect.top;

            const prevZoom = zoomRef.current;
            const calculatedZoom = Math.max(0.1, Math.min(5, prevZoom * zoomDelta));
            setZoom(calculatedZoom);
            setPan(prevPan => {
                const nx = mouseX - (mouseX - (prevPan.x + dx)) * (calculatedZoom / prevZoom);
                const ny = mouseY - (mouseY - (prevPan.y + dy)) * (calculatedZoom / prevZoom);
                return clampPan(nx, ny, calculatedZoom);
            });
        }

        lastPinchDist.current = currentDist;
        lastPinchCenter.current = currentCenter;
        return;
    }

    const pos = getMousePos(e);
    const now = Date.now();

    // Throttle cursor emit to ~12fps (80ms) and only if moved > 2px to save massive bandwidth
    const lastPos = lastCursorPosRef.current;
    const distMoved = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y);
    if (socket && socket.id && (now - lastCursorEmitTime.current > 80) && distMoved > 2) {
      socket.emit('cursor-move', {
        boardId: studentId,
        username: user?.username || 'Unknown',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        color: user?.role === 'admin' ? '#ef4444' : '#3b82f6',
        role: user?.role || 'student',
        isTeacher: user?.role === 'admin'
      });
      lastCursorEmitTime.current = now;
      lastCursorPosRef.current = pos;
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
        queueRedraw(false);
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
        const shouldEmit = now - lastEmitTime.current > 60; // ~16fps drag throttle for smooth network sync

        const origMap = new Map();
        if (dragContext.current.origElements) {
            dragContext.current.origElements.forEach(oe => {
                if (oe && oe.id !== undefined) origMap.set(String(oe.id), oe);
            });
        }

        if (dragContext.current.type === 'rotateGroup') {
            dragContext.current.isMoved = true;
            const currentAngle = Math.atan2(pos.y - dragContext.current.cy, pos.x - dragContext.current.cx);
            let angleDelta = currentAngle - dragContext.current.startAngle;

            if (e.shiftKey) {
                const snapAngle = Math.PI / 12; // 15 degrees
                angleDelta = Math.round(angleDelta / snapAngle) * snapAngle;
            }

            elementsRef.current = elementsRef.current.map(el => {
                const origEl = origMap.get(String(el.id));
                if (!origEl) return el;
                const updated = { ...origEl };

                if (origEl.points && Array.isArray(origEl.points)) {
                    updated.points = origEl.points.map(p => {
                        if (!p) return null;
                        const pt = getPt(p);
                        if (!pt) return null;
                        const rotated = rotatePoint(pt.x, pt.y, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        return {
                            x: rotated.x,
                            y: rotated.y,
                            ...(p.pressure !== undefined ? { pressure: p.pressure } : {})
                        };
                    });
                    updated.bbox = null;
                    updated.path2d = null;
                }
                if (origEl.x1 !== undefined && origEl.y1 !== undefined && origEl.x2 !== undefined && origEl.y2 !== undefined) {
                    const p1 = rotatePoint(origEl.x1, origEl.y1, dragContext.current.cx, dragContext.current.cy, angleDelta);
                    const p2 = rotatePoint(origEl.x2, origEl.y2, dragContext.current.cx, dragContext.current.cy, angleDelta);
                    updated.x1 = p1.x; updated.y1 = p1.y;
                    updated.x2 = p2.x; updated.y2 = p2.y;
                }
                if (!origEl.points) {
                    if (updated.type === 'circle') {
                        const newCenter = rotatePoint(origEl.x, origEl.y, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        updated.x = newCenter.x;
                        updated.y = newCenter.y;
                    } else if (origEl.x !== undefined && origEl.y !== undefined) {
                        const origCX = origEl.x + (origEl.w || 0)/2;
                        const origCY = origEl.y + (origEl.h || 0)/2;
                        const newCenter = rotatePoint(origCX, origCY, dragContext.current.cx, dragContext.current.cy, angleDelta);
                        updated.x = newCenter.x - (origEl.w || 0)/2;
                        updated.y = newCenter.y - (origEl.h || 0)/2;
                        updated.rotation = (origEl.rotation || 0) + angleDelta;
                    }
                }
                return updated;
            });
            if (socket && socket.id && shouldEmit) {
              const moved = elementsRef.current.filter(el => origMap.has(String(el.id)));
              if (moved.length > 0) socket.emit('update-elements', { boardId: studentId, elements: moved });
            }
        } else {
            elementsRef.current = elementsRef.current.map(el => {
                const origEl = origMap.get(String(el.id));
                if (!origEl) return el;
                const updated = { ...origEl };

                if (dragContext.current.type === 'rotate') {
                    const rdx = pos.x - dragContext.current.cx;
                    const rdy = pos.y - dragContext.current.cy;
                    let angle = Math.atan2(rdy, rdx) + Math.PI/2;
                    if (e.shiftKey) {
                        const snapAngle = Math.PI / 12; // 15 degrees
                        angle = Math.round(angle / snapAngle) * snapAngle;
                    }
                    updated.rotation = angle;
                } else if (dragContext.current.type === 'move') {
                    if (Array.isArray(origEl.points)) {
                        updated.points = origEl.points.map(origPt => {
                            if (origPt === null || origPt === undefined) return null;
                            const pt = getPt(origPt);
                            if (!pt) return null;
                            return {
                                x: pt.x + dx,
                                y: pt.y + dy,
                                ...(origPt.pressure !== undefined ? { pressure: origPt.pressure } : {})
                            };
                        });
                        updated.bbox = null;
                        updated.path2d = null;
                    }
                    if (origEl.x !== undefined) updated.x = origEl.x + dx;
                    if (origEl.y !== undefined) updated.y = origEl.y + dy;
                    if (origEl.x1 !== undefined) updated.x1 = origEl.x1 + dx;
                    if (origEl.y1 !== undefined) updated.y1 = origEl.y1 + dy;
                    if (origEl.x2 !== undefined) updated.x2 = origEl.x2 + dx;
                    if (origEl.y2 !== undefined) updated.y2 = origEl.y2 + dy;
                } else if (dragContext.current.type === 'circle_center') {
                    if (updated.type === 'circle') {
                        updated.x = origEl.x + dx;
                        updated.y = origEl.y + dy;
                    }
                } else if (dragContext.current.type === 'circle_radius') {
                    if (updated.type === 'circle') {
                        const newR = Math.max(5, Math.hypot((pos.x - updated.x), (pos.y - updated.y)));
                        updated.w = newR;
                        updated.h = 0;
                    }
                } else if (dragContext.current.type === 'line_vertex') {
                    if (updated.type === 'line') {
                        if (dragContext.current.vertexIndex === 1) {
                            updated.x1 = origEl.x1 + dx;
                            updated.y1 = origEl.y1 + dy;
                        } else {
                            updated.x2 = origEl.x2 + dx;
                            updated.y2 = origEl.y2 + dy;
                        }
                    }
                } else if (dragContext.current.type === 'vertex') {
                    if (updated.type === 'polygon' || updated.isSnappedAngle || updated.isSnapped || updated.type === 'polyline') {
                        if (Array.isArray(origEl.points)) {
                            updated.points = origEl.points.map((p, idx) => {
                                if (idx === dragContext.current.vertexIndex) {
                                    return { x: p.x + dx, y: p.y + dy };
                                }
                                return p;
                            });
                            updated.bbox = null;
                            updated.path2d = null;
                        }
                    }
                } else if (dragContext.current.type === 'scale') {
                    const origW = dragContext.current.gMaxX - dragContext.current.gMinX;
                    const newW = Math.max(20, origW + dx);
                    const scale = origW === 0 ? 1 : newW / origW;

                    if (Array.isArray(origEl.points)) {
                        updated.points = origEl.points.map(origPt => {
                            if (origPt === null || origPt === undefined) return null;
                            const pt = getPt(origPt);
                            if (!pt) return null;
                            return {
                                x: dragContext.current.gMinX + (pt.x - dragContext.current.gMinX) * scale,
                                y: dragContext.current.gMinY + (pt.y - dragContext.current.gMinY) * scale,
                                ...(origPt.pressure !== undefined ? { pressure: origPt.pressure } : {})
                            };
                        });
                        updated.size = (origEl.size || 5) * scale;
                        updated.bbox = null;
                        updated.path2d = null;
                    }
                    if (origEl.x !== undefined) updated.x = dragContext.current.gMinX + (origEl.x - dragContext.current.gMinX) * scale;
                    if (origEl.y !== undefined) updated.y = dragContext.current.gMinY + (origEl.y - dragContext.current.gMinY) * scale;
                    if (origEl.x1 !== undefined) updated.x1 = dragContext.current.gMinX + (origEl.x1 - dragContext.current.gMinX) * scale;
                    if (origEl.y1 !== undefined) updated.y1 = dragContext.current.gMinY + (origEl.y1 - dragContext.current.gMinY) * scale;
                    if (origEl.x2 !== undefined) updated.x2 = dragContext.current.gMinX + (origEl.x2 - dragContext.current.gMinX) * scale;
                    if (origEl.y2 !== undefined) updated.y2 = dragContext.current.gMinY + (origEl.y2 - dragContext.current.gMinY) * scale;
                    if (origEl.w !== undefined) updated.w = origEl.w * scale;
                    if (origEl.h !== undefined) updated.h = origEl.h * scale;
                    if (origEl.size !== undefined) updated.size = origEl.size * scale;
                }
                return updated;
            });

            if (socket && socket.id && shouldEmit) {
                const moved = elementsRef.current.filter(el => origMap.has(String(el.id)));
                if (moved.length > 0) socket.emit('update-elements', { boardId: studentId, elements: moved });
            }
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
            } else if (dragContext.current.type === 'move') {
                if (dragContext.current.origLassoPath && Array.isArray(dragContext.current.origLassoPath)) {
                  activeLassoPathRef.current = dragContext.current.origLassoPath.map(p => ({
                      x: p.x + dx, y: p.y + dy
                  }));
                }
            } else if (dragContext.current.type === 'scale') {
                const origW = dragContext.current.gMaxX - dragContext.current.gMinX;
                const newW = Math.max(20, origW + dx);
                const scale = origW === 0 ? 1 : newW / origW;
                if (dragContext.current.origLassoPath && Array.isArray(dragContext.current.origLassoPath)) {
                  activeLassoPathRef.current = dragContext.current.origLassoPath.map(p => ({
                      x: dragContext.current.gMinX + (p.x - dragContext.current.gMinX) * scale,
                      y: dragContext.current.gMinY + (p.y - dragContext.current.gMinY) * scale
                  }));
                }
            }
        }

        if (shouldEmit) lastEmitTime.current = now;
        queueRedraw(true);
        return;
      }
    }

    if (!isDrawing.current) return;

    if (currentTool === 'eraser-object') {
      if (lastEraserPos.current) {
        const dist = Math.hypot(pos.x - lastEraserPos.current.x, pos.y - lastEraserPos.current.y);
        const steps = Math.min(64, Math.max(1, Math.ceil(dist / 10)));
        for (let i = 1; i <= steps; i++) {
          const interpPos = {
            x: lastEraserPos.current.x + (pos.x - lastEraserPos.current.x) * (i / steps),
            y: lastEraserPos.current.y + (pos.y - lastEraserPos.current.y) * (i / steps)
          };
          checkObjectEraserCollision(interpPos, false);
        }
      } else {
        checkObjectEraserCollision(pos, false);
      }
      lastEraserPos.current = pos;
      return;
    }
    if (currentTool === 'eraser') {
      if (lastEraserPos.current) {
          const dist = Math.hypot(pos.x - lastEraserPos.current.x, pos.y - lastEraserPos.current.y);
          // Cap the interpolation: a fast flick with a thin eraser used to generate
          // thousands of steps in one event and lock up the main thread.
          const steps = Math.min(64, Math.max(1, Math.ceil(dist / (Math.max(brushSize, 10) / 4))));
          for (let i = 1; i <= steps; i++) {
             const interpPos = {
                 x: lastEraserPos.current.x + (pos.x - lastEraserPos.current.x) * (i / steps),
                 y: lastEraserPos.current.y + (pos.y - lastEraserPos.current.y) * (i / steps)
             };
             erasePixel(interpPos);
             checkObjectEraserCollision(interpPos, true);
          }
      } else {
          erasePixel(pos);
          checkObjectEraserCollision(pos, true);
      }
      flushEraserUpdates();
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

    // Coalesced redraw: a live stroke only needs the draft layer repainted.
    queueRedraw(Boolean(dragContext.current));

    const shouldEmitDraw = now - lastEmitTime.current > 75; // ~13fps live stroke preview
    if (socket && socket.id && shouldEmitDraw && currentPath.current) {
      // Send only the points added since the last emit. This used to resend the
      // whole accumulated path every 75ms, so a 600-point stroke went out as
      // ~20,000 points -- the dominant source of egress during a lesson.
      const live = currentPath.current;
      const allPoints = Array.isArray(live.points) ? live.points : null;
      const sentSoFar = sentPointCountRef.current;
      const isFirstChunk = live.id !== sentStrokeIdRef.current;

      // Shapes carry no point array and are tiny; send them whole.
      // Always copy the slice. Handing out the live array by reference means any
      // point appended before the payload is serialised would be sent twice.
      const chunk = allPoints ? allPoints.slice(isFirstChunk ? 0 : sentSoFar) : null;
      const payload = chunk ? { ...live, points: chunk } : live;

      if (chunk && !isFirstChunk && chunk.length === 0) {
        // nothing new to show
      } else {
        socket.emit('draw-progress', {
          boardId: studentId,
          path: payload,
          socketId: socket.id,
          append: Boolean(chunk) && !isFirstChunk
        });
        if (chunk) {
          sentStrokeIdRef.current = live.id;
          // Record what was actually sent, not what existed at emit time.
          sentPointCountRef.current = isFirstChunk ? chunk.length : sentSoFar + chunk.length;
        }
        lastEmitTime.current = now;
      }
    }
  };

  const onPointerUp = (e) => {
    // Palm rejection: If pen is active, palm lift-off should be completely ignored!
    if (activePointerType.current === 'pen' && e.pointerType === 'touch') {
      activePointers.current.delete(e.pointerId);
      return;
    }

    const touchPointersBefore = Array.from(activePointers.current.values()).filter(p => p.type === 'touch');
    const wasTwoFingers = touchPointersBefore.length === 2 && activePointerType.current !== 'pen';
    activePointers.current.delete(e.pointerId);

    const touchPointersAfter = Array.from(activePointers.current.values()).filter(p => p.type === 'touch');
    if (wasTwoFingers && touchPointersAfter.length === 1) {
        if (!twoFingerRef.current.moved && twoFingerRef.current.downTime && (Date.now() - twoFingerRef.current.downTime < 700)) {
            twoFingerRef.current.downTime = 0;
            handleUndo();
        }
    }

    if (touchPointersAfter.length < 2) {
        lastPinchDist.current = null;
        lastPinchCenter.current = null;
    }

    if (activePointerId.current !== e.pointerId && e.pointerType !== 'pen') return;
    activePointerId.current = null;
    activePointerType.current = null;
    lastEraserPos.current = null;
    flushEraserUpdates();

    try {
      if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId);
      }
    } catch {}
    if (isPanning) {
      setIsPanning(false);
      return;
    }


    if ((currentTool === 'select' || currentTool === 'image') && currentPath.current && currentPath.current.type === 'lasso') {
      const lassoPoints = currentPath.current.points;
      if (lassoPoints.length > 2) {
        const selectedIds = [];
        elementsRef.current.forEach(el => {
          if (el.locked) return; // Never select locked elements (background pages/sheets)
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
          if (el.locked) return false;
          return isPointInElement(tapPos, el, 15 / zoom);
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
      // Snapshot the context first: it is cleared below, and a state updater that
      // reads dragContext.current can run after that and hit null.
      const drag = dragContext.current;
      dragContext.current = null;

      if (!drag.isMoved) {
          const rect = canvasRef.current.getBoundingClientRect();
          setContextMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
          setElements([...elementsRef.current]);
          if (socket && socket.id) {
            // One batched message instead of one per element.
            const moved = (drag.origElements || [])
              .filter(Boolean)
              .map(origEl => elementsRef.current.find(el => String(el.id) === String(origEl.id)))
              .filter(Boolean);
            if (moved.length > 0) {
              socket.emit('update-elements', { boardId: studentId, elements: moved });
            }
          }
      }
      isDrawing.current = false;
      if (fullRedrawRef.current) fullRedrawRef.current();
    }

    if (isDrawing.current && currentPath.current) {
      let stroke = currentPath.current;

      // Convert tool-drawn rectangle and triangle to polygon for editable vertices
      if (stroke.type === 'rectangle') {
         const x = Math.min(stroke.x, stroke.x + stroke.w);
         const y = Math.min(stroke.y, stroke.y + stroke.h);
         const w = Math.abs(stroke.w);
         const h = Math.abs(stroke.h);
         stroke = { ...stroke, type: 'polygon', points: [
             {x: x, y: y},
             {x: x + w, y: y},
             {x: x + w, y: y + h},
             {x: x, y: y + h}
         ] };
      } else if (stroke.type === 'triangle') {
         const x = Math.min(stroke.x, stroke.x + stroke.w);
         const y = Math.min(stroke.y, stroke.y + stroke.h);
         const w = Math.abs(stroke.w);
         const h = Math.abs(stroke.h);
         stroke = { ...stroke, type: 'polygon', points: [
             {x: x + w / 2, y: y},
             {x: x + w, y: y + h},
             {x: x, y: y + h}
         ] };
      }

      // Don't save laser strokes to the permanent board elements
      // Don't save laser strokes to the permanent board elements
      if (stroke.tool !== 'laser') {
        const myAuthor = user?.username || String(user?.id) || 'me';
        stroke = { ...stroke, author: stroke.author || myAuthor };
        // Optimistic update for zero-flicker rendering
        elementsRef.current = [...elementsRef.current, stroke];

        setElements(prev => [...prev, stroke]);
        setMyRedoStack([]);
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
    sentStrokeIdRef.current = null;
    sentPointCountRef.current = 0;
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
      if (elementsRef.current.length === 0) {
          alert('ไม่มีข้อมูลให้ Export (No data to export)');
          return;
      }

      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = 'wait';

      try {
          // Preload all images so they are fully loaded into memory before drawing
          const imageElements = elementsRef.current.filter(el => (el.type === 'image' || el.type === 'math') && el.url);
          await Promise.all(imageElements.map(el => {
            return new Promise((resolve) => {
              const cached = imageCacheRef.current[el.url];
              if (cached instanceof HTMLImageElement && cached.complete && cached.naturalWidth > 0) {
                return resolve();
              }
              const img = new Image();
              img.crossOrigin = 'Anonymous';
              img.onload = () => {
                imageCacheRef.current[el.url] = img;
                resolve();
              };
              img.onerror = () => {
                resolve();
              };
              img.src = el.url;
            });
          }));

          const docPages = elementsRef.current.filter(el => el.isPage);
          const isDocumentMode = docPages.length > 0;

          const pdf = new jsPDF({
            orientation: 'p',
            unit: 'pt',
            format: 'a4',
            compress: true
          });
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = pdf.internal.pageSize.getHeight();

          if (isDocumentMode) {
            // Sort document pages from top to bottom (page 1, page 2, ...)
            const sortedPages = [...docPages].sort((a, b) => (a.y || 0) - (b.y || 0));

            for (let pIdx = 0; pIdx < sortedPages.length; pIdx++) {
              if (pIdx > 0) pdf.addPage();
              const page = sortedPages[pIdx];

              // Target page canvas at crisp 2x resolution (e.g. 1600 x 2200)
              const targetW = 1600;
              const targetH = Math.round(targetW * ((page.h || 1100) / (page.w || 800)));
              const scale = targetW / (page.w || 800);

              const pageCanvas = document.createElement('canvas');
              pageCanvas.width = targetW;
              pageCanvas.height = targetH;
              const ctx = pageCanvas.getContext('2d');
              ctx.isExporting = true;

              // Crisp white page background
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetW, targetH);

              ctx.save();
              ctx.scale(scale, scale);
              ctx.translate(-page.x, -page.y);

              // 1. Draw page background image
              drawElement(ctx, page, scale);

              // 2. Draw all non-page elements that overlap with this page
              const pageBox = { minX: page.x, minY: page.y, maxX: page.x + page.w, maxY: page.y + page.h };
              const overlappingElements = elementsRef.current.filter(el => {
                if (el.isPage) return false;
                const b = getElementBoundingBox(el);
                if (b.minX === undefined || isNaN(b.minX)) return true;
                return !(b.maxX < pageBox.minX || b.minX > pageBox.maxX || b.maxY < pageBox.minY || b.minY > pageBox.maxY);
              });

              // Draw overlapping images first, then strokes/shapes
              overlappingElements.filter(el => el.type === 'image').forEach(el => drawElement(ctx, el, scale));
              overlappingElements.filter(el => el.type !== 'image').forEach(el => drawElement(ctx, el, scale));

              ctx.restore();

              const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
              pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
            }
          } else {
            // Free Whiteboard Mode (no uploaded PDF document)
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            elementsRef.current.forEach(el => {
              const bbox = getElementBoundingBox(el);
              if (bbox.minX !== undefined && !isNaN(bbox.minX)) {
                minX = Math.min(minX, bbox.minX);
                minY = Math.min(minY, bbox.minY);
                maxX = Math.max(maxX, bbox.maxX);
                maxY = Math.max(maxY, bbox.maxY);
              }
            });

            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
              alert('ไม่พบขอบเขตของเนื้อหาบนกระดาน');
              return;
            }

            const padding = 40;
            minX -= padding;
            minY -= padding;
            maxX += padding;
            maxY += padding;

            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) {
              alert('ขนาดพื้นที่กระดานไม่ถูกต้อง');
              return;
            }

            const a4Ratio = pdfWidth / pdfHeight; // ~0.707

            // If content fits comfortably on one page (ratio close to A4 or single screen)
            if (height <= (width / a4Ratio) * 1.5) {
              const targetW = 1600;
              const targetH = Math.round(targetW / a4Ratio);

              const scale = Math.min((targetW - 80) / width, (targetH - 80) / height);
              const offsetX = (targetW - width * scale) / 2;
              const offsetY = (targetH - height * scale) / 2;

              const canvas = document.createElement('canvas');
              canvas.width = targetW;
              canvas.height = targetH;
              const ctx = canvas.getContext('2d');
              ctx.isExporting = true;

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetW, targetH);

              ctx.save();
              ctx.translate(offsetX, offsetY);
              ctx.scale(scale, scale);
              ctx.translate(-minX, -minY);

              elementsRef.current.filter(el => el.type === 'image').forEach(el => drawElement(ctx, el, scale));
              elementsRef.current.filter(el => el.type !== 'image').forEach(el => drawElement(ctx, el, scale));
              ctx.restore();

              const imgData = canvas.toDataURL('image/jpeg', 0.92);
              pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
            } else {
              // Tall whiteboard notes -> Paginate into clean A4 pages
              const pageContentHeight = width / a4Ratio;
              let currentY = minY;
              let pageNum = 1;

              while (currentY < maxY) {
                if (pageNum > 1) pdf.addPage();

                const targetW = 1600;
                const targetH = Math.round(targetW / a4Ratio);
                const scale = targetW / width;

                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = targetW;
                pageCanvas.height = targetH;
                const ctx = pageCanvas.getContext('2d');
                ctx.isExporting = true;

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, targetW, targetH);

                ctx.save();
                ctx.scale(scale, scale);
                ctx.translate(-minX, -currentY);

                // Clip to current page view
                ctx.beginPath();
                ctx.rect(minX, currentY, width, pageContentHeight);
                ctx.clip();

                elementsRef.current.filter(el => el.type === 'image').forEach(el => drawElement(ctx, el, scale));
                elementsRef.current.filter(el => el.type !== 'image').forEach(el => drawElement(ctx, el, scale));
                ctx.restore();

                const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');

                currentY += pageContentHeight;
                pageNum++;
              }
            }
          }

          const filename = `ppark_board_${Date.now()}.pdf`;
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
          if (isIOS) {
              const blob = pdf.output('blob');
              const blobUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = blobUrl;
              link.download = filename;
              link.target = '_blank';
              document.body.appendChild(link);
              link.click();
              setTimeout(() => {
                  document.body.removeChild(link);
                  URL.revokeObjectURL(blobUrl);
              }, 5000);
          } else {
              pdf.save(filename);
          }
      } catch (err) {
          console.error('Export failed', err);
          alert('Export failed: ' + (err?.message || err));
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
                // Pages were already broadcast one by one above; emitting the whole
                // board again here duplicated them on the other clients.
                elementsRef.current = [...elementsRef.current, ...newElements];
                setElements(elementsRef.current);
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

      const myAuthor = user?.username || String(user?.id) || 'me';
      const newEl = {
        id: generateId(),
        author: myAuthor,
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
        setMyRedoStack([]);
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
      const myAuthor = user?.username || String(user?.id) || 'me';

      els.forEach(el => {
          const clone = JSON.parse(JSON.stringify(el));
          clone.id = generateId();
          clone.author = myAuthor;

          if (clone.type === 'path') {
              clone.points = clone.points.map(pt => pt ? { x: pt.x + dx, y: pt.y + dy } : null);
              clone.path2d = null;
          } else if (Array.isArray(clone.points)) {
              clone.points = clone.points.map(pt => pt ? { x: pt.x + dx, y: pt.y + dy } : null);
              clone.bbox = null;
          } else {
              if (clone.x !== undefined) clone.x += dx;
              if (clone.y !== undefined) clone.y += dy;
              // x2/y2 were missed here, which stretched every pasted line.
              if (clone.x1 !== undefined) { clone.x1 += dx; clone.y1 += dy; }
              if (clone.x2 !== undefined) { clone.x2 += dx; clone.y2 += dy; }
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
          setMyRedoStack([]);

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
              } catch {}
          }
      } catch {}

      const localStr = localStorage.getItem('ppark_clipboard');
      if (localStr) {
         try {
            const parsed = JSON.parse(localStr);
            if (parsed && parsed.type === 'ppark_clipboard' && Array.isArray(parsed.elements)) {
                pasteElements(parsed.elements, pos);
                return;
            }
         } catch {}
      }

      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find(t => t.includes('image/')));
          const file = new File([blob], 'pasted-image.png', { type: blob.type });
          const formData = new FormData();
          formData.append('file', file);
          const uploadRes = await axios.post(`${API_URL}/api/upload`, formData, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const publicUrl = uploadRes.data.url;

          const myAuthor = user?.username || String(user?.id) || 'me';
          const newEl = {
            id: generateId(),
            author: myAuthor,
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
            setMyRedoStack([]);
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
          const myAuthor = user?.username || String(user?.id) || 'me';
          const newEl = {
              id: generateId(),
              author: myAuthor,
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
          setMyRedoStack([]);
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
         } catch {}
      }

      try {
        const text = await navigator.clipboard.readText();
        if (text) {
           const myAuthor = user?.username || String(user?.id) || 'me';
           const newEl = {
               id: generateId(),
               author: myAuthor,
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
           setMyRedoStack([]);
           if (fullRedrawRef.current) fullRedrawRef.current();
           if (socket && socket.id) socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });
        }
      } catch {
          alert('ไม่สามารถอ่านข้อมูลจาก Clipboard ได้ โปรดอนุญาตสิทธิ์ (Permission) หรือคัดลอกข้อความ/รูปภาพก่อนครับ');
      }
    }
  };

  // Per-User Undo: only undoes the last element created by the current user
  const handleUndo = () => {
    if (isReadonly) return;
    const myAuthorId = user?.username || String(user?.id) || 'me';

    // Find the last element created by this user
    let targetIndex = -1;
    for (let i = elementsRef.current.length - 1; i >= 0; i--) {
      const el = elementsRef.current[i];
      if (el.isPage || el.locked) continue;
      // Match current user
      if (el.author === myAuthorId) {
        targetIndex = i;
        break;
      }
    }

    // Fallback: If no element has author tag yet (legacy elements), only allow undo if this is the user's private board or single user
    if (targetIndex === -1) {
      showToast('ไม่มีสิ่งที่จะย้อนกลับของคุณ');
      return;
    }

    const elementToUndo = elementsRef.current[targetIndex];
    const newElements = elementsRef.current.filter(el => el.id !== elementToUndo.id);

    elementsRef.current = newElements;
    setElements(newElements);
    setMyRedoStack(prev => [...prev, elementToUndo]);

    if (fullRedrawRef.current) fullRedrawRef.current();

    // Broadcast targeted delete so other clients and server delete only this specific stroke
    if (socket && socket.id) {
      socket.emit('delete-element', { boardId: studentId, elementId: elementToUndo.id });
    }

    showToast('ย้อนกลับ (Undo)');
  };

  // Per-User Redo: only redoes the last element undone by the current user
  const handleRedo = () => {
    if (isReadonly) return;
    if (myRedoStack.length === 0) {
      showToast('ไม่มีสิ่งที่จะทำซ้ำ');
      return;
    }

    const elementToRedo = myRedoStack[myRedoStack.length - 1];
    setMyRedoStack(prev => prev.slice(0, -1));

    const newElements = [...elementsRef.current, elementToRedo];
    elementsRef.current = newElements;
    setElements(newElements);

    if (fullRedrawRef.current) fullRedrawRef.current();

    if (socket && socket.id) {
      socket.emit('draw-stroke', { boardId: studentId, stroke: elementToRedo, socketId: socket.id });
    }

    showToast('ทำซ้ำ (Redo)');
  };

  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  const handleClear = () => {
    if (isReadonly) return;
    // Students may only clear their own board, never the shared teacher board.
    if (user?.role !== 'admin' && String(user?.id) !== studentId) {
      showToast('ล้างได้เฉพาะกระดานของตัวเองครับ');
      return;
    }
    if (confirm('Are you sure you want to clear the canvas?')) {
      setElements([]);
      elementsRef.current = [];
      if (fullRedrawRef.current) fullRedrawRef.current();
      if (socket) {
        if (studentId.startsWith('teacher_board')) {
            const groupName = decodeURIComponent(studentId.replace('teacher_board_', ''));
            socket.emit('teacher-clear-room', groupName);
            socket.emit('clear-canvas', studentId); // Also clear self to be safe
        } else {
            socket.emit('clear-canvas', studentId);
        }
      }
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
        alert('ยังไม่พบตำแหน่งของนักเรียนครับ (นักเรียนอาจจะยังไม่ได้ขยับเมาส์ในตอนนี้)');
    }
  };

  // Track Teacher system for students
  const trackTeacher = (showNotification = true) => {
    try {
      if (!containerRef.current) return false;
      const viewportWidth = containerRef.current.clientWidth;
      const viewportHeight = containerRef.current.clientHeight;

      let teacherPos = null;

      // 1. Try to find active teacher cursor
      const activeTeacherCursor = Object.values(cursors).find(c =>
        c.isTeacher || c.role === 'admin' || c.color === '#ef4444' || (c.username && (c.username.toLowerCase().includes('ครู') || c.username.toLowerCase() === 'admin'))
      );
      if (activeTeacherCursor && isFinite(activeTeacherCursor.x) && isFinite(activeTeacherCursor.y)) {
        teacherPos = { x: activeTeacherCursor.x, y: activeTeacherCursor.y };
      }

      // 2. Try remote drawing path from teacher in progress
      if (!teacherPos && remotePaths.current) {
        const pathIds = Object.keys(remotePaths.current);
        if (pathIds.length > 0) {
          const path = remotePaths.current[pathIds[0]];
          if (path && path.points && path.points.length > 0) {
            const lastPoint = path.points[path.points.length - 1];
            if (lastPoint && isFinite(lastPoint.x) && isFinite(lastPoint.y)) {
              teacherPos = { x: lastPoint.x, y: lastPoint.y };
            }
          }
        }
      }

      // 3. Try last known teacher viewport
      if (!teacherPos && lastTeacherViewportRef.current) {
        const tv = lastTeacherViewportRef.current;
        if (tv.pan && tv.zoom) {
          const teacherCenterX = -tv.pan.x / tv.zoom + (tv.width || viewportWidth) / (2 * tv.zoom);
          const teacherCenterY = -tv.pan.y / tv.zoom + (tv.height || viewportHeight) / (2 * tv.zoom);
          if (isFinite(teacherCenterX) && isFinite(teacherCenterY)) {
            teacherPos = { x: teacherCenterX, y: teacherCenterY };
          }
        }
      }

      // 4. Try most recent element drawn by teacher (or not by this student)
      if (!teacherPos && elementsRef.current && elementsRef.current.length > 0) {
        const myUsername = user?.username || String(user?.id);
        const teacherEls = elementsRef.current.filter(el => !el.isPage && el.author && el.author !== myUsername);
        if (teacherEls.length > 0) {
          const lastEl = teacherEls[teacherEls.length - 1];
          const box = getElementBoundingBox(lastEl);
          if (box && box.minX !== undefined && isFinite(box.minX) && isFinite(box.maxX)) {
            teacherPos = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
          }
        }
      }

      // 5. Fallback: most recent non-page element on the board overall
      if (!teacherPos && elementsRef.current && elementsRef.current.length > 0) {
        const nonPageEls = elementsRef.current.filter(el => !el.isPage);
        const targetEl = nonPageEls.length > 0 ? nonPageEls[nonPageEls.length - 1] : elementsRef.current[elementsRef.current.length - 1];
        if (targetEl) {
          const box = getElementBoundingBox(targetEl);
          if (box && box.minX !== undefined && isFinite(box.minX) && isFinite(box.maxX)) {
            teacherPos = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
          }
        }
      }

      if (teacherPos) {
        const targetPan = clampPan(
          viewportWidth / 2 - teacherPos.x * zoom,
          viewportHeight / 2 - teacherPos.y * zoom,
          zoom
        );
        setPan(targetPan);
        setTeacherTrackPing({ x: teacherPos.x, y: teacherPos.y, key: Date.now() });
        setTimeout(() => setTeacherTrackPing(null), 3000);
        return true;
      } else {
        if (showNotification) {
          alert('ยังไม่พบตำแหน่งของคุณครูหรือเนื้อหาบนกระดานครับ');
        }
        return false;
      }
    } catch (err) {
      console.warn('Error in trackTeacher:', err);
      return false;
    }
  };

  const trackTeacherRef = useRef(trackTeacher);
  trackTeacherRef.current = trackTeacher;

  // Reset auto-track status when studentId changes
  useEffect(() => {
    hasAutoTrackedRef.current = false;
    lastTeacherViewportRef.current = null;
  }, [studentId]);

  // Auto-track teacher on initial join for students
  useEffect(() => {
    if (user?.role === 'admin' || hasAutoTrackedRef.current) return;

    const hasTeacherCursor = Object.values(cursors).some(c =>
      c.isTeacher || c.role === 'admin' || c.color === '#ef4444' || (c.username && (c.username.toLowerCase().includes('ครู') || c.username.toLowerCase() === 'admin'))
    );
    const hasElements = elements.length > 0;
    const hasTeacherViewport = !!lastTeacherViewportRef.current;

    if (hasTeacherCursor || hasTeacherViewport || hasElements) {
      const timer = setTimeout(() => {
        if (!hasAutoTrackedRef.current) {
          const success = trackTeacherRef.current(false);
          if (success) {
            hasAutoTrackedRef.current = true;
          }
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [elements, cursors, user?.role]);

  const teacherCursor = Object.values(cursors).find(c =>
    c.isTeacher || c.role === 'admin' || c.color === '#ef4444' || (c.username && (c.username.toLowerCase().includes('ครู') || c.username.toLowerCase() === 'admin'))
  );

  const isTeacherOnline = !!teacherCursor || !!lastTeacherViewportRef.current;

  const isTeacherOffScreen = useMemo(() => {
    if (!teacherCursor || !containerRef.current) return false;
    const screenX = teacherCursor.x * zoom + pan.x;
    const screenY = teacherCursor.y * zoom + pan.y;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    return screenX < 20 || screenX > w - 20 || screenY < 20 || screenY > h - 20;
  }, [teacherCursor, zoom, pan]);

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
          if (selectedElementIds.includes(el.id) && !el.locked) {
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
      const myAuthor = user?.username || String(user?.id) || 'me';

      elementsRef.current.forEach(el => {
          if (selectedElementIds.includes(el.id)) {
              const clone = JSON.parse(JSON.stringify(el));
              clone.id = generateId();
              clone.author = myAuthor;

              const offset = 20 / zoom;
              if (clone.type === 'path') {
                  clone.points = clone.points.map(pt => pt ? { x: pt.x + offset, y: pt.y + offset } : null);
                  clone.path2d = null;
              } else if (Array.isArray(clone.points)) {
                  clone.points = clone.points.map(pt => pt ? { x: pt.x + offset, y: pt.y + offset } : null);
                  clone.bbox = null;
              } else {
                  if (clone.x !== undefined) clone.x += offset;
                  if (clone.y !== undefined) clone.y += offset;
                  if (clone.x1 !== undefined) { clone.x1 += offset; clone.y1 += offset; }
                  if (clone.x2 !== undefined) { clone.x2 += offset; clone.y2 += offset; }
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
          setMyRedoStack([]);

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
      <div className="absolute top-1 right-2 z-50 pointer-events-none opacity-40 text-[10px] font-mono text-gray-500">
        v2.5
      </div>
      {!isReadonly && (
        <div
          className="absolute top-4 left-4 z-50 flex flex-col md:flex-row gap-2 items-start"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {user?.role === 'admin' ? (
            <div className="flex items-center gap-1.5 md:gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); navigate('/admin'); }}
                className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 bg-white/90 backdrop-blur shadow-lg border border-gray-100 rounded-2xl text-gray-700 hover:bg-gray-50 font-medium transition-colors text-xs md:text-sm"
                title="Back to Dashboard"
              >
                <ArrowLeft size={18} /> <span className="hidden 2xl:inline">Dashboard</span>
              </button>
              {returnGroup && (
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/monitor/${encodeURIComponent(returnGroup)}`); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 bg-blue-50/90 backdrop-blur shadow-lg border border-blue-100 rounded-2xl text-blue-700 hover:bg-blue-100 font-medium transition-colors text-xs md:text-sm"
                  title={`Back to Monitor (${returnGroup})`}
                >
                  <ArrowLeft size={18} /> <span className="hidden 2xl:inline">Monitor</span>
                </button>
              )}
              <button
                onClick={trackStudentCursor}
                className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 bg-indigo-50/90 backdrop-blur shadow-lg border border-indigo-100 rounded-2xl text-indigo-700 hover:bg-indigo-100 font-medium transition-colors text-xs md:text-sm"
                title="Track Student (หาเมาส์นักเรียน)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
                <span className="hidden 2xl:inline">Track Student</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 md:gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (studentId.startsWith('teacher_board')) {
                    navigate(`/board/${user.id}`);
                  } else {
                    const tb = user?.group_name ? `/board/teacher_board_${encodeURIComponent(user.group_name)}` : '/board/teacher_board';
                    navigate(tb);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 backdrop-blur shadow-lg border rounded-2xl font-medium transition-colors text-xs md:text-sm ${
                  studentId.startsWith('teacher_board')
                    ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                }`}
                title={studentId.startsWith('teacher_board') ? 'กลับกระดานส่วนตัว' : 'ไปที่บอร์ดของครู (Teacher Board)'}
              >
                <ArrowLeft size={18} className={studentId.startsWith('teacher_board') ? '' : 'rotate-180'} />
                <span className="hidden 2xl:inline">
                  {studentId.startsWith('teacher_board') ? 'กระดานส่วนตัว' : 'บอร์ดครู'}
                </span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  trackTeacher(true);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 backdrop-blur shadow-lg border rounded-2xl font-medium transition-all text-xs md:text-sm ${
                  isTeacherOnline
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 hover:shadow-emerald-100'
                    : 'bg-white/95 text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
                title="หาตำแหน่งคุณครูบนกระดาน (Track Teacher)"
              >
                <span className="relative flex h-2.5 w-2.5">
                  {isTeacherOnline && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isTeacherOnline ? 'bg-emerald-500' : 'bg-gray-300'}`}></span>
                </span>
                <span className="hidden 2xl:inline font-semibold">
                  {isTeacherOnline ? '🎯 ตามครู' : '🎯 หาตำแหน่งครู'}
                </span>
              </button>

              {String(user?.id) === studentId && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 bg-red-50/90 backdrop-blur shadow-lg border border-red-100 rounded-2xl text-red-700 hover:bg-red-100 font-medium transition-colors text-xs md:text-sm"
                  title="Clear Board"
                >
                  <Trash2 size={18} />
                  <span className="hidden 2xl:inline">Clear Board</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}


      {toastMsg && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[9998] pointer-events-none">
          <div className="px-4 py-2 rounded-full bg-gray-900/85 text-white text-sm font-medium shadow-lg backdrop-blur">
            {toastMsg}
          </div>
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
            src={`/board/${user?.group_name ? `teacher_board_${encodeURIComponent(user.group_name)}` : 'teacher_board'}?readonly=true`}
            className="w-full h-full border-none pointer-events-none"
            title="Teacher Board PIP"
          />
        </div>
      )}


      <TeacherShortcutBar currentBoardId={studentId} />


      {/* Floating indicator when teacher is drawing off-screen */}
      {user?.role !== 'admin' && teacherCursor && isTeacherOffScreen && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 animate-bounce">
          <button
            onClick={(e) => {
              e.stopPropagation();
              trackTeacher(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600/95 hover:bg-indigo-700 text-white font-medium text-xs md:text-sm rounded-full shadow-2xl backdrop-blur border-2 border-indigo-300 cursor-pointer active:scale-95 transition-transform"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
            </span>
            <span>คุณครูกำลังสอนอยู่นอกจอ แตะเพื่อตามไปดู 🎯</span>
          </button>
        </div>
      )}
{!isReadonly && (
        <Toolbar
          currentTool={currentTool} setCurrentTool={setCurrentTool}
          penMode={penMode} setPenMode={setPenMode}
          brushColor={brushColor} setBrushColor={setBrushColor}
          setBrushSize={setBrushSize}
          handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} handleResetZoom={handleResetZoom}
          handleClear={handleClear} handleUndo={handleUndo} handleRedo={handleRedo}
          canUndo={elements.some(el => !el.isPage && !el.locked && el.author === (user?.username || String(user?.id) || 'me'))}
          canRedo={myRedoStack.length > 0}
          handleUpload={handleUpload}
          bgTemplate={bgTemplate} setBgTemplate={setBgTemplate}
          handleExport={handleExport}
          isPresentationMode={isPresentationMode} setIsPresentationMode={setIsPresentationMode}
          isAdmin={user?.role === 'admin'}
          canClear={user?.role === 'admin' || String(user?.id) === studentId}
        />
      )}

      <div
        ref={containerRef}
        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
        className={`relative flex-1 w-full h-full select-none touch-none ${
          isPanning ? 'cursor-grabbing' : (currentTool === 'pan' ? 'cursor-grab' : (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'eraser-object' ? 'cursor-crosshair' : 'cursor-default'))
        }`}
      >
        <canvas
          ref={canvasRef}
          style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
          className="absolute inset-0 w-full h-full bg-white select-none touch-none"
        />
        <canvas
          ref={draftCanvasRef}
          style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
          className="absolute inset-0 w-full h-full select-none touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => {
            if (activePointerType.current === 'pen' && e.pointerType === 'touch') {
              activePointers.current.delete(e.pointerId);
              return;
            }
            activePointerId.current = null;
            activePointerType.current = null;
            onPointerUp(e);
          }}
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


        {/* Radar ping effect when tracking teacher */}
        {teacherTrackPing && (
          <div
            key={teacherTrackPing.key}
            className="absolute pointer-events-none z-30 transition-all duration-300"
            style={{
              left: `${teacherTrackPing.x * zoom + pan.x}px`,
              top: `${teacherTrackPing.y * zoom + pan.y}px`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="relative flex items-center justify-center">
              <span className="absolute w-32 h-32 rounded-full bg-indigo-500/20 animate-ping" />
              <span className="absolute w-20 h-20 rounded-full bg-indigo-500/30 animate-pulse" />
              <div className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-full shadow-2xl border-2 border-white flex items-center gap-1.5 whitespace-nowrap">
                <span>🎯</span>
                <span>ตำแหน่งคุณครู</span>
              </div>
            </div>
          </div>
        )}
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
                onBlur={() => {
                    if (textInput.text.trim()) {
                        const ctx = getMeasureCtx();
                        ctx.font = `${brushSize * 3}px sans-serif`;
                        const metrics = ctx.measureText(textInput.text);

                        const myAuthor = user?.username || String(user?.id) || 'me';
                        const newEl = {
                            id: generateId(),
                            author: myAuthor,
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
                        setMyRedoStack([]);
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
