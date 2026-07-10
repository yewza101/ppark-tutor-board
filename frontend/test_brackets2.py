new_pd = \"\"\"    if (currentTool === 'select') {
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

\"\"\"

new_pm = \"\"\"    if (currentTool === 'select') {
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

\"\"\"

new_pu = \"\"\"    if (currentTool === 'select' && currentPath.current && currentPath.current.type === 'lasso') {
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

\"\"\"

lasso_draw = \"\"\"      if (el.type === 'lasso') {
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
\"\"\"

group_box_draw = \"\"\"
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
\"\"\"

def check(name, text):
    ob = text.count('{')
    cb = text.count('}')
    print(name, 'Diff:', ob - cb)

check('new_pd', new_pd)
check('new_pm', new_pm)
check('new_pu', new_pu)
check('lasso_draw', lasso_draw)
check('group_box_draw', group_box_draw)
