const supabase = require('./db/database');

const boardStates = {};
const saveTimeouts = {};

const getBoardState = async (boardId) => {
    if (!boardStates[boardId]) {
      const { data: board } = await supabase.from('boards').select('canvas_data').eq('user_id', boardId).single();
      let parsed = [];
      if (board?.canvas_data) {
          try {
              parsed = JSON.parse(board.canvas_data);
              if (typeof parsed === 'string') parsed = JSON.parse(parsed); // Double encode fix
          } catch(e) {
              console.error('Error parsing canvas data for board:', boardId, e);
          }
      }
      boardStates[boardId] = Array.isArray(parsed) ? parsed : [];
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

const flushSave = async (boardId) => {
    if (saveTimeouts[boardId]) {
        clearTimeout(saveTimeouts[boardId]);
        delete saveTimeouts[boardId];
    }
    if (boardStates[boardId]) {
        const data = JSON.stringify(boardStates[boardId]);
        const { error } = await supabase.from('boards').upsert({ 
            user_id: boardId, 
            canvas_data: data,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) console.error('Error flushing board:', boardId, error);
    }
};

const flushAllSaves = async () => {
    const promises = [];
    for (const boardId in saveTimeouts) {
        clearTimeout(saveTimeouts[boardId]);
        const data = JSON.stringify(boardStates[boardId]);
        promises.push(
            supabase.from('boards').upsert({ 
                user_id: boardId, 
                canvas_data: data,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' })
        );
        delete saveTimeouts[boardId];
    }
    await Promise.all(promises);
    console.log(`Flushed ${promises.length} pending board saves.`);
};

module.exports = { boardStates, getBoardState, saveBoardState, flushSave, flushAllSaves };
