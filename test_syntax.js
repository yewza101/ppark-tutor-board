const fs = require('fs');
const code = fs.readFileSync('src/pages/Board.jsx', 'utf8');

const babel = require('@babel/core');
try {
  babel.parseSync(code, {
    presets: ['@babel/preset-react'],
    filename: 'Board.jsx'
  });
  console.log('VALID');
} catch (e) {
  console.log('INVALID:', e.message);
}
