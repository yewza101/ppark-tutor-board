import os

os.system('git checkout frontend/src/pages/Board.jsx > NUL 2>&1')

with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
    "} else if (el.type === 'circle') {",
    "} else if (el.type === 'image') {\n      return pt.x >= el.x && pt.x <= el.x + el.w && pt.y >= el.y && pt.y <= el.y + el.h;\n    } else if (el.type === 'circle') {",
    1
)

helpers = """
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
     if (!el.points || el.points.length === 0) return {};
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
  return { minX, minY, maxX, maxY };
};

const isElementInLasso = (el, lassoPoints) => {
  if (el.type === 'path' && el.points) {
    return el.points.some(p => isPointInPolygon(p, lassoPoints));
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
"""
code = code.replace("const generateId = () =>", helpers + "\nconst generateId = () =>", 1)

code = code.replace("const [selectedElementId, setSelectedElementId] = useState(null);", "const [selectedElementIds, setSelectedElementIds] = useState([]);", 1)

start_sel = code.find("      // Draw Selection Box\n      if (selectedElementId === el.id) {")
end_sel = code.find("    };\n\n    elementsRef.current.forEach(drawElement);")
if start_sel != -1 and end_sel != -1:
    code = code[:start_sel] + code[end_sel:]

lasso_draw = """      if (el.type === 'lasso') {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([5 / zoom, 5 / zoom]);
        ctx.beginPath();
        if (el.points.length > 0) {
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            ctx.lineTo(el.points[i].x, el.points[i].y);
          }
          ctx.lineTo(el.points[0].x, el.points[0].y);
          ctx.stroke();
          ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
          ctx.fill();
        }
        ctx.setLineDash([]);
        return;
      }
"""
code = code.replace("      if (el.type === 'path') {", lasso_draw + "      if (el.type === 'path') {", 1)

group_box_draw = """
    if (selectedElementIds.length > 0) {
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
      selectedElementIds.forEach(id => {
        const el = elementsRef.current.find(e => e.id === id);
        if (el) {
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
        ctx.strokeRect(gMinX - pad, gMinY - pad, gMaxX - gMinX + pad*2, gMaxY - gMinY + pad*2);
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#ffffff';
        const hs = 12 / zoom;
        ctx.fillRect(gMaxX + pad - hs/2, gMaxY + pad - hs/2, hs, hs);
        ctx.strokeRect(gMaxX + pad - hs/2, gMaxY + pad - hs/2, hs, hs);
      }
    }
  }, [zoom, pan, selectedElementIds]);
"""
code = code.replace("  }, [zoom, pan, selectedElementId]);", group_box_draw, 1)

start_pd = code.find("const onPointerDown")
start_pd = code.find("    if (currentTool === 'select') {", start_pd)
end_pd = code.find("    if (currentTool === 'eraser-object') {", start_pd)
new_pd = """    if (currentTool === 'select') {
      const pos = getMousePos(e);
      if (selectedElementIds.length > 0) {
        let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
        selectedElementIds.forEach(id => {
          const el = elementsRef.current.find(e => e.id === id);
          if (el) {
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
            origElements: selectedElementIds.map(id => JSON.parse(JSON.stringify(elementsRef.current.find(e => e.id === id))))
          };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
          return;
        }
        
        if (pos.x >= gMinX - pad && pos.x <= gMaxX + pad && pos.y >= gMinY - pad && pos.y <= gMaxY + pad) {
          dragContext.current = { 
            type: 'move', startX: pos.x, startY: pos.y, 
            origElements: selectedElementIds.map(id => JSON.parse(JSON.stringify(elementsRef.current.find(e => e.id === id))))
          };
          isDrawing.current = true;
          e.target.setPointerCapture(e.pointerId);
          return;
        }
      }
      
      const hitIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, 15));
      if (hitIdx !== -1) {
        const el = elementsRef.current[hitIdx];
        setSelectedElementIds([el.id]);
        dragContext.current = { 
          type: 'move', startX: pos.x, startY: pos.y, 
          origElements: [JSON.parse(JSON.stringify(el))]
        };
        isDrawing.current = true;
        e.target.setPointerCapture(e.pointerId);
        return;
      }
      
      setSelectedElementIds([]);
      currentPath.current = { id: generateId(), type: 'lasso', tool: 'select', points: [pos] };
      isDrawing.current = true;
      e.target.setPointerCapture(e.pointerId);
      return;
    }

"""
if start_pd != -1 and end_pd != -1:
    code = code[:start_pd] + new_pd + code[end_pd:]

start_pm = code.find("const onPointerMove")
start_pm = code.find("    if (currentTool === 'select' && dragContext.current) {", start_pm)
end_pm = code.find("    if (!isDrawing.current) return;", start_pm)
new_pm = """    if (currentTool === 'select') {
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
               el.points = el.points.map((p, i) => ({ x: origEl.points[i].x + dx, y: origEl.points[i].y + dy }));
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
               el.points = el.points.map((p, i) => ({ 
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
        if (shouldEmit) lastEmitTime.current = now;
        setElements([...elementsRef.current]);
        requestAnimationFrame(redraw);
        return;
      }
    }

"""
if start_pm != -1 and end_pm != -1:
    code = code[:start_pm] + new_pm + code[end_pm:]

start_pu = code.find("const onPointerUp")
start_pu = code.find("    if (dragContext.current) {", start_pu)
end_pu = code.find("    if (isDrawing.current && currentPath.current) {", start_pu)
new_pu = """    if (currentTool === 'select' && currentPath.current && currentPath.current.type === 'lasso') {
      const lassoPoints = currentPath.current.points;
      if (lassoPoints.length > 2) {
        const selectedIds = [];
        elementsRef.current.forEach(el => {
          if (isElementInLasso(el, lassoPoints)) {
            selectedIds.push(el.id);
          }
        });
        setSelectedElementIds(selectedIds);
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

"""
if start_pu != -1 and end_pu != -1:
    code = code[:start_pu] + new_pu + code[end_pu:]

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)
print("Done")
