import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { getStroke } from 'perfect-freehand';

// Utility for freehand path
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

const MiniBoard = ({ student, token }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  
  const [elements, setElements] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [redrawTrigger, setRedrawTrigger] = useState(0);
  const [renderError, setRenderError] = useState(null);
  const imageCacheRef = useRef({});
  const remotePaths = useRef({});
  const remoteViewport = useRef(null);

  // Fetch initial board state
  useEffect(() => {
    const fetchBoard = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/boards/${student.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        let parsed = [];
        if (res.data.canvas_data) {
            parsed = res.data.canvas_data;
            if (typeof parsed === 'string') {
              try { parsed = JSON.parse(parsed); } catch(e) { parsed = []; }
            }
            if (typeof parsed === 'string') {
              try { parsed = JSON.parse(parsed); } catch(e) { parsed = []; }
            }
        }
        setElements(Array.isArray(parsed) ? parsed : []);
      } catch (err) {
        console.error('Failed to load board for', student.username, err);
      }
    };
    fetchBoard();
  }, [student.id, token]);

  // Socket connection
  useEffect(() => {
    const socket = io(API_URL);
    
    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join-board', { boardId: student.id, role: 'admin' });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('canvas-update', (updatedElements) => {
      setElements(updatedElements);
    });

    socket.on('draw-progress', (data) => {
      if (data.path === null) {
        delete remotePaths.current[data.socketId];
      } else {
        remotePaths.current[data.socketId] = data.path;
      }
      setRedrawTrigger(prev => prev + 1);
    });

    socket.on('draw-stroke', (data) => {
      setElements(prev => [...prev, data.stroke]);
      delete remotePaths.current[data.socketId];
    });

    socket.on('undo', () => {
      setElements(prev => prev.slice(0, -1));
    });

    socket.on('clear-canvas', () => {
      setElements([]);
    });

    socket.on('update-element', (data) => {
      setElements(prev => prev.map(el => el.id === data.element.id ? data.element : el));
    });

    socket.on('delete-element', ({ elementId }) => {
      setElements(prev => prev.filter(el => el.id !== elementId));
    });

    socket.on('viewport-update', (data) => {
      remoteViewport.current = data;
      setRedrawTrigger(prev => prev + 1);
    });

    return () => {
      socket.disconnect();
    };
  }, [student.id]);

  const drawElement = useCallback((ctx, el, currentScale = 1.0) => {
    if (!el || !el.type) return;
    try {
      ctx.save();
      ctx.beginPath();
      
      if (el.tool === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.6;
      }
      
      ctx.strokeStyle = el.color || '#000000';
      ctx.fillStyle = el.color || '#000000';
      let lw = el.size || 5;
      // Ensure line is at least 1.5 physical pixels thick
      const minPhysical = 1.5;
      if (lw * currentScale < minPhysical) {
        lw = minPhysical / currentScale;
      }
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (el.type === 'path') {
        if (el.points && el.points.length > 0) {
          let p2dToDraw = el.path2d;
          if (!p2dToDraw || !(p2dToDraw instanceof Path2D)) {
            const p2d = new Path2D();
            let pts = [];
            
            const drawFreehand = (points) => {
                if (!points || points.length === 0) return;
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
            
            try { el.path2d = p2d; } catch (e) {}
            p2dToDraw = p2d;
          }
          ctx.fill(p2dToDraw);
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
            redrawCanvas(); // Force redraw when image loads
          };
          imageCacheRef.current[el.url] = 'loading';
        } else if (imageCacheRef.current[el.url] !== 'loading') {
          const img = imageCacheRef.current[el.url];
          ctx.drawImage(img, el.x || 0, el.y || 0, el.w || 100, el.h || 100);
        }
      } else if (el.type === 'text') {
        let fSize = el.size || 20;
        const minPhysicalFont = 12;
        if (fSize * currentScale < minPhysicalFont) {
          fSize = minPhysicalFont / currentScale;
        }
        ctx.font = `${fSize}px sans-serif`;
        ctx.fillStyle = el.color || '#000000';
        ctx.textBaseline = 'top';
        ctx.fillText(el.text || '', el.x || 0, el.y || 0);
      } else if (el.type === 'postit') {
        const padding = 12;
        let fontSize = el.size || 20;
        const minPhysicalFont = 10;
        if (fontSize * currentScale < minPhysicalFont) {
          fontSize = minPhysicalFont / currentScale;
        }
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
    } catch (e) {
      console.error(e);
    } finally {
      ctx.restore();
    }
  }, []);

  const redrawCanvas = useCallback(() => {
    try {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Set a solid background for the thumbnail
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Viewport debug indicator
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = remoteViewport.current ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 0, 0, 0.8)';
    ctx.font = '12px sans-serif';
    ctx.fillText(remoteViewport.current ? 'SYNCED' : 'NOT SYNCED', 10, 50);
    if (remoteViewport.current) {
        ctx.fillText('P:' + remoteViewport.current.pan.x + ',' + remoteViewport.current.pan.y, 10, 65);
        ctx.fillText('Z:' + remoteViewport.current.zoom, 10, 80);
        ctx.fillText('S:' + remoteViewport.current.width + 'x' + remoteViewport.current.height, 10, 95);
        ctx.fillText('E:' + elements.length, 10, 110);
    }
    ctx.restore();

    ctx.save();
    const cWidth = canvas.width || 300;
    const cHeight = canvas.height || 200;

    if (remoteViewport.current) {
        const { pan, zoom, width, height } = remoteViewport.current;
        const screenW = width || 1920;
        const screenH = height || 1080;
        const scaleX = cWidth / screenW;
        const scaleY = cHeight / screenH;
        const baseScale = Math.min(scaleX, scaleY);
        const scaledScreenW = screenW * baseScale;
        const scaledScreenH = screenH * baseScale;
        const offsetX = (cWidth - scaledScreenW) / 2;
        const offsetY = (cHeight - scaledScreenH) / 2;
        ctx.translate(offsetX, offsetY);
        ctx.scale(baseScale, baseScale);
        ctx.translate(pan.x || 0, pan.y || 0);
        ctx.scale(zoom || 1, zoom || 1);
    } else {
        let scale = 0.3;
        let translateX = 0;
        let translateY = 0;
        const allElements = [...elements];
        Object.values(remotePaths.current).forEach(path => {
            if (path) allElements.push(path);
        });
        if (allElements.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            allElements.forEach(el => {
                if (!el) return;
                if (el.type === 'path' || el.type === 'lasso') {
                    if (el.points && Array.isArray(el.points)) {
                        el.points.forEach(pt => {
                            if (pt) {
                                if (pt[0] < minX) minX = pt[0];
                                if (pt[0] > maxX) maxX = pt[0];
                                if (pt[1] < minY) minY = pt[1];
                                if (pt[1] > maxY) maxY = pt[1];
                            }
                        });
                    }
                } else if (el.type === 'line') {
                    let pX1 = Number(el.x1) || 0;
                    let pX2 = Number(el.x2) || 0;
                    let pY1 = Number(el.y1) || 0;
                    let pY2 = Number(el.y2) || 0;
                    minX = Math.min(minX, pX1, pX2);
                    maxX = Math.max(maxX, pX1, pX2);
                    minY = Math.min(minY, pY1, pY2);
                    maxY = Math.max(maxY, pY1, pY2);
                } else if (el.x !== undefined && el.y !== undefined) {
                    const x = Number(el.x) || 0;
                    const y = Number(el.y) || 0;
                    const w = Number(el.w) || 100;
                    const h = Number(el.h) || 100;
                    let elMinX = Math.min(x, x + w);
                    let elMaxX = Math.max(x, x + w);
                    let elMinY = Math.min(y, y + h);
                    let elMaxY = Math.max(y, y + h);
                    if (el.type === 'circle') {
                        const r = Math.sqrt((w*w) + (h*h));
                        elMinX = x - r; elMaxX = x + r;
                        elMinY = y - r; elMaxY = y + r;
                    }
                    if (elMinX < minX) minX = elMinX;
                    if (elMaxX > maxX) maxX = elMaxX;
                    if (elMinY < minY) minY = elMinY;
                    if (elMaxY > maxY) maxY = elMaxY;
                }
            });
            if (minX !== Infinity && maxX !== -Infinity && !isNaN(minX) && !isNaN(maxX)) {
                const padding = 20;
                const contentW = (maxX - minX) + (padding * 2);
                const contentH = (maxY - minY) + (padding * 2);
                const scaleX = cWidth / contentW;
                const scaleY = cHeight / contentH;
                scale = Math.min(scaleX, scaleY, 2.0);
                const scaledContentW = contentW * scale;
                const scaledContentH = contentH * scale;
                translateX = (cWidth - scaledContentW) / 2 - (minX - padding) * scale;
                translateY = (cHeight - scaledContentH) / 2 - (minY - padding) * scale;
            }
        }
        ctx.translate(translateX, translateY);
        ctx.scale(scale, scale);
    }

    try {
        // Calculate the active scale for line width adjustment
        let activeScale = 1.0;
        if (remoteViewport.current) {
            const { width, height, zoom } = remoteViewport.current;
            const screenW = width || 1920;
            const screenH = height || 1080;
            activeScale = Math.min(cWidth / screenW, cHeight / screenH) * (zoom || 1);
        } else {
            activeScale = 0.3; // Fallback
        }

        elements.forEach(el => drawElement(ctx, el, activeScale));
        
        // Draw in-progress strokes
        Object.values(remotePaths.current).forEach(path => {
          if (path) drawElement(ctx, path, activeScale);
        });
        
    } catch (e) {
        console.error('MiniBoard Inner Draw Error:', e);
        setRenderError(e.message || 'Inner Draw Error');
    }
    
    ctx.restore();
    } catch (err) {
        console.error('MiniBoard Fatal Render Error:', err);
        setRenderError(err.message || 'Fatal Render Error');
    }
  }, [elements, drawElement]);

  const redrawPending = useRef(false);

  const triggerRedraw = useCallback(() => {
    if (!redrawPending.current) {
      redrawPending.current = true;
      requestAnimationFrame(() => {
        try {
          redrawCanvas();
        } catch (e) {
          console.error("MiniBoard render error:", e);
        } finally {
          redrawPending.current = false;
        }
      });
    }
  }, [redrawCanvas]);

  useEffect(() => {
    triggerRedraw();
  }, [triggerRedraw, redrawTrigger, elements]);

  // Handle resizing of the thumbnail canvas
  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (!canvasRef.current || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      
      // Set actual pixel dimensions to match display size for crisp rendering
      canvasRef.current.width = width;
      canvasRef.current.height = height;
      
      // Force redraw when size changes
      setRedrawTrigger(prev => prev + 1);
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div 
      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex flex-col h-64 relative group"
      onClick={() => navigate(`/board/${student.id}`, { state: { returnToGroup: student.group_name || 'General' } })}
    >
      {/* Header */}
      <div className="bg-gray-50 px-3 py-2 border-b border-gray-100 flex justify-between items-center z-10">
        <span className="font-semibold text-gray-700 truncate">{student.username}</span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} title={isConnected ? 'Connected' : 'Offline'}></span>
        </div>
      </div>
      
      {/* Canvas Container */}
      <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden bg-gray-100">
        {renderError && (
          <div className="absolute inset-0 z-50 bg-red-100 text-red-600 p-2 text-xs overflow-auto font-mono">
            <b>CRASH:</b> {renderError}
          </div>
        )}
        <canvas 
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
        
        {/* Overlay hover effect */}
        <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 bg-white/90 text-blue-600 px-4 py-2 rounded-lg font-medium shadow-sm transition-all transform scale-95 group-hover:scale-100">
                View Board
            </span>
        </div>
      </div>
    </div>
  );
};

export default MiniBoard;
