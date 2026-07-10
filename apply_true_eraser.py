import os

with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. getElementBoundingBox
box_old = """       minX = Math.min(...el.points.map(p => p.x));
       minY = Math.min(...el.points.map(p => p.y));
       maxX = Math.max(...el.points.map(p => p.x));
       maxY = Math.max(...el.points.map(p => p.y));"""
box_new = """       const validPoints = el.points.filter(p => p !== null);
       if (validPoints.length === 0) return {};
       minX = Math.min(...validPoints.map(p => p.x));
       minY = Math.min(...validPoints.map(p => p.y));
       maxX = Math.max(...validPoints.map(p => p.x));
       maxY = Math.max(...validPoints.map(p => p.y));"""
code = code.replace(box_old, box_new)

# 2. isElementInLasso
lasso_old = """    if (el.type === 'path' && el.points) {
      return el.points.some(p => isPointInPolygon(p, lassoPoints));"""
lasso_new = """    if (el.type === 'path' && el.points) {
      return el.points.some(p => p !== null && isPointInPolygon(p, lassoPoints));"""
code = code.replace(lasso_old, lasso_new)

# 3. drawElement path
draw_old = """        if (el.type === 'path') {
          if (el.points.length > 0) {
            ctx.moveTo(el.points[0].x, el.points[0].y);
            for (let i = 1; i < el.points.length; i++) {
              ctx.lineTo(el.points[i].x, el.points[i].y);
            }
            ctx.stroke();
          }"""
draw_new = """        if (el.type === 'path') {
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
          }"""
code = code.replace(draw_old, draw_new)

# 4. isPointInElement path
point_old = """    if (el.type === 'path') {
      if (!el.points || el.points.length === 0) return false;
      if (el.points.length === 1) {
        return Math.hypot(pt.x - el.points[0].x, pt.y - el.points[0].y) < hitRadius;
      }
      for (let i = 0; i < el.points.length - 1; i++) {
        if (distancePointToSegment(pt, el.points[i], el.points[i+1]) < hitRadius) return true;
      }
      return false;"""
point_new = """    if (el.type === 'path') {
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
      return false;"""
code = code.replace(point_old, point_new)

# 5. onPointerMove map move
map_move_old = """                 el.points = el.points.map((p, i) => ({ x: origEl.points[i].x + dx, y: origEl.points[i].y + dy }));"""
map_move_new = """                 el.points = el.points.map((p, i) => (origEl.points[i] === null ? null : { x: origEl.points[i].x + dx, y: origEl.points[i].y + dy }));"""
code = code.replace(map_move_old, map_move_new)

# 6. onPointerMove map scale
map_scale_old = """                 el.points = el.points.map((p, i) => ({ 
                   x: dragContext.current.gMinX + (origEl.points[i].x - dragContext.current.gMinX) * scale, 
                   y: dragContext.current.gMinY + (origEl.points[i].y - dragContext.current.gMinY) * scale 
                 }));"""
map_scale_new = """                 el.points = el.points.map((p, i) => (origEl.points[i] === null ? null : { 
                   x: dragContext.current.gMinX + (origEl.points[i].x - dragContext.current.gMinX) * scale, 
                   y: dragContext.current.gMinY + (origEl.points[i].y - dragContext.current.gMinY) * scale 
                 }));"""
code = code.replace(map_scale_old, map_scale_new)

# 7. Add erasePixel method next to checkObjectEraserCollision
erase_pixel = """
    const erasePixel = (pos) => {
      let changed = false;
      elementsRef.current.forEach(el => {
        if (el.type === 'path') {
          let elChanged = false;
          for (let i = 0; i < el.points.length; i++) {
            if (el.points[i] !== null) {
              if (Math.hypot(el.points[i].x - pos.x, el.points[i].y - pos.y) < brushSize) {
                el.points[i] = null;
                elChanged = true;
              } else if (i > 0 && el.points[i-1] !== null) {
                if (distancePointToSegment(pos, el.points[i-1], el.points[i]) < brushSize) {
                  el.points[i-1] = null;
                  el.points[i] = null;
                  elChanged = true;
                }
              }
            }
          }
          if (elChanged) {
             changed = true;
             if (socket && socket.id) socket.emit('update-element', { boardId: studentId, element: el });
          }
        }
      });
      if (changed) {
        setElements([...elementsRef.current]);
        if (redrawRef.current) redrawRef.current();
      }
    };
"""
code = code.replace("    const checkObjectEraserCollision = (pos) => {", erase_pixel + "\n    const checkObjectEraserCollision = (pos) => {")

# 8. onPointerDown handling
down_old = """    if (currentTool === 'eraser-object' || currentTool === 'eraser') {
      const pos = getMousePos(e);
      checkObjectEraserCollision(pos);
      isDrawing.current = true;
      e.target.setPointerCapture(e.pointerId);
      return;
    }"""
down_new = """    if (currentTool === 'eraser-object') {
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
    }"""
code = code.replace(down_old, down_new)

# 9. onPointerMove handling
move_old = """    if (currentTool === 'eraser-object' || currentTool === 'eraser') {
      checkObjectEraserCollision(pos);
      return;
    }"""
move_new = """    if (currentTool === 'eraser-object') {
      checkObjectEraserCollision(pos);
      return;
    }
    if (currentTool === 'eraser') {
      erasePixel(pos);
      return;
    }"""
code = code.replace(move_old, move_new)

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Done")
