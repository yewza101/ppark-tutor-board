const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/Board.jsx', 'utf-8');

if (!code.includes('pdfjs-dist')) {
  code = code.replace(
    "import { API_URL } from '../config';",
    "import { API_URL } from '../config';\nimport * as pdfjsLib from 'pdfjs-dist';\npdfjsLib.GlobalWorkerOptions.workerSrc = //cdnjs.cloudflare.com/ajax/libs/pdf.js/\/pdf.worker.min.js;"
  );
}

if (!code.includes("el.type === 'image'")) {
  code = code.replace(
    "return Math.abs(dist - elRadius) < hitRadius;\n  }",
    "return Math.abs(dist - elRadius) < hitRadius;\n  } else if (el.type === 'image') {\n    return pt.x >= el.x - hitRadius && pt.x <= el.x + el.w + hitRadius && pt.y >= el.y - hitRadius && pt.y <= el.y + el.h + hitRadius;\n  }"
  );
}

if (!code.includes('imageCacheRef')) {
  code = code.replace(
    "const [cursors, setCursors] = useState({});",
    "const [cursors, setCursors] = useState({});\n  const imageCacheRef = useRef({});\n  const [selectedElementId, setSelectedElementId] = useState(null);\n  const dragContext = useRef(null);"
  );
}

if (!code.includes("newSocket.on('update-element'")) {
  code = code.replace(
    "newSocket.on('delete-element', ({ elementId }) => {",
    "newSocket.on('update-element', (data) => {\n      elementsRef.current = elementsRef.current.map(el => el.id === data.element.id ? data.element : el);\n      setElements([...elementsRef.current]);\n      if (redrawRef.current) redrawRef.current();\n    });\n\n    newSocket.on('delete-element', ({ elementId }) => {"
  );
}

if (!code.includes("imageCacheRef.current[el.url]")) {
  code = code.replace(
    "else if (el.type === 'circle') {\n        const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));\n        ctx.arc(el.x, el.y, r, 0, 2 * Math.PI);\n        ctx.stroke();\n      }",
    "else if (el.type === 'circle') {\n        const r = Math.sqrt(Math.pow(el.w, 2) + Math.pow(el.h, 2));\n        ctx.arc(el.x, el.y, r, 0, 2 * Math.PI);\n        ctx.stroke();\n      } else if (el.type === 'image') {\n        if (!imageCacheRef.current[el.url]) {\n          const img = new Image();\n          img.crossOrigin = 'Anonymous';\n          img.src = el.url;\n          img.onload = () => {\n            imageCacheRef.current[el.url] = img;\n            redraw();\n          };\n          imageCacheRef.current[el.url] = 'loading';\n        } else if (imageCacheRef.current[el.url] !== 'loading') {\n          const img = imageCacheRef.current[el.url];\n          ctx.drawImage(img, el.x, el.y, el.w, el.h);\n          if (selectedElementId === el.id) {\n            ctx.strokeStyle = '#3b82f6';\n            ctx.lineWidth = 2 / zoom;\n            ctx.setLineDash([5 / zoom, 5 / zoom]);\n            ctx.strokeRect(el.x, el.y, el.w, el.h);\n            ctx.setLineDash([]);\n            ctx.fillStyle = '#ffffff';\n            const hs = 8 / zoom;\n            ctx.fillRect(el.x + el.w - hs/2, el.y + el.h - hs/2, hs, hs);\n            ctx.strokeRect(el.x + el.w - hs/2, el.y + el.h - hs/2, hs, hs);\n          }\n        }\n      }"
  );
}

if (!code.includes("[zoom, pan, selectedElementId]")) {
  code = code.replace(
    "}, [zoom, pan]);",
    "}, [zoom, pan, selectedElementId]);"
  );
}

if (!code.includes("currentTool === 'select'")) {
  code = code.replace(
    "if (currentTool === 'eraser-object') {",
    "if (currentTool === 'select') {\n      const pos = getMousePos(e);\n      const hitIdx = elementsRef.current.findLastIndex(el => isPointInElement(pos, el, brushSize));\n      if (hitIdx !== -1) {\n        const el = elementsRef.current[hitIdx];\n        setSelectedElementId(el.id);\n        let type = 'move';\n        if (el.type === 'image') {\n          const hs = 15 / zoom;\n          if (pos.x >= el.x + el.w - hs && pos.y >= el.y + el.h - hs) type = 'scale';\n        }\n        dragContext.current = { elementId: el.id, type, startX: pos.x, startY: pos.y, origX: el.x, origY: el.y, origW: el.w, origH: el.h, origX1: el.x1, origY1: el.y1 };\n        isDrawing.current = true;\n        e.target.setPointerCapture(e.pointerId);\n      } else {\n        setSelectedElementId(null);\n      }\n      return;\n    }\n\n    if (currentTool === 'eraser-object') {"
  );
}

