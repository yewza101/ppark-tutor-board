const supabase = require('./db/database');

const boardStates = {};
const saveTimeouts = {};
const loadingPromises = {};

const isTeacherBoardId = (id) => id === 'teacher_board' || (typeof id === 'string' && id.startsWith('teacher_board'));

const getBoardState = async (boardId) => {
    if (!boardStates[boardId]) {
      if (isTeacherBoardId(boardId)) {
          boardStates[boardId] = [];
      } else {
          if (!loadingPromises[boardId]) {
              loadingPromises[boardId] = (async () => {
                  try {
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
                      // A clear-canvas (or a stroke) can land while this load is in flight.
                      // Whatever is already in the cache is newer than the DB, so never clobber it.
                      if (!boardStates[boardId]) {
                          boardStates[boardId] = Array.isArray(parsed) ? parsed : [];
                      }
                  } catch (err) {
                      // Never let a DB hiccup leave a rejected promise cached here: every later
                      // getBoardState would await it and the board would stay broken until restart.
                      console.error('Error loading board state:', boardId, err);
                      if (!boardStates[boardId]) boardStates[boardId] = [];
                  } finally {
                      delete loadingPromises[boardId];
                  }
              })();
          }
          await loadingPromises[boardId];
      }
    }
    return boardStates[boardId];
};

const upsertBoard = (boardId) =>
    supabase.from('boards').upsert({
        user_id: boardId,
        canvas_data: JSON.stringify(boardStates[boardId] || []),
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

const saveBoardState = (boardId) => {
    if (isTeacherBoardId(boardId)) return; // Do not save teacher_board to DB

    if (saveTimeouts[boardId]) {
        clearTimeout(saveTimeouts[boardId]);
    }

    // Debounce saves by 2 seconds to reduce DB load
    saveTimeouts[boardId] = setTimeout(() => {
        delete saveTimeouts[boardId];
        upsertBoard(boardId).then(({ error }) => {
            if (error) console.error('Error saving board:', boardId, error);
        });
    }, 2000);
};

const flushSave = async (boardId) => {
    if (isTeacherBoardId(boardId)) return; // Do not save teacher_board to DB

    if (saveTimeouts[boardId]) {
        clearTimeout(saveTimeouts[boardId]);
        delete saveTimeouts[boardId];
    }
    if (boardStates[boardId]) {
        const { error } = await upsertBoard(boardId);
        if (error) console.error('Error flushing board:', boardId, error);
    }
};

const flushAllSaves = async () => {
    const pending = Object.keys(saveTimeouts);
    for (const boardId of pending) {
        clearTimeout(saveTimeouts[boardId]);
        delete saveTimeouts[boardId];
    }
    const results = await Promise.all(pending.map(id => upsertBoard(id)));
    results.forEach(({ error }, i) => {
        if (error) console.error('Error flushing board:', pending[i], error);
    });
    console.log(`Flushed ${pending.length} pending board saves.`);
};

const clearAllBoardCache = () => {
    for (const boardId in saveTimeouts) {
        clearTimeout(saveTimeouts[boardId]);
        delete saveTimeouts[boardId];
    }
    for (const boardId in boardStates) {
        delete boardStates[boardId];
    }
    for (const boardId in loadingPromises) {
        delete loadingPromises[boardId];
    }
    console.log('Cleared all in-memory board caches and save timeouts.');
};

module.exports = { boardStates, getBoardState, saveBoardState, flushSave, flushAllSaves, clearAllBoardCache };
