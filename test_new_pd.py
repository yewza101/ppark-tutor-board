import os
import subprocess

os.system('git checkout frontend/src/pages/Board.jsx > NUL 2>&1')
with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

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

start_pd = code.find("    if (currentTool === 'select') {")
end_pd = code.find("    if (currentTool === 'eraser-object') {")
code = code[:start_pd] + new_pd + code[end_pd:]

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

result = subprocess.run('npm run build', cwd='frontend', capture_output=True, text=True, shell=True)
if result.returncode != 0:
    print('FAILED')
    print(result.stderr)
    print(result.stdout)
else:
    print('OK')
