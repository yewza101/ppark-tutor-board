const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/Board.jsx', 'utf-8');

// FIX 1: Move selection logic from onPointerDown to onPointerMove
const selectLogicPattern = /if \\(currentTool === 'select' && dragContext\\.current\\) \\{[\\s\\S]*?requestAnimationFrame\\(redraw\\);[\\s\\S]*?lastEmitTime\\.current = now;\\s*\\}\\s*\\}\\s*return;\\s*\\}/;
const match = code.match(selectLogicPattern);
if (match) {
  // Remove it from current location
  code = code.replace(selectLogicPattern, '');
  
  // Insert it into onPointerMove right before "if (!isDrawing.current) return;"
  code = code.replace('if (!isDrawing.current) return;', match[0] + '\\n\\n    if (!isDrawing.current) return;');
}

// FIX 2: Add drawElement image and selection box logic
const circleDrawPattern = /\\} else if \\(el\\.type === 'circle'\\) \\{[\\s\\S]*?ctx\\.stroke\\(\\);\\s*\\}/;
const circleMatch = code.match(circleDrawPattern);
if (circleMatch && !code.includes("el.type === 'image' && imageCacheRef.current")) {
  const replacement = \} else if (el.type === 'circle') {
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

      // Draw selection box for the selected element
      if (selectedElementId === el.id) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([5 / zoom, 5 / zoom]);
        
        let minX, minY, maxX, maxY;
        if (el.type === 'path' && el.points && el.points.length > 0) {
           minX = Math.min(...el.points.map(p => p.x));
           minY = Math.min(...el.points.map(p => p.y));
           maxX = Math.max(...el.points.map(p => p.x));
           maxY = Math.max(...el.points.map(p => p.y));
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
        
        if (minX !== undefined) {
          const pad = 5 / zoom;
          ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad*2, maxY - minY + pad*2);
          ctx.setLineDash([]);
          
          if (el.type === 'image') {
            ctx.fillStyle = '#ffffff';
            const hs = 8 / zoom;
            ctx.fillRect(maxX - hs/2, maxY - hs/2, hs, hs);
            ctx.strokeRect(maxX - hs/2, maxY - hs/2, hs, hs);
          }
        }
      }\;
  code = code.replace(circleDrawPattern, replacement);
}

fs.writeFileSync('frontend/src/pages/Board.jsx', code);
