import { 
  Pencil, Eraser, Circle, Square, Minus, 
  ZoomIn, ZoomOut, Maximize, Undo, Redo, Trash2, Hand, Wand2, Scissors, MousePointer2, Image as ImageIcon,
  Highlighter, Type, Download, Sigma, StickyNote
} from 'lucide-react';
import { useRef, useState } from 'react';

const Toolbar = ({ 
  currentTool, setCurrentTool, 
  brushColor, setBrushColor, 
  brushSize, setBrushSize,
  handleZoomIn, handleZoomOut, handleResetZoom,
  handleClear, handleUndo, handleRedo,
  canUndo, canRedo, handleUpload,
  bgTemplate, setBgTemplate, handleExport
}) => {
  const fileInputRef = useRef(null);
  const [presetSizes, setPresetSizes] = useState([2, 5, 12]);
  const [activeSizeIndex, setActiveSizeIndex] = useState(1);
  const [showSizeSlider, setShowSizeSlider] = useState(false);
  
  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'pan', icon: Hand, label: 'Pan (Move)' },
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'math', icon: Sigma, label: 'Math Equation' },
    { id: 'postit', icon: StickyNote, label: 'Post-it Note' },
    { id: 'eraser', icon: Eraser, label: 'Eraser (Normal)' },
    { id: 'eraser-object', icon: Scissors, label: 'Object Eraser' },
    { id: 'laser', icon: Wand2, label: 'Laser Pointer' },
    { id: 'line', icon: Minus, label: 'Line' },
    { id: 'circle', icon: Circle, label: 'Circle' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
  ];

  const presetColors = [
    '#fef08a', '#fbcfe8', '#bfdbfe', '#bbf7d0', // Added pastel colors for post-its
    '#000000', '#ef4444', '#3b82f6', '#ec4899'
  ];

  const needsColor = ['pencil', 'highlighter', 'text', 'math', 'line', 'circle', 'rectangle', 'laser', 'postit'].includes(currentTool);
  const needsSize = ['pencil', 'highlighter', 'eraser', 'laser', 'line', 'circle', 'rectangle'].includes(currentTool);

  return (
    <>
      {/* 1. Main Tools (Top Center) */}
      <div 
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 max-w-[95vw] flex flex-col items-center pointer-events-none"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <div className="bg-white/90 backdrop-blur shadow-lg rounded-2xl p-2 flex flex-nowrap items-center gap-1 border border-gray-100 overflow-x-auto no-scrollbar w-full pointer-events-auto">
          {tools.map(tool => (
            <button
              key={tool.id}
              onClick={() => setCurrentTool(tool.id)}
              className={`p-2 rounded-xl transition-colors shrink-0 ${
                currentTool === tool.id 
                  ? 'bg-blue-100 text-blue-600' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={tool.label}
            >
              <tool.icon size={20} />
            </button>
          ))}
        </div>
      </div>

      {/* 2. Properties: Colors & Sizes (Floating below Main Tools) */}
      {(needsColor || needsSize) && (
        <div 
          className="absolute top-20 left-1/2 -translate-x-1/2 z-10 max-w-[95vw] flex flex-col items-center pointer-events-none"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <div className="bg-white/90 backdrop-blur shadow-lg rounded-2xl p-2 flex flex-nowrap items-center gap-2 border border-gray-100 overflow-x-auto no-scrollbar pointer-events-auto">
            {needsColor && (
              <>
                <div className="flex gap-1.5 justify-center items-center">
                  {presetColors.map(color => (
                    <button
                      key={color}
                      onClick={() => setBrushColor(color)}
                      className={`w-5 h-5 rounded-full border-2 transition-transform shrink-0 ${
                        brushColor === color ? 'scale-125 border-gray-400' : 'border-transparent hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                
                <div className="flex flex-col items-center gap-1 mx-1 shrink-0">
                  <input 
                    type="color" 
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 p-0"
                    title="Custom Color"
                  />
                </div>
              </>
            )}

            {needsColor && needsSize && <div className="w-px h-6 bg-gray-200 mx-1 shrink-0"></div>}

            {needsSize && (
              <div className="relative flex flex-nowrap items-center gap-1 shrink-0">
                {[0, 1, 2].map((idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (activeSizeIndex === idx) {
                        setShowSizeSlider(!showSizeSlider);
                      } else {
                        setActiveSizeIndex(idx);
                        setBrushSize(presetSizes[idx]);
                        setShowSizeSlider(false);
                      }
                    }}
                    className={`w-8 h-8 flex justify-center items-center rounded-xl transition-colors shrink-0 ${activeSizeIndex === idx ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                    title={activeSizeIndex === idx ? 'Adjust thickness' : 'Select thickness'}
                  >
                    <div 
                      className="rounded-full transition-all" 
                      style={{ 
                        backgroundColor: activeSizeIndex === idx ? '#2563eb' : '#4b5563',
                        width: Math.max(2, Math.min(20, presetSizes[idx] * 0.8)), 
                        height: Math.max(2, Math.min(20, presetSizes[idx] * 0.8)) 
                      }} 
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Size Slider Popup */}
          {showSizeSlider && needsSize && (
            <div className="mt-2 bg-white shadow-xl border border-gray-200 rounded-xl p-3 z-50 flex flex-col items-center gap-2 pointer-events-auto">
              <span className="text-xs text-gray-500 whitespace-nowrap font-medium">Thickness: {presetSizes[activeSizeIndex]}px</span>
              <input 
                type="range" 
                min="1" 
                max="50" 
                value={presetSizes[activeSizeIndex]}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value);
                  const newPresets = [...presetSizes];
                  newPresets[activeSizeIndex] = newSize;
                  setPresetSizes(newPresets);
                  setBrushSize(newSize);
                }}
                className="w-32 accent-blue-600"
              />
            </div>
          )}
        </div>
      )}

      {/* 3. Left Actions: History & Zoom (Bottom Left) */}
      <div 
        className="absolute bottom-4 left-4 z-10 pointer-events-none"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <div className="bg-white/90 backdrop-blur shadow-lg rounded-2xl p-2 flex flex-col gap-1 border border-gray-100 pointer-events-auto">
          <button onClick={handleZoomIn} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl" title="Zoom In">
            <ZoomIn size={20} />
          </button>
          <button onClick={handleResetZoom} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl" title="Reset Zoom/Pan">
            <Maximize size={20} />
          </button>
          <button onClick={handleZoomOut} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl" title="Zoom Out">
            <ZoomOut size={20} />
          </button>
          
          <div className="h-px w-6 bg-gray-200 mx-auto my-1"></div>
          
          <button 
            onClick={handleUndo} 
            disabled={!canUndo}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl disabled:opacity-30 transition-colors"
            title="Undo"
          >
            <Undo size={20} />
          </button>
          <button 
            onClick={handleRedo} 
            disabled={!canRedo}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl disabled:opacity-30 transition-colors"
            title="Redo"
          >
            <Redo size={20} />
          </button>
        </div>
      </div>

      {/* 4. Right Actions: System Tools (Bottom Right) */}
      <div 
        className="absolute bottom-4 right-4 z-10 pointer-events-none"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <div className="bg-white/90 backdrop-blur shadow-lg rounded-2xl p-2 flex flex-col gap-1 border border-gray-100 pointer-events-auto">
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload Image / PDF"
            className="p-2 text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ImageIcon size={20} />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            accept="image/*,application/pdf"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleUpload(e.target.files[0]);
                e.target.value = ''; // Reset
              }
            }} 
            className="hidden" 
          />

          <select 
              value={bgTemplate} 
              onChange={(e) => setBgTemplate(e.target.value)}
              className="p-1 text-sm border-0 rounded-lg text-gray-700 bg-transparent hover:bg-gray-100 outline-none w-10 truncate appearance-none text-center cursor-pointer"
              title="Paper Background"
          >
              <option value="blank">📄</option>
              <option value="lined">📝</option>
              <option value="grid">▦</option>
              <option value="dot">⁖</option>
          </select>
          
          <div className="h-px w-6 bg-gray-200 mx-auto my-1"></div>
          
          <button onClick={handleExport} className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl" title="Export to PDF">
            <Download size={20} />
          </button>
          
          <button onClick={handleClear} className="p-2 text-red-600 hover:bg-red-50 rounded-xl" title="Clear Canvas">
            <Trash2 size={20} />
          </button>
        </div>
      </div>

    </>
  );
};

export default Toolbar;
