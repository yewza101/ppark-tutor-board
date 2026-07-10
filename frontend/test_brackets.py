import os
os.system('git checkout src/pages/Board.jsx > NUL 2>&1')
with open('src/pages/Board.jsx', 'r', encoding='utf-8') as f: code = f.read()

def check(name, new_code):
    ob = new_code.count('{')
    cb = new_code.count('}')
    diff = ob - cb
    print(name, 'Diff:', diff)

print('Original Diff:', code.count('{') - code.count('}'))

c1 = code.replace("} else if (el.type === 'circle') {", "} else if (el.type === 'image') {\n      return pt.x >= el.x && pt.x <= el.x + el.w && pt.y >= el.y && pt.y <= el.y + el.h;\n    } else if (el.type === 'circle') {", 1)
check('r1', c1)

start_sel = code.find("      // Draw Selection Box\n      if (selectedElementId === el.id) {")
end_sel = code.find("    };\n\n    elementsRef.current.forEach(drawElement);")
c4 = code[:start_sel] + code[end_sel:]
check('r4', c4)

lasso_draw = "      if (el.type === 'lasso') { return; }\n"
c5 = code.replace("      if (el.type === 'path') {", lasso_draw + "      if (el.type === 'path') {", 1)
check('r5', c5)

c6 = code.replace("  }, [zoom, pan, selectedElementId]);", "  }, [zoom, pan, selectedElementId]); /* group box */", 1)
check('r6', c6)

start_pd = code.find("    if (currentTool === 'select') {")
end_pd = code.find("    if (currentTool === 'eraser-object') {")
c7 = code[:start_pd] + "    /* new pd */\n" + code[end_pd:]
check('r7', c7)

start_pm = code.find("    if (currentTool === 'select' && dragContext.current) {")
end_pm = code.find("    if (!isDrawing.current) return;")
c8 = code[:start_pm] + "    /* new pm */\n" + code[end_pm:]
check('r8', c8)

start_pu = code.find("    if (dragContext.current) {")
end_pu = code.find("    if (isDrawing.current && currentPath.current) {")
c9 = code[:start_pu] + "    /* new pu */\n" + code[end_pu:]
check('r9', c9)
