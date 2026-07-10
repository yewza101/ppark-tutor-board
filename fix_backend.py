with open('backend/server.js', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("from('board-assets')", "from('board-assests')")

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(code)
print("Done")
