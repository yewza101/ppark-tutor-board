import os
os.system('git checkout frontend/src/pages/Board.jsx > NUL 2>&1')
with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f: code = f.read()

# Apply r1..r8
code = code.replace(
    "} else if (el.type === 'circle') {",
    "} else if (el.type === 'image') {\n      return pt.x >= el.x && pt.x <= el.x + el.w && pt.y >= el.y && pt.y <= el.y + el.h;\n    } else if (el.type === 'circle') {",
    1
)
helpers = \"\"\"
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
\"\"\"
code = code.replace("const generateId = () =>", helpers + "\nconst generateId = () =>", 1)
code = code.replace("const [selectedElementId, setSelectedElementId] = useState(null);", "const [selectedElementIds, setSelectedElementIds] = useState([]);", 1)
start_sel = code.find("      // Draw Selection Box\n      if (selectedElementId === el.id) {")
end_sel = code.find("    };\n\n    elementsRef.current.forEach(drawElement);")
if start_sel != -1 and end_sel != -1:
    code = code[:start_sel] + code[end_sel:]
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
code = code.replace("      if (el.type === 'path') {", lasso_draw + "      if (el.type === 'path') {", 1)
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
code = code.replace("  }, [zoom, pan, selectedElementId]);", group_box_draw, 1)
start_pd = code.find("    if (currentTool === 'select') {")
end_pd = code.find("    if (currentTool === 'eraser-object') {")
if start_pd != -1 and end_pd != -1:
    code = code[:start_pd] + "    /* new pd */\n" + code[end_pd:]
start_pm = code.find("    if (currentTool === 'select' && dragContext.current) {")
end_pm = code.find("    if (!isDrawing.current) return;")
if start_pm != -1 and end_pm != -1:
    code = code[:start_pm] + "    /* new pm */\n" + code[end_pm:]

start_pu = code.find("    if (dragContext.current) {")
end_pu = code.find("    if (isDrawing.current && currentPath.current) {")
print('start_pu:', start_pu, 'end_pu:', end_pu)
if start_pu != -1 and end_pu != -1:
    deleted = code[start_pu:end_pu]
    print('DELETED BLOCK:')
    print(deleted)
    print('DELETED DIFF:', deleted.count('{') - deleted.count('}'))
