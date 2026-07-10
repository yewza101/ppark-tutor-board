import os

os.system('git checkout frontend/src/pages/Board.jsx > NUL 2>&1')
with open('frontend/src/pages/Board.jsx', 'r', encoding='utf-8') as f: code = f.read()

start_pu = code.find("    if (dragContext.current) {")
end_pu = code.find("    if (isDrawing.current && currentPath.current) {")
print('start_pu:', start_pu, 'end_pu:', end_pu)
if start_pu != -1 and end_pu != -1:
    deleted = code[start_pu:end_pu]
    print('DELETED BLOCK:')
    print(deleted)
    print('DELETED DIFF:', deleted.count('{') - deleted.count('}'))

