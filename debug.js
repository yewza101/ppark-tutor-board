const fs = require('fs');
const code = fs.readFileSync('frontend/src/pages/Board.jsx', 'utf8');

const s1 = code.indexOf('      // Draw Selection Box');
const s2 = code.indexOf('    };\n\n    elementsRef.current.forEach(drawElement);');
console.log('s1:', s1, 's2:', s2);
if (s1 !== -1 && s2 !== -1) {
    console.log(code.substring(s1, s1 + 100));
    console.log('...');
    console.log(code.substring(s2 - 100, s2));
}
