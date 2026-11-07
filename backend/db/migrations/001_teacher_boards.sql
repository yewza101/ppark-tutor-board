-- Run this once in the Supabase SQL editor.
--
-- Teacher boards were never saved anywhere. `boards.user_id` is an INTEGER that
-- references users(id), so a board id like 'teacher_board_MOOK' simply cannot be
-- stored there, and the server kept them in memory only. The moment the last
-- person left the room — or the server restarted — everything on the teacher
-- board was gone, which is why uploaded worksheets kept disappearing.
--
-- This table keys on the board id as text, so those boards persist like the
-- students' ones do. Until it exists the server quietly falls back to the old
-- memory-only behaviour, so running this is what turns persistence on.

CREATE TABLE IF NOT EXISTS teacher_boards (
  board_id   TEXT PRIMARY KEY,
  canvas_data TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- The end-of-term cleanup clears these alongside the student boards.
