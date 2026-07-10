with open('apply_final.py', 'r', encoding='utf-8') as f: script = f.read()

import re
m = re.search(r'new_pu = \"\"\"(.*?)\"\"\"', script, re.DOTALL)
if m:
    pu = m.group(1)
    print('new_pu Diff:', pu.count('{') - pu.count('}'))
    print(pu)
else:
    print('Not found')
