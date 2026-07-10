import os
import subprocess

os.system('git checkout frontend/src/pages/Board.jsx > NUL 2>&1')
with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

start_pd = code.find("    if (currentTool === 'select') {")
end_pd = code.find("    if (currentTool === 'eraser-object') {")
code = code[:start_pd] + "    /* new pd */\n" + code[end_pd:]

with open('frontend/src/pages/Board.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

result = subprocess.run('npm run build', cwd='frontend', capture_output=True, text=True, shell=True)
print('RC:', result.returncode)