if (!code.includes("if (currentTool === 'select' && dragContext.current) {")) {
  code = code.replace(
    "if (currentTool === 'eraser-object') {",
    "if (currentTool === 'select' && dragContext.current) {\n      const dx = pos.x - dragContext.current.startX;\n      const dy = pos.y - dragContext.current.startY;\n      const elIdx = elementsRef.current.findIndex(el => el.id === dragContext.current.elementId);\n      if (elIdx !== -1) {\n        const el = elementsRef.current[elIdx];\n        if (dragContext.current.type === 'move') {\n          if (el.type === 'path') {\n             el.points = el.points.map((p, i) => ({ x: dragContext.current.origPoints[i].x + dx, y: dragContext.current.origPoints[i].y + dy }));\n          } else {\n             el.x = dragContext.current.origX + dx;\n             el.y = dragContext.current.origY + dy;\n             if (el.type === 'line') {\n               el.x1 = dragContext.current.origX1 + dx;\n               el.y1 = dragContext.current.origY1 + dy;\n             }\n          }\n        } else if (dragContext.current.type === 'scale' && el.type === 'image') {\n          el.w = Math.max(20, dragContext.current.origW + dx);\n          el.h = Math.max(20, dragContext.current.origH + dy);\n        }\n        setElements([...elementsRef.current]);\n        requestAnimationFrame(redraw);\n        if (socket && socket.id && shouldEmit) {\n          socket.emit('update-element', { boardId: studentId, element: el });\n          lastEmitTime.current = now;\n        }\n      }\n      return;\n    }\n\n    if (currentTool === 'eraser-object') {"
  );
}

if (!code.includes("const handleUpload")) {
  code = code.replace(
    "const handleUndo = () => {",
    "const handleUpload = async (file) => {\n    try {\n      let uploadFile = file;\n      if (file.type === 'application/pdf') {\n        const arrayBuffer = await file.arrayBuffer();\n        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;\n        const page = await pdf.getPage(1);\n        const viewport = page.getViewport({ scale: 2.0 });\n        const canvas = document.createElement('canvas');\n        canvas.width = viewport.width;\n        canvas.height = viewport.height;\n        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;\n        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));\n        uploadFile = new File([blob], file.name.replace('.pdf', '.png'), { type: 'image/png' });\n      }\n\n      const formData = new FormData();\n      formData.append('file', uploadFile);\n      const res = await axios.post(\\/api/upload\, formData);\n      const publicUrl = res.data.url;\n\n      const newEl = {\n        id: generateId(),\n        type: 'image',\n        url: publicUrl,\n        x: -pan.x / zoom + 50,\n        y: -pan.y / zoom + 50,\n        w: 400,\n        h: uploadFile.type === 'image/png' && file.type === 'application/pdf' ? 565 : 400\n      };\n\n      const img = new Image();\n      img.onload = () => {\n        newEl.w = Math.min(img.width, 800);\n        newEl.h = (img.height / img.width) * newEl.w;\n        elementsRef.current = [...elementsRef.current, newEl];\n        setElements([...elementsRef.current]);\n        redraw();\n        if (socket && socket.id) {\n          socket.emit('draw-stroke', { boardId: studentId, stroke: newEl, socketId: socket.id });\n        }\n      };\n      img.src = publicUrl;\n    } catch (err) {\n      console.error('Upload failed', err);\n      alert('Upload failed: ' + err.message);\n    }\n  };\n\n  const handleUndo = () => {"
  );
}

if (!code.includes("handleUpload={handleUpload}")) {
  code = code.replace(
    "canUndo={pastStates.length > 0} canRedo={futureStates.length > 0}",
    "canUndo={pastStates.length > 0} canRedo={futureStates.length > 0}\n        handleUpload={handleUpload}"
  );
}

if (!code.includes("dragContext.current = null;")) {
  code = code.replace(
    "if (isDrawing.current && currentPath.current) {",
    "if (dragContext.current) {\n      if (socket && socket.id) {\n        const el = elementsRef.current.find(el => el.id === dragContext.current.elementId);\n        if (el) socket.emit('update-element', { boardId: studentId, element: el });\n      }\n      dragContext.current = null;\n      isDrawing.current = false;\n    }\n\n    if (isDrawing.current && currentPath.current) {"
  );
}

// Ensure origPoints is saved when selecting a path
if (!code.includes("origPoints: el.points ? [...el.points] : null")) {
  code = code.replace(
    "origX1: el.x1, origY1: el.y1 };",
    "origX1: el.x1, origY1: el.y1, origPoints: el.points ? el.points.map(p => ({...p})) : null };"
  );
}

fs.writeFileSync('frontend/src/pages/Board.jsx', code);
