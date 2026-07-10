import { 
  Pencil, Eraser, Circle, Square, Minus, 
  ZoomIn, ZoomOut, Maximize, Undo, Redo, Trash2, Hand, Wand2, Scissors, MousePointer2, Image as ImageIcon,
  Highlighter, Type, Download, Sigma
} from 'lucide-react';
import { useRef } from 'react';

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
  
  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'pan', icon: Hand, label: 'Pan (Move)' },
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'math', icon: Sigma, label: 'Math Equation' },
    { id: 'eraser', icon: Eraser, label: 'Eraser (Normal)' },
    { id: 'eraser-object', icon: Scissors, label: 'Object Eraser' },
    { id: 'laser', icon: Wand2, label: 'Laser Pointer' },
    { id: 'line', icon: Minus, label: 'Line' },
    { id: 'circle', icon: Circle, label: 'Circle' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
  ];

  const presetColors = [
    '#000000', '#ef4444', '#f97316', '#eab308', 
    '#22c55e', '#3b82f6', '#a855f7', '#ec4899'
  ];

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur shadow-lg rounded-2xl p-2 flex items-center gap-2 z-10 border border-gray-100 max-w-[95vw] overflow-x-auto overflow-y-hidden no-scrollbar">
      
      {/* Tools */}
      <div className="flex gap-1 border-r border-gray-200 pr-2 shrink-0">
        {tools.map(tool => (
          <button
            key={tool.id}
            onClick={() => setCurrentTool(tool.id)}
            className={`p-2 rounded-xl transition-colors ${
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

      {/* Color Palette & Size */}
      <div className="flex items-center gap-2 border-r border-gray-200 pr-2 pl-1 shrink-0">
        <div className="flex flex-wrap w-32 gap-1 justify-center">
          {presetColors.map(color => (
            <button
              key={color}
              onClick={() => setBrushColor(color)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                brushColor === color ? 'scale-125 border-gray-400' : 'border-transparent hover:scale-110'
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
        
        <div className="flex flex-col items-center gap-1 mx-1">
          <input 
            type="color" 
            value={brushColor}
            onChange={(e) => setBrushColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border-0 p-0"
            title="Custom Color"
          />
        </div>

        <input 
          type="range" 
          min="1" 
          max="50" 
          value={brushSize}
          onChange={(e) => setBrushSize(parseInt(e.target.value))}
          className="w-20 accent-blue-600"
          title="Brush Size"
        />
      </div>

      {/* History */}
      <div className="flex gap-1 border-r border-gray-200 pr-2 pl-1 shrink-0">
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

      {/* Zoom & Clear */}
      <div className="flex gap-1 pl-1 shrink-0">
        <button onClick={handleZoomIn} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl" title="Zoom In">
          <ZoomIn size={20} />
        </button>
        <button onClick={handleZoomOut} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl" title="Zoom Out">
          <ZoomOut size={20} />
        </button>
        <button onClick={handleResetZoom} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl" title="Reset Zoom/Pan">
          <Maximize size={20} />
        </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload Image / PDF"
            className="p-2 text-gray-700 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
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
            accept="image/*,application/pdf"
            className="hidden" 
          />

          <div className="w-px h-6 bg-gray-300 mx-1"></div>
          
        <select 
            value={bgTemplate} 
            onChange={(e) => setBgTemplate(e.target.value)}
            className="p-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 bg-white hover:bg-gray-50 outline-none"
            title="Paper Background"
        >
            <option value="blank">Blank</option>
            <option value="lined">Lined Paper</option>
            <option value="grid">Grid Paper</option>
            <option value="dot">Dot Grid</option>
        </select>
        
        <div className="w-px h-6 bg-gray-300 mx-1"></div>
        
        <button onClick={handleExport} className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl" title="Export to PDF">
          <Download size={20} />
        </button>
        
        <button onClick={handleClear} className="p-2 text-red-600 hover:bg-red-50 rounded-xl" title="Clear Canvas">
          <Trash2 size={20} />
        </button>
      </div>

    </div>
  );
};

export default Toolbar;
