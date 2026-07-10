import re

with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Fix Eraser
code = code.replace(
    "ctx.strokeStyle = el.tool === 'eraser' ? '#ffffff' : el.color;",
    "ctx.strokeStyle = el.tool === 'eraser' ? 'rgba(0,0,0,1)' : el.color;\n        ctx.globalCompositeOperation = el.tool === 'eraser' ? 'destination-out' : 'source-over';"
)

# Fix Select Tool hit radius
code = code.replace(
    "const hitIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, brushSize));",
    "const hitIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, 15));"
)

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)
print("Done")
