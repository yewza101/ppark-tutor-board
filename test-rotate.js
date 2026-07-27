const origElements = [
  { id: '1', type: 'rectangle', x: 100, y: 100, w: 50, h: 50, rotation: 0 }
];
const cx = 125, cy = 125;
const angleDelta = Math.PI / 4;

const rotatePoint = (px, py, cx, cy, angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nx = (cos * (px - cx)) - (sin * (py - cy)) + cx;
    const ny = (sin * (px - cx)) + (cos * (py - cy)) + cy;
    return { x: nx, y: ny };
};

const el = { ...origElements[0] };
const origEl = origElements[0];
const origCX = origEl.x + (origEl.w || 0)/2;
const origCY = origEl.y + (origEl.h || 0)/2;
const newCenter = rotatePoint(origCX, origCY, cx, cy, angleDelta);
el.x = newCenter.x - (origEl.w || 0)/2;
el.y = newCenter.y - (origEl.h || 0)/2;
el.rotation = (origEl.rotation || 0) + angleDelta;

console.log(el);
