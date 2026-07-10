const supabase = require('./db/database');

const boardStates = {};
const saveTimeouts = {};

const getBoardState = async (boardId) => {
    if (!boardStates[boardId]) {
      const { data: board } = await supabase.from('boards').select('canvas_data').eq('user_id', boardId).single();
      boardStates[boardId] = board?.canvas_data ? JSON.parse(board.canvas_data) : [];
    }
    return boardStates[boardId];
};

const saveBoardState = (boardId) => {
    if (saveTimeouts[boardId]) {
        clearTimeout(saveTimeouts[boardId]);
    }
    
    // Debounce saves by 2 seconds to reduce DB load
    saveTimeouts[boardId] = setTimeout(() => {
        const data = JSON.stringify(boardStates[boardId]);
        supabase.from('boards').upsert({ 
            user_id: boardId, 
            canvas_data: data,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' }).then(({ error }) => {
            if (error) console.error('Error saving board:', error);
        });
        delete saveTimeouts[boardId];
    }, 2000);
};

module.exports = { boardStates, getBoardState, saveBoardState };
