import os

with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. isPointInElement should return false for eraser
code = code.replace(
    "const isPointInElement = (pt, el, radius) => {\n    const hitRadius = radius + (el.size ? el.size / 2 : 5);",
    "const isPointInElement = (pt, el, radius) => {\n    if (el.tool === 'eraser') return false;\n    const hitRadius = radius + (el.size ? el.size / 2 : 5);"
)

# 2. In group box draw, ignore eraser for bounding box
code = code.replace(
    """      selectedElementIds.forEach(id => {
        const el = elementsRef.current.find(e => e.id === id);
        if (el) {""",
    """      selectedElementIds.forEach(id => {
        const el = elementsRef.current.find(e => e.id === id);
        if (el && el.tool !== 'eraser') {"""
)

# 3. In onPointerDown group hit test, ignore eraser for bounding box calculation
code = code.replace(
    """        selectedElementIds.forEach(id => {
          const el = elementsRef.current.find(e => e.id === id);
          if (el) {""",
    """        selectedElementIds.forEach(id => {
          const el = elementsRef.current.find(e => e.id === id);
          if (el && el.tool !== 'eraser') {"""
)

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Done")
