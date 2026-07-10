import re

with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove the old selection box completely
old_sel = re.compile(r"      // Draw Selection Box\n      if \(selectedElementId === el\.id\) \{[\s\S]*?      \}\n")
code = re.sub(old_sel, "", code)

# 2. Fix onPointerDown
old_pd = re.compile(r"    if \(currentTool === 'select'\) \{[\s\S]*?      return;\n    \}\n")
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
    }\n"""
code = re.sub(old_pd, new_pd, code)

# 3. Fix onPointerMove
old_pm = re.compile(r"    if \(currentTool === 'select' && dragContext\.current\) \{[\s\S]*?      return;\n    \}\n")
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
    }\n"""
code = re.sub(old_pm, new_pm, code)

# 4. Fix onPointerUp
old_pu = re.compile(r"    if \(dragContext\.current\) \{[\s\S]*?      isDrawing\.current = false;\n    \}\n")
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
    }\n"""
code = re.sub(old_pu, new_pu, code)

# Write it out
with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)
print("Done")
