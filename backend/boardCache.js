const supabase = require('./db/database');

const boardStates = {};
const saveTimeouts = {};
const loadingPromises = {};

const isTeacherBoardId = (id) => id === 'teacher_board' || (typeof id === 'string' && id.startsWith('teacher_board'));

// Teacher boards cannot live in `boards`: its user_id is an integer foreign key to
// users(id), and a board id like 'teacher_board_MOOK' is not one. They used to be
// kept in memory only, so everything on them vanished the moment the room emptied
// or the process restarted. They now go in their own table, keyed by text.
const TEACHER_TABLE = 'teacher_boards';

// If that table has not been created yet, fall back to the old in-memory behaviour
// rather than erroring on every stroke. The migration is normally run against a
// live server, so retry periodically instead of latching off until a restart.
const TEACHER_TABLE_RETRY_MS = 60 * 1000;
let teacherTableMissingSince = 0;
const teacherTableUsable = () =>
    !teacherTableMissingSince || Date.now() - teacherTableMissingSince > TEACHER_TABLE_RETRY_MS;

const noteTeacherTableMissing = (error) => {
    const code = error?.code || '';
    const msg = String(error?.message || '');
    const missing = code === '42P01' || code === 'PGRST205' ||
        /does not exist|schema cache/i.test(msg);
    if (missing) {
        if (!teacherTableMissingSince) {
            console.warn(
                `Table "${TEACHER_TABLE}" is missing, so teacher boards are memory-only and ` +
                'will be lost when the room empties. Run backend/db/migrations/001_teacher_boards.sql.'
            );
        }
        teacherTableMissingSince = Date.now();
    }
    return missing;
};

const parseCanvas = (raw, boardId) => {
    let parsed = [];
    if (raw) {
        try {
            parsed = JSON.parse(raw);
            if (typeof parsed === 'string') parsed = JSON.parse(parsed); // Double encode fix
        } catch (e) {
            console.error('Error parsing canvas data for board:', boardId, e);
        }
    }
    return Array.isArray(parsed) ? parsed : [];
};

const readBoardRow = async (boardId) => {
    if (isTeacherBoardId(boardId)) {
        if (!teacherTableUsable()) return null;
        const { data, error } = await supabase
            .from(TEACHER_TABLE).select('canvas_data').eq('board_id', boardId).maybeSingle();
        if (error) { noteTeacherTableMissing(error); return null; }
        return data?.canvas_data ?? null;
    }
    const { data } = await supabase
        .from('boards').select('canvas_data').eq('user_id', boardId).single();
    return data?.canvas_data ?? null;
};

const getBoardState = async (boardId) => {
    if (!boardStates[boardId]) {
        if (!loadingPromises[boardId]) {
            loadingPromises[boardId] = (async () => {
                try {
                    const raw = await readBoardRow(boardId);
                    const parsed = parseCanvas(raw, boardId);
                    // A clear-canvas (or a stroke) can land while this load is in flight.
                    // Whatever is already in the cache is newer than the DB, so never clobber it.
                    if (!boardStates[boardId]) {
                        boardStates[boardId] = parsed;
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
    return boardStates[boardId];
};

const upsertBoard = async (boardId) => {
    const canvas_data = JSON.stringify(boardStates[boardId] || []);
    const updated_at = new Date().toISOString();

    if (isTeacherBoardId(boardId)) {
        if (!teacherTableUsable()) return { error: null }; // migration not run yet
        const res = await supabase.from(TEACHER_TABLE)
            .upsert({ board_id: boardId, canvas_data, updated_at }, { onConflict: 'board_id' });
        if (res.error && noteTeacherTableMissing(res.error)) return { error: null };
        return res;
    }

    return supabase.from('boards')
        .upsert({ user_id: boardId, canvas_data, updated_at }, { onConflict: 'user_id' });
};

const saveBoardState = (boardId) => {
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

// Lets /healthz answer "are teacher boards actually being saved?" without having
// to go and read the server logs or the database by hand.
const probeTeacherBoards = async () => {
    const { error } = await supabase.from(TEACHER_TABLE).select('board_id').limit(1);
    if (!error) return 'ok';
    if (noteTeacherTableMissing(error)) return 'missing-table';
    return 'error: ' + (error.message || error.code || 'unknown');
};

module.exports = { boardStates, getBoardState, saveBoardState, flushSave, flushAllSaves, clearAllBoardCache, probeTeacherBoards };
