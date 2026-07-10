import os
with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
    "const isPointInElement = (pt, el, radius) => {\n  const hitRadius = radius + (el.size ? el.size / 2 : 5);",
    "const isPointInElement = (pt, el, radius) => {\n  if (el.tool === 'eraser') return false;\n  const hitRadius = radius + (el.size ? el.size / 2 : 5);"
)

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Done")
