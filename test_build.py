import os
import subprocess

def test_replace(desc, func):
    os.system('git checkout frontend/src/pages/Board.jsx > NUL 2>&1')
    with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
        code = f.read()
    
    code = func(code)
    
    with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
        f.write(code)
    
    result = subprocess.run('npm run build', cwd='frontend', capture_output=True, text=True, shell=True)
    if result.returncode != 0:
        print(desc + " FAILED!")
    else:
        print(desc + " OK")

def r1(code):
    return code.replace("} else if (el.type === 'circle') {", "} else if (el.type === 'image') {\\n      return pt.x >= el.x && pt.x <= el.x + el.w && pt.y >= el.y && pt.y <= el.y + el.h;\\n    } else if (el.type === 'circle') {", 1)

def r4(code):
    start_sel = code.find("      // Draw Selection Box\\n      if (selectedElementId === el.id) {")
    end_sel = code.find("    };\\n\\n    elementsRef.current.forEach(drawElement);")
    return code[:start_sel] + code[end_sel:]

def r7(code):
    start_pd = code.find("    if (currentTool === 'select') {")
    end_pd = code.find("    if (currentTool === 'eraser-object') {")
    return code[:start_pd] + "    /* new pd */\\n" + code[end_pd:]

def r8(code):
    start_pm = code.find("    if (currentTool === 'select' && dragContext.current) {")
    end_pm = code.find("    if (!isDrawing.current) return;")
    return code[:start_pm] + "    /* new pm */\\n" + code[end_pm:]

def r9(code):
    start_pu = code.find("    if (dragContext.current) {")
    end_pu = code.find("    if (isDrawing.current && currentPath.current) {")
    return code[:start_pu] + "    /* new pu */\\n" + code[end_pu:]

print('Running tests...')
test_replace('r1', r1)
test_replace('r4', r4)
test_replace('r7', r7)
test_replace('r8', r8)
test_replace('r9', r9)
