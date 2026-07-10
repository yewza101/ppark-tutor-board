import re

with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove the dragging block from onPointerDown
pattern = re.compile(r"    if \(currentTool === 'select' && dragContext\.current\) \{\n(?:.*?\n){25}    \}\n", re.DOTALL)
match = pattern.search(code)
if match:
    block = match.group(0)
    code = code.replace(block, "")
    
    # Insert it into onPointerMove right before "if (!isDrawing.current) return;"
    target_pos_str = "    if (!isDrawing.current) return;"
    code = code.replace(target_pos_str, block + "\n" + target_pos_str)

# 2. Add selection box drawing for all selected elements, and image rendering fix
draw_pattern = re.compile(r"    const drawElement = \(el\) => \{\n(?:.*?\n){31}      \};\n", re.DOTALL)
draw_match = draw_pattern.search(code)
if draw_match:
    old_draw = draw_match.group(0)
    new_draw = old_draw.replace(
        "      } else if (el.type === 'circle') {\n        const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));\n        ctx.arc(el.x, el.y, r, 0, 2 * Math.PI);\n        ctx.stroke();\n      }",
        """      } else if (el.type === 'circle') {
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

      // Draw Selection Box
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
      }"""
    )
    code = code.replace(old_draw, new_draw)

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)
print("Done")
